import { db, type Db, type Tx } from "@/lib/db";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { ALL_PERMISSION_KEYS, PERMISSIONS, isPermissionKey, type PermissionKey } from "@/lib/rbac/permissions";
import { PORTAL_ROLE_KEYS, SUPER_ADMIN_ROLE_KEY, SYSTEM_ROLES } from "@/lib/rbac/roles";
import { actorOf, writeAudit } from "@/server/audit";
import { z } from "zod";
import { parse, text, optText } from "@/lib/validation";

/** Makes the `permissions` table match the catalog in code. Returns keys that did not exist before. */
export async function syncPermissionCatalog(client: Db | Tx): Promise<Set<string>> {
  const have = new Set((await client.permission.findMany({ select: { key: true } })).map((p) => p.key));
  const created = new Set<string>();
  for (const key of ALL_PERMISSION_KEYS) {
    const def = PERMISSIONS[key];
    if (have.has(key)) {
      await client.permission.update({ where: { key }, data: { module: def.module, description: def.description } });
    } else {
      await client.permission.create({ data: { key, module: def.module, description: def.description } });
      created.add(key);
    }
  }
  return created;
}

/**
 * Creates the default roles for a school. Existing roles only receive permissions that are NEW in
 * the catalog (so a permission an admin deliberately removed is never silently re-granted),
 * except super_admin which always holds everything.
 */
export async function ensureSchoolRoles(client: Db | Tx, schoolId: string, newKeys: ReadonlySet<string> = new Set()) {
  const permRows = await client.permission.findMany({ select: { id: true, key: true } });
  const idOf = new Map(permRows.map((p) => [p.key, p.id]));

  for (const def of SYSTEM_ROLES) {
    let role = await client.role.findUnique({ where: { schoolId_key: { schoolId, key: def.key } } });
    const isNew = !role;
    role ??= await client.role.create({
      data: { schoolId, key: def.key, name: def.name, description: def.description, isSystem: true },
    });
    const wanted =
      def.key === SUPER_ADMIN_ROLE_KEY ? ALL_PERMISSION_KEYS : isNew ? def.permissions : def.permissions.filter((k) => newKeys.has(k));
    const data = wanted.flatMap((k) => (idOf.has(k) ? [{ roleId: role.id, permissionId: idOf.get(k) as string }] : []));
    if (data.length) await client.rolePermission.createMany({ data, skipDuplicates: true });
  }
}

export async function listRoles(ctx: AuthContext) {
  requirePermission(ctx, "role.read");
  return db.role.findMany({
    where: { schoolId: ctx.schoolId },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    include: { permissions: { include: { permission: { select: { key: true } } } }, _count: { select: { users: true } } },
  });
}

/**
 * Staff roles the acting user may hand out: a role is assignable only if the actor already holds
 * all its permissions. Portal roles (parent/student) are excluded: they belong to portal accounts.
 */
export async function assignableRoles(ctx: AuthContext) {
  const roles = await db.role.findMany({
    where: { schoolId: ctx.schoolId, key: { notIn: [...PORTAL_ROLE_KEYS] } },
    orderBy: { name: "asc" },
    include: { permissions: { include: { permission: { select: { key: true } } } } },
  });
  return roles.filter((r) => r.permissions.every((p) => ctx.permissions.has(p.permission.key as PermissionKey)));
}

const roleInput = z.object({ name: text(80), description: optText(300) });

export async function createRole(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "role.manage");
  const data = parse(roleInput, input);
  const key = `custom_${data.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`.slice(0, 60);
  return db.$transaction(async (tx) => {
    if (await tx.role.findUnique({ where: { schoolId_key: { schoolId: ctx.schoolId, key } } })) {
      throw conflict("A role with this name already exists.");
    }
    const role = await tx.role.create({ data: { schoolId: ctx.schoolId, key, name: data.name, description: data.description } });
    await writeAudit(tx, actorOf(ctx), { action: "role.create", entityType: "Role", entityId: role.id, summary: data.name });
    return role;
  });
}

export async function setRolePermissions(ctx: AuthContext, roleId: string, keys: readonly string[]) {
  requirePermission(ctx, "role.manage");
  const submitted = [...new Set(keys)].filter(isPermissionKey);
  const role = await db.role.findFirst({
    where: { id: roleId, schoolId: ctx.schoolId },
    include: { permissions: { include: { permission: { select: { key: true } } } } },
  });
  if (!role) throw notFound("Role");
  if (role.key === SUPER_ADMIN_ROLE_KEY) throw forbidden("The Super Admin role always holds every permission.");

  const before = new Set(role.permissions.map((p) => p.permission.key));
  // Permissions the actor does not hold cannot be changed by them (they would be neither visible
  // nor submittable in the form), so they are always preserved.
  const preserved = [...before].filter((k): k is PermissionKey => isPermissionKey(k) && !ctx.permissions.has(k));
  const wanted = [...new Set([...submitted, ...preserved])];
  const added = wanted.filter((k) => !before.has(k));
  const removed = [...before].filter((k) => !wanted.includes(k as PermissionKey));
  // No privilege escalation: you can only grant permissions you hold yourself.
  if (added.some((k) => !ctx.permissions.has(k))) throw forbidden("You cannot grant permissions you do not hold yourself.");
  if (!added.length && !removed.length) return role;

  const permRows = await db.permission.findMany({ where: { key: { in: wanted } }, select: { id: true } });
  await db.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    await tx.rolePermission.createMany({ data: permRows.map((p) => ({ roleId, permissionId: p.id })) });
    await writeAudit(tx, actorOf(ctx), {
      action: "role.permissions_update",
      entityType: "Role",
      entityId: roleId,
      summary: role.name,
      changes: { added, removed },
    });
  });
  return role;
}

export async function deleteRole(ctx: AuthContext, roleId: string) {
  requirePermission(ctx, "role.manage");
  const role = await db.role.findFirst({ where: { id: roleId, schoolId: ctx.schoolId }, include: { _count: { select: { users: true } } } });
  if (!role) throw notFound("Role");
  if (role.isSystem) throw forbidden("System roles cannot be deleted.");
  if (role._count.users > 0) throw conflict("Remove this role from its users before deleting it.");
  await db.$transaction(async (tx) => {
    await tx.role.delete({ where: { id: roleId } });
    await writeAudit(tx, actorOf(ctx), { action: "role.delete", entityType: "Role", entityId: roleId, summary: role.name });
  });
}
