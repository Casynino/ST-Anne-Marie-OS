import { db } from "@/lib/db";
import { forbidden, unauthenticated } from "@/lib/errors";
import type { PermissionKey } from "@/lib/rbac/permissions";

export type RequestMeta = { ip: string | null; userAgent: string | null };

/** Everything a service needs to authorise and audit an operation. Built server-side only. */
export type AuthContext = {
  userId: string;
  schoolId: string;
  branchId: string | null;
  fullName: string;
  locale: "EN" | "SW";
  mustChangePassword: boolean;
  staffId: string | null;
  roleKeys: readonly string[];
  permissions: ReadonlySet<PermissionKey>;
  meta: RequestMeta;
};

export const NO_META: RequestMeta = { ip: null, userAgent: null };

export function can(ctx: AuthContext, permission: PermissionKey): boolean {
  return ctx.permissions.has(permission);
}

export function requirePermission(ctx: AuthContext, permission: PermissionKey): void {
  if (!ctx.permissions.has(permission)) throw forbidden();
}

export function requireAnyPermission(ctx: AuthContext, permissions: readonly PermissionKey[]): void {
  if (!permissions.some((p) => ctx.permissions.has(p))) throw forbidden();
}

/** Loads roles and permissions for an ACTIVE user. Throws if the user cannot act. */
export async function buildAuthContext(userId: string, meta: RequestMeta = NO_META): Promise<AuthContext> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      staff: { select: { id: true } },
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    },
  });
  if (!user || user.status !== "ACTIVE") throw unauthenticated();

  const permissions = new Set<PermissionKey>();
  for (const ur of user.roles) {
    for (const rp of ur.role.permissions) permissions.add(rp.permission.key as PermissionKey);
  }

  return {
    userId: user.id,
    schoolId: user.schoolId,
    branchId: user.branchId,
    fullName: user.fullName,
    locale: user.locale,
    mustChangePassword: user.mustChangePassword,
    staffId: user.staff?.id ?? null,
    roleKeys: user.roles.map((ur) => ur.role.key),
    permissions,
    meta,
  };
}
