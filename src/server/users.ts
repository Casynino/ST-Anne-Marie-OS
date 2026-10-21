import { z } from "zod";
import { db } from "@/lib/db";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { generateTemporaryPassword, hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth/password";
import { destroyAllSessions } from "@/lib/auth/session";
import { SUPER_ADMIN_ROLE_KEY } from "@/lib/rbac/roles";
import { DEPARTMENTS, DEPARTMENT_KEYS, departmentByKey } from "@/lib/rbac/departments";
import { actorOf, diffFields, writeAudit } from "@/server/audit";
import { assignableRoles } from "@/server/rbac";
import { optDateOnly, optEmailField, optPhoneField, optText, parse, text, uuid } from "@/lib/validation";

const userSchema = z
  .object({
    fullName: text(120),
    email: optEmailField(),
    phone: optPhoneField(),
    jobTitle: optText(80),
    staffNo: optText(40),
    employedOn: optDateOnly(),
    locale: z.enum(["EN", "SW"]).default("EN"),
    roleIds: z.array(uuid()).default([]),
    /** The simple way to pick access: a department stands for one standard role. */
    department: z.preprocess((v) => (v === "" ? undefined : v), z.enum(DEPARTMENT_KEYS).optional()),
    /** Set by the administrator when the account is made (or reset). Left out = a random one is generated and shown once. */
    password: z.string().max(128).optional(),
  })
  .refine((v) => v.email || v.phone, { path: ["email"], message: "Provide an email address or a phone number" });

/** The role behind a chosen department (looked up in this school), added to any roles given directly. */
async function withDepartmentRole(ctx: AuthContext, department: string | undefined, roleIds: string[]) {
  const dept = department ? departmentByKey(department) : undefined;
  if (!dept) return roleIds;
  const role = await db.role.findFirst({ where: { schoolId: ctx.schoolId, key: dept.roleKey }, select: { id: true } });
  if (!role) throw invalid("Please correct the highlighted fields.", { department: "This department is not set up in this school" });
  return roleIds.includes(role.id) ? roleIds : [...roleIds, role.id];
}

/** The password the administrator typed (checked for strength) or, when none was typed, a random one. */
function chosenPassword(typed: string | undefined, field = "password") {
  if (typed === undefined || typed === "") return generateTemporaryPassword();
  const weak = validatePasswordStrength(typed);
  if (weak) throw invalid("Please correct the highlighted fields.", { [field]: weak });
  return typed;
}

const asArray = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

export async function listStaffUsers(ctx: AuthContext, opts: { q?: string; page?: number } = {}) {
  requirePermission(ctx, "user.read");
  const pageSize = 25;
  const page = Math.max(1, opts.page ?? 1);
  const q = opts.q?.trim();
  const where = {
    schoolId: ctx.schoolId,
    type: "STAFF" as const,
    ...(q
      ? { OR: [{ fullName: { contains: q, mode: "insensitive" as const } }, { email: { contains: q.toLowerCase() } }, { phone: { contains: q } }] }
      : {}),
  };
  const [items, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: { fullName: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { roles: { include: { role: { select: { id: true, name: true, key: true } } } }, staff: { select: { jobTitle: true, staffNo: true } } },
    }),
    db.user.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function getStaffUser(ctx: AuthContext, userId: string) {
  requirePermission(ctx, "user.read");
  return loadStaffUser(ctx.schoolId, userId);
}

async function loadStaffUser(schoolId: string, userId: string) {
  const user = await db.user.findFirst({
    where: { id: userId, schoolId, type: "STAFF" },
    include: { roles: { include: { role: true } }, staff: true },
  });
  if (!user) throw notFound("User");
  return user;
}

async function assertRolesAssignable(ctx: AuthContext, roleIds: string[]) {
  if (!roleIds.length) return;
  const allowed = new Set((await assignableRoles(ctx)).map((r) => r.id));
  if (roleIds.some((id) => !allowed.has(id))) {
    throw forbidden("You cannot assign a role with permissions you do not hold yourself.");
  }
}

/** Ensures at least one ACTIVE Super Admin remains after a change affecting `userId`. */
async function assertSuperAdminRemains(ctx: AuthContext, excludeUserId: string) {
  const remaining = await db.user.count({
    where: {
      schoolId: ctx.schoolId,
      status: "ACTIVE",
      id: { not: excludeUserId },
      roles: { some: { role: { key: SUPER_ADMIN_ROLE_KEY } } },
    },
  });
  if (remaining === 0) throw conflict("The school must keep at least one active Super Admin.");
}

const isSuperAdmin = (ctx: AuthContext) => ctx.roleKeys.includes(SUPER_ADMIN_ROLE_KEY);

async function assertCanManageTarget(ctx: AuthContext, targetUserId: string) {
  const targetIsAdmin = await db.userRole.count({
    where: { userId: targetUserId, role: { key: SUPER_ADMIN_ROLE_KEY, schoolId: ctx.schoolId } },
  });
  if (targetIsAdmin && !isSuperAdmin(ctx)) throw forbidden("Only a Super Admin can manage a Super Admin account.");
}

export async function createStaffUser(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "user.create");
  const data = parse(userSchema, { ...(input as object), roleIds: asArray((input as Record<string, unknown>)?.roleIds) });
  data.roleIds = await withDepartmentRole(ctx, data.department, data.roleIds);
  await assertRolesAssignable(ctx, data.roleIds);
  const temporaryPassword = chosenPassword(data.password);
  const passwordHash = await hashPassword(temporaryPassword);

  try {
    const user = await db.$transaction(async (tx) => {
      const validRoles = await tx.role.count({ where: { id: { in: data.roleIds }, schoolId: ctx.schoolId } });
      if (validRoles !== data.roleIds.length) throw invalid("One of the selected roles is not valid.", { roleIds: "Invalid role" });
      const created = await tx.user.create({
        data: {
          schoolId: ctx.schoolId,
          branchId: ctx.branchId,
          fullName: data.fullName,
          email: data.email,
          phone: data.phone,
          locale: data.locale,
          passwordHash,
          mustChangePassword: false,
          roles: { create: data.roleIds.map((roleId) => ({ roleId, assignedById: ctx.userId })) },
          staff: { create: { schoolId: ctx.schoolId, jobTitle: data.jobTitle, staffNo: data.staffNo, employedOn: data.employedOn } },
        },
      });
      await writeAudit(tx, actorOf(ctx), {
        action: "user.create",
        entityType: "User",
        entityId: created.id,
        summary: data.fullName,
        changes: { roleIds: data.roleIds },
      });
      return created;
    });
    return { user, temporaryPassword };
  } catch (e) {
    throw mapUniqueError(e);
  }
}

export async function updateStaffUser(ctx: AuthContext, userId: string, input: unknown) {
  requirePermission(ctx, "user.update");
  const given = input as Record<string, unknown>;
  const raw = { ...given, roleIds: asArray(given?.roleIds) };
  const data = parse(userSchema, raw);
  const existing = await loadStaffUser(ctx.schoolId, userId);
  await assertCanManageTarget(ctx, userId);
  if (given?.roleIds === undefined && !data.department) {
    // The simple form sends neither roles nor a department: access stays as it is.
    data.roleIds = existing.roles.map((r) => r.roleId);
  } else if (data.department) {
    // A department replaces the person's department role only; any custom role they hold is kept.
    const standard = new Set(DEPARTMENTS.map((d) => d.roleKey));
    const chosen = departmentByKey(data.department)!;
    const alreadyThere = existing.roles.some((r) => r.role.key === chosen.roleKey);
    const keep = existing.roles.filter((r) => !standard.has(r.role.key as never)).map((r) => r.roleId);
    data.roleIds = alreadyThere ? existing.roles.map((r) => r.roleId) : await withDepartmentRole(ctx, data.department, [...new Set([...keep, ...data.roleIds])]);
  }

  const currentRoleIds = existing.roles.map((r) => r.roleId);
  const added = data.roleIds.filter((id) => !currentRoleIds.includes(id));
  const removed = currentRoleIds.filter((id) => !data.roleIds.includes(id));
  await assertRolesAssignable(ctx, added);
  // Removing a role the actor could not assign is also blocked (e.g. stripping a Super Admin).
  if (removed.length) {
    const allowed = new Set((await assignableRoles(ctx)).map((r) => r.id));
    if (removed.some((id) => !allowed.has(id))) throw forbidden("You cannot remove a role with permissions you do not hold yourself.");
  }
  const adminRole = existing.roles.find((r) => r.role.key === SUPER_ADMIN_ROLE_KEY);
  if (adminRole && removed.includes(adminRole.roleId)) await assertSuperAdminRemains(ctx, userId);

  try {
    await db.$transaction(async (tx) => {
      const validRoles = await tx.role.count({ where: { id: { in: data.roleIds }, schoolId: ctx.schoolId } });
      if (validRoles !== data.roleIds.length) throw invalid("One of the selected roles is not valid.", { roleIds: "Invalid role" });
      await tx.user.update({
        where: { id: userId },
        data: { fullName: data.fullName, email: data.email ?? null, phone: data.phone ?? null, locale: data.locale },
      });
      await tx.staff.update({
        where: { userId },
        data: { jobTitle: data.jobTitle ?? null, staffNo: data.staffNo ?? null, employedOn: data.employedOn ?? null },
      });
      if (removed.length) await tx.userRole.deleteMany({ where: { userId, roleId: { in: removed } } });
      if (added.length) await tx.userRole.createMany({ data: added.map((roleId) => ({ userId, roleId, assignedById: ctx.userId })) });
      await writeAudit(tx, actorOf(ctx), {
        action: "user.update",
        entityType: "User",
        entityId: userId,
        summary: data.fullName,
        changes: {
          ...diffFields({ ...existing }, { fullName: data.fullName, email: data.email ?? null, phone: data.phone ?? null }, ["fullName", "email", "phone"]),
          rolesAdded: added,
          rolesRemoved: removed,
        },
      });
    });
  } catch (e) {
    throw mapUniqueError(e);
  }
  // Role changes take effect immediately: permissions are loaded per request.
}

export async function setUserStatus(ctx: AuthContext, userId: string, status: "ACTIVE" | "SUSPENDED", reason?: string) {
  requirePermission(ctx, "user.suspend");
  if (userId === ctx.userId) throw forbidden("You cannot change your own account status.");
  const user = await loadStaffUser(ctx.schoolId, userId);
  await assertCanManageTarget(ctx, userId);
  if (status === "SUSPENDED" && user.roles.some((r) => r.role.key === SUPER_ADMIN_ROLE_KEY)) {
    await assertSuperAdminRemains(ctx, userId);
  }
  if (user.status === status) return;
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { status } });
    if (status === "SUSPENDED") await tx.session.deleteMany({ where: { userId } });
    await writeAudit(tx, actorOf(ctx), {
      action: status === "SUSPENDED" ? "user.suspend" : "user.reactivate",
      entityType: "User",
      entityId: userId,
      summary: user.fullName,
      reason,
    });
  });
}

/** Admin-initiated reset: sets the password the administrator typed (or a random one shown once). The person can keep it or change it later. */
export async function resetUserPassword(ctx: AuthContext, userId: string, password?: string) {
  requirePermission(ctx, "user.reset_password");
  const user = await loadStaffUser(ctx.schoolId, userId);
  await assertCanManageTarget(ctx, userId);
  const temporaryPassword = chosenPassword(password);
  const passwordHash = await hashPassword(temporaryPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() } });
    await tx.session.deleteMany({ where: { userId } });
    await writeAudit(tx, actorOf(ctx), { action: "user.reset_password", entityType: "User", entityId: userId, summary: user.fullName });
  });
  return { temporaryPassword };
}

const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, "Required"), newPassword: z.string(), confirmPassword: z.string() })
  .superRefine((v, c) => {
    const weak = validatePasswordStrength(v.newPassword);
    if (weak) c.addIssue({ code: "custom", path: ["newPassword"], message: weak });
    if (v.newPassword !== v.confirmPassword) c.addIssue({ code: "custom", path: ["confirmPassword"], message: "Passwords do not match" });
    if (v.newPassword === v.currentPassword) c.addIssue({ code: "custom", path: ["newPassword"], message: "Choose a different password" });
  });

export async function changeOwnPassword(ctx: AuthContext, input: unknown, keepSessionId?: string) {
  const data = parse(changePasswordSchema, input);
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  if (!(await verifyPassword(data.currentPassword, user.passwordHash))) {
    throw invalid("Please correct the highlighted fields.", { currentPassword: "Current password is incorrect" });
  }
  const passwordHash = await hashPassword(data.newPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: ctx.userId }, data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() } });
    await writeAudit(tx, actorOf(ctx), { action: "user.change_password", entityType: "User", entityId: ctx.userId, summary: ctx.fullName });
  });
  await destroyAllSessions(ctx.userId, keepSessionId);
}

function mapUniqueError(e: unknown): unknown {
  const err = e as { code?: string; meta?: { target?: unknown }; message?: string };
  if (err?.code === "P2002") {
    const target = JSON.stringify(err.meta?.target ?? err.message ?? "");
    if (target.includes("email")) return invalid("Please correct the highlighted fields.", { email: "This email is already in use" });
    if (target.includes("phone")) return invalid("Please correct the highlighted fields.", { phone: "This phone number is already in use" });
    if (target.includes("staffNo")) return invalid("Please correct the highlighted fields.", { staffNo: "This staff number is already in use" });
  }
  return e;
}

