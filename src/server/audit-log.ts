import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { parseDateOnly } from "@/lib/dates";

export async function listAuditLogs(
  ctx: AuthContext,
  opts: { action?: string; entityType?: string; actorId?: string; from?: string; to?: string; page?: number } = {},
) {
  requirePermission(ctx, "audit.read");
  const pageSize = 40;
  const page = Math.max(1, opts.page ?? 1);
  const from = opts.from ? parseDateOnly(opts.from) : null;
  const to = opts.to ? parseDateOnly(opts.to) : null;
  const where: Prisma.AuditLogWhereInput = {
    schoolId: ctx.schoolId,
    ...(opts.action ? { action: { startsWith: opts.action } } : {}),
    ...(opts.entityType ? { entityType: opts.entityType } : {}),
    ...(opts.actorId ? { actorId: opts.actorId } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: new Date(to.getTime() + 86_400_000) } : {}) } } : {}),
  };
  const [items, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    db.auditLog.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function listAuditFilters(ctx: AuthContext) {
  requirePermission(ctx, "audit.read");
  const [entityTypes, actors] = await Promise.all([
    db.auditLog.findMany({ where: { schoolId: ctx.schoolId }, distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
    db.user.findMany({ where: { schoolId: ctx.schoolId, type: "STAFF" }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
  ]);
  return { entityTypes: entityTypes.map((e) => e.entityType), actors };
}
