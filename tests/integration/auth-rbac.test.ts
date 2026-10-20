import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { authenticate, MAX_FAILURES_PER_IDENTIFIER } from "@/lib/auth/login";
import { resolveSession, destroySession, destroyAllSessions } from "@/lib/auth/session";
import { buildAuthContext } from "@/lib/auth/context";
import { assignableRoles, ensureSchoolRoles, setRolePermissions, syncPermissionCatalog } from "@/server/rbac";
import * as users from "@/server/users";
import { AppError } from "@/lib/errors";
import { ALL_PERMISSION_KEYS } from "@/lib/rbac/permissions";
import { randomUUID } from "node:crypto";
import { createTestSchool, createTestUser } from "../helpers";

const uniq = () => randomUUID().slice(0, 8);

const meta = { ip: "10.0.0.1", userAgent: "vitest" };
let school: Awaited<ReturnType<typeof createTestSchool>>;

beforeAll(async () => {
  school = await createTestSchool();
});

const expectCode = async (p: Promise<unknown>, code: AppError["code"]) => {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
};

describe("authentication", () => {
  it("signs in with email and with phone, creates a hashed session, and signs out", async () => {
    const { user } = await createTestUser(school.id, ["registrar"], { password: "Right-pass-12" });
    await db.user.update({ where: { id: user.id }, data: { phone: `+2557${Math.floor(10000000 + Math.random() * 89999999)}` } });
    const fresh = await db.user.findUniqueOrThrow({ where: { id: user.id } });

    const byEmail = await authenticate(fresh.email!, "Right-pass-12", { ...meta, ip: "10.1.0.1" });
    expect(byEmail.userId).toBe(user.id);
    const stored = await db.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.tokenHash).not.toContain(byEmail.token); // only a hash is stored
    expect((await resolveSession(byEmail.token))?.userId).toBe(user.id);

    const byPhone = await authenticate(fresh.phone!.replace("+255", "0"), "Right-pass-12", { ...meta, ip: "10.1.0.2" });
    expect(byPhone.userId).toBe(user.id);

    await destroySession(byEmail.token);
    expect(await resolveSession(byEmail.token)).toBeNull();
    await destroyAllSessions(user.id);
    expect(await resolveSession(byPhone.token)).toBeNull();
  });

  it("gives the same generic message for wrong password and unknown account", async () => {
    const { user } = await createTestUser(school.id, [], { password: "Right-pass-12" });
    const wrong = await authenticate(user.email!, "bad", { ...meta, ip: "10.2.0.1" }).catch((e) => e as AppError);
    const unknown = await authenticate(`nobody-${uniq()}@nowhere.example`, "bad", { ...meta, ip: "10.2.0.2" }).catch((e) => e as AppError);
    expect((wrong as AppError).message).toBe((unknown as AppError).message);
  });

  it("rate-limits repeated failures, then blocks even the correct password", async () => {
    const { user } = await createTestUser(school.id, [], { password: "Right-pass-12" });
    for (let i = 0; i < MAX_FAILURES_PER_IDENTIFIER; i++) {
      await expectCode(authenticate(user.email!, "wrong", { ...meta, ip: `10.3.0.${i}` }), "UNAUTHENTICATED");
    }
    await expectCode(authenticate(user.email!, "Right-pass-12", { ...meta, ip: "10.3.0.99" }), "RATE_LIMITED");
  });

  it("blocks suspended users and invalidates their sessions", async () => {
    const { user } = await createTestUser(school.id, [], { password: "Right-pass-12" });
    const s = await authenticate(user.email!, "Right-pass-12", { ...meta, ip: "10.4.0.1" });
    await db.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });
    expect(await resolveSession(s.token)).toBeNull();
    await expectCode(authenticate(user.email!, "Right-pass-12", { ...meta, ip: "10.4.0.2" }), "UNAUTHENTICATED");
    await expectCode(buildAuthContext(user.id), "UNAUTHENTICATED");
  });
});

describe("roles & permissions", () => {
  it("grants default permissions per role and everything to super admin", async () => {
    const { ctx: admin } = await createTestUser(school.id, ["super_admin"]);
    expect(admin.permissions.size).toBe(ALL_PERMISSION_KEYS.length);
    const { ctx: subject } = await createTestUser(school.id, ["subject_teacher"]);
    expect(subject.permissions.has("student.read_assigned")).toBe(true);
    expect(subject.permissions.has("student.read")).toBe(false);
    expect(subject.permissions.has("student.medical.read")).toBe(false);
    const { ctx: parent } = await createTestUser(school.id, ["parent"]);
    expect(parent.permissions.size).toBe(0);
  });

  it("does not re-grant a default permission an admin removed, but does grant genuinely new ones", async () => {
    const s = await createTestSchool();
    const { ctx: admin } = await createTestUser(s.id, ["super_admin"]);
    const role = await db.role.findUniqueOrThrow({ where: { schoolId_key: { schoolId: s.id, key: "registrar" } }, include: { permissions: { include: { permission: true } } } });
    const keep = role.permissions.map((p) => p.permission.key).filter((k) => k !== "student.medical.read");
    await setRolePermissions(admin, role.id, keep);

    await ensureSchoolRoles(db, s.id, new Set()); // re-run with no new permissions
    let after = await db.rolePermission.findMany({ where: { roleId: role.id }, include: { permission: true } });
    expect(after.map((p) => p.permission.key)).not.toContain("student.medical.read");

    await ensureSchoolRoles(db, s.id, new Set(["student.medical.read"])); // pretend it is newly introduced
    after = await db.rolePermission.findMany({ where: { roleId: role.id }, include: { permission: true } });
    expect(after.map((p) => p.permission.key)).toContain("student.medical.read");
    expect((await syncPermissionCatalog(db)).size).toBe(0); // catalog sync is idempotent
  });

  it("prevents privilege escalation when granting permissions or roles", async () => {
    const s = await createTestSchool();
    const { ctx: admin } = await createTestUser(s.id, ["super_admin"]);
    const { ctx: hr } = await createTestUser(s.id, ["head_teacher"]);
    await db.rolePermission.createMany({
      data: [
        { roleId: (await db.role.findUniqueOrThrow({ where: { schoolId_key: { schoolId: s.id, key: "head_teacher" } } })).id, permissionId: (await db.permission.findUniqueOrThrow({ where: { key: "user.create" } })).id },
        { roleId: (await db.role.findUniqueOrThrow({ where: { schoolId_key: { schoolId: s.id, key: "head_teacher" } } })).id, permissionId: (await db.permission.findUniqueOrThrow({ where: { key: "user.update" } })).id },
      ],
    });
    const hrCtx = await buildAuthContext(hr.userId);
    const superRole = await db.role.findUniqueOrThrow({ where: { schoolId_key: { schoolId: s.id, key: "super_admin" } } });

    await expectCode(users.createStaffUser(hrCtx, { fullName: "Sneaky", email: "sneaky@x.example", roleIds: [superRole.id] }), "FORBIDDEN");
    await expectCode(setRolePermissions(hrCtx, superRole.id, []), "FORBIDDEN"); // no role.manage
    await expectCode(setRolePermissions(admin, superRole.id, []), "FORBIDDEN"); // super admin role is fixed
  });

  it("never offers portal roles (parent/student) for staff accounts", async () => {
    const s = await createTestSchool();
    const { ctx: admin } = await createTestUser(s.id, ["super_admin"]);
    const keys = (await assignableRoles(admin)).map((r) => r.key);
    expect(keys).toContain("registrar");
    expect(keys).not.toContain("parent");
    expect(keys).not.toContain("student");
    const parentRole = await db.role.findUniqueOrThrow({ where: { schoolId_key: { schoolId: s.id, key: "parent" } } });
    await expectCode(users.createStaffUser(admin, { fullName: "Not Staff", email: `ns-${uniq()}@x.example`, roleIds: parentRole.id }), "FORBIDDEN");
  });

  it("preserves role permissions the editing user does not hold themselves", async () => {
    const s = await createTestSchool();
    const { ctx: admin } = await createTestUser(s.id, ["super_admin"]);
    const registrar = await db.role.findUniqueOrThrow({ where: { schoolId_key: { schoolId: s.id, key: "registrar" } }, include: { permissions: { include: { permission: true } } } });
    // A manager who can manage roles but does NOT hold student.medical.update.
    const { user: mgr } = await createTestUser(s.id, []);
    const mgrRole = await db.role.create({ data: { schoolId: s.id, key: "custom_mgr", name: "Role manager" } });
    const grant = await db.permission.findMany({ where: { key: { in: ["role.manage", "role.read", "student.read"] } } });
    await db.rolePermission.createMany({ data: grant.map((p) => ({ roleId: mgrRole.id, permissionId: p.id })) });
    await db.userRole.create({ data: { userId: mgr.id, roleId: mgrRole.id } });
    const mgrCtx = await buildAuthContext(mgr.id);

    const original = registrar.permissions.map((p) => p.permission.key).sort();
    await setRolePermissions(mgrCtx, registrar.id, []); // tries to strip everything
    const after = await db.rolePermission.findMany({ where: { roleId: registrar.id }, include: { permission: true } });
    const keys = after.map((p) => p.permission.key).sort();
    // Only permissions the manager itself holds (student.read) can be removed; all others are preserved.
    expect(keys).toEqual(original.filter((k) => k !== "student.read"));
    expect(keys).toContain("student.medical.update");
    expect(admin.permissions.size).toBeGreaterThan(0);
  });

  it("protects the last super admin and the acting user's own account", async () => {
    const s = await createTestSchool();
    const { ctx: admin } = await createTestUser(s.id, ["super_admin"]);
    await expectCode(users.setUserStatus(admin, admin.userId, "SUSPENDED"), "FORBIDDEN"); // cannot suspend yourself

    const { ctx: second } = await createTestUser(s.id, ["super_admin"]);
    await users.setUserStatus(admin, second.userId, "SUSPENDED"); // fine: one other admin remains
    await users.setUserStatus(admin, second.userId, "ACTIVE");

    const emailOf = async (id: string) => (await db.user.findUniqueOrThrow({ where: { id } })).email;
    // Demote the second admin: allowed while the first remains.
    await users.updateStaffUser(admin, second.userId, { fullName: "Second", email: await emailOf(second.userId), roleIds: [] });
    // Now `admin` is the only Super Admin: removing their own admin role must be refused.
    await expectCode(
      users.updateStaffUser(admin, admin.userId, { fullName: "Admin", email: await emailOf(admin.userId), roleIds: [] }),
      "CONFLICT",
    );
  });

  it("creating a user returns a one-time temporary password that works and forces a change; reset kills sessions", async () => {
    const s = await createTestSchool();
    const { ctx: admin } = await createTestUser(s.id, ["super_admin"]);
    const role = await db.role.findUniqueOrThrow({ where: { schoolId_key: { schoolId: s.id, key: "class_teacher" } } });
    const email = `t1-${uniq()}@school.example`;
    const phone = `07${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { user, temporaryPassword } = await users.createStaffUser(admin, { fullName: "Teacher One", email: email.toUpperCase(), phone, roleIds: role.id });
    expect(user.mustChangePassword).toBe(true);
    expect(user.email).toBe(email);
    const login = await authenticate(email, temporaryPassword, { ip: "10.9.0.1", userAgent: "t" });
    expect(login.mustChangePassword).toBe(true);

    const reset = await users.resetUserPassword(admin, user.id);
    expect(await resolveSession(login.token)).toBeNull();
    await expectCode(authenticate(email, temporaryPassword, { ip: "10.9.0.2", userAgent: "t" }), "UNAUTHENTICATED");
    await authenticate(email, reset.temporaryPassword, { ip: "10.9.0.3", userAgent: "t" });

    const audits = await db.auditLog.findMany({ where: { schoolId: s.id, entityId: user.id } });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["user.create", "user.reset_password"]));
    expect(JSON.stringify(audits)).not.toContain(temporaryPassword); // secrets never reach the audit log
  });

  it("rejects duplicate emails with a field error", async () => {
    const s = await createTestSchool();
    const { ctx: admin } = await createTestUser(s.id, ["super_admin"]);
    const email = `dup-${uniq()}@school.example`;
    await users.createStaffUser(admin, { fullName: "A", email });
    const err = await users.createStaffUser(admin, { fullName: "B", email }).catch((e) => e as AppError);
    expect((err as AppError).code).toBe("VALIDATION");
    expect((err as AppError).fieldErrors?.email).toBeTruthy();
  });
});
