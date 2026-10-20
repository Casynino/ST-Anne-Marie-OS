import type { Db, Tx } from "@/lib/db";
import type { RequestMeta } from "@/lib/auth/context";

export type AuditActor = {
  schoolId: string;
  actorId: string | null;
  actorName: string | null;
  meta: RequestMeta;
};

export type AuditEntry = {
  action: string; // e.g. "student.create"
  entityType: string; // e.g. "Student"
  entityId?: string | null;
  summary?: string;
  changes?: Record<string, unknown>;
  reason?: string;
};

/**
 * Appends an audit event. Pass the transaction client so the event commits or rolls back with the
 * change it describes. The audit_logs table is append-only at database level.
 * Never put passwords, tokens or free-text medical notes in `changes`.
 */
export async function writeAudit(client: Db | Tx, actor: AuditActor, entry: AuditEntry): Promise<void> {
  await client.auditLog.create({
    data: {
      schoolId: actor.schoolId,
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      changes: entry.changes as object | undefined,
      reason: entry.reason,
      ip: actor.meta.ip,
      userAgent: actor.meta.userAgent?.slice(0, 300),
    },
  });
}

export function actorOf(ctx: { schoolId: string; userId: string; fullName: string; meta: RequestMeta }): AuditActor {
  return { schoolId: ctx.schoolId, actorId: ctx.userId, actorName: ctx.fullName, meta: ctx.meta };
}

/** Returns {field: [before, after]} for fields whose value actually changed. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: readonly (keyof T)[],
): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const f of fields) {
    if (!(f in after)) continue;
    const a = before[f] instanceof Date ? (before[f] as Date).toISOString().slice(0, 10) : before[f];
    const b = after[f] instanceof Date ? (after[f] as Date).toISOString().slice(0, 10) : after[f];
    if (a !== b) out[String(f)] = [a ?? null, b ?? null];
  }
  return out;
}
