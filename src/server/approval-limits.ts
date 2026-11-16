import { z } from "zod";
import { db } from "@/lib/db";
import type { Db, Tx } from "@/lib/db";
import { invalid } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { actorOf, writeAudit } from "@/server/audit";
import { parseAmount } from "@/lib/finance/money";
import { parse } from "@/lib/validation";

/**
 * What only the owner may decide. Routine expenses and refunds are approved by the head teacher (a second person, never the one who
 * recorded them); at or above these limits the decision is reserved for people holding `expense.approve_high` / `refund.approve_high`
 * (the owner). 0 means no limit: nothing is reserved and the routine approvers decide everything, as before.
 */
export type ApprovalLimits = { expenseOwnerAboveCents: number; refundOwnerAboveCents: number };
export const DEFAULT_APPROVAL_LIMITS: ApprovalLimits = { expenseOwnerAboveCents: 0, refundOwnerAboveCents: 0 };
const KEY = "approval_limits";

export async function getApprovalLimits(client: Db | Tx, schoolId: string): Promise<ApprovalLimits> {
  const row = await client.schoolSetting.findUnique({ where: { schoolId_key: { schoolId, key: KEY } } });
  const v = (row?.value ?? {}) as Partial<ApprovalLimits>;
  const ok = (n: unknown) => (Number.isInteger(n) && (n as number) > 0 ? (n as number) : 0);
  return { expenseOwnerAboveCents: ok(v.expenseOwnerAboveCents), refundOwnerAboveCents: ok(v.refundOwnerAboveCents) };
}

const schema = z.object({ expenseOwnerAbove: z.union([z.string(), z.number()]).optional(), refundOwnerAbove: z.union([z.string(), z.number()]).optional() });

/** Changing what the owner must decide is itself an owner-level setting. */
export async function updateApprovalLimits(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "school.settings.update");
  const d = parse(schema, input);
  const before = await getApprovalLimits(db, ctx.schoolId);
  const one = (raw: string | number | undefined, prev: number, field: string) => {
    if (raw === undefined || raw === "") return raw === "" ? 0 : prev;
    const c = parseAmount(raw);
    if (c === null) throw invalid("Please correct the highlighted fields.", { [field]: "Enter an amount such as 0 or 500000" });
    return c;
  };
  const value: ApprovalLimits = { expenseOwnerAboveCents: one(d.expenseOwnerAbove, before.expenseOwnerAboveCents, "expenseOwnerAbove"), refundOwnerAboveCents: one(d.refundOwnerAbove, before.refundOwnerAboveCents, "refundOwnerAbove") };
  await db.$transaction(async (tx) => {
    await tx.schoolSetting.upsert({ where: { schoolId_key: { schoolId: ctx.schoolId, key: KEY } }, create: { schoolId: ctx.schoolId, key: KEY, value, updatedById: ctx.userId }, update: { value, updatedById: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "approval_limits.update", entityType: "SchoolSetting", entityId: KEY, changes: { before, after: value } });
  });
  return value;
}
