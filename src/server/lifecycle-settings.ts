import { z } from "zod";
import { db, type Db, type Tx } from "@/lib/db";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import type { FeePolicy } from "@/lib/lifecycle/rules";
import { actorOf, writeAudit } from "@/server/audit";
import { checkbox, parse } from "@/lib/validation";

/*
 * The school's own rules for a student's years at school, in one setting. Nothing here is a default policy the school did not choose: the
 * defaults only keep the process informative (no approval beyond the Academic Office, no promotion average, unpaid fees block nothing).
 */

export type LifecycleSettings = {
  /** The Head Teacher must approve progression decisions after the Academic Office. */
  requireHeadApproval: boolean;
  /** The average (percent) the school treats as eligible for promotion. null = the school has not set one: the Academic Office decides. */
  promotionMinAverage: number | null;
  /** INFORM_ONLY: unpaid fees are shown and block nothing. BLOCK_REGISTRATION: annual registration needs fee clearance. BLOCK_ACTIVATION: joining the class roster does. */
  feePolicy: FeePolicy;
  /** Debt from earlier years keeps a student from being cleared. Off: it is shown separately and does not count. */
  previousDebtCounts: boolean;
};
export const DEFAULT_LIFECYCLE: LifecycleSettings = { requireHeadApproval: false, promotionMinAverage: null, feePolicy: "INFORM_ONLY", previousDebtCounts: false };
const KEY = "year_lifecycle";

export async function getLifecycleSettings(client: Db | Tx, schoolId: string): Promise<LifecycleSettings> {
  const row = await client.schoolSetting.findUnique({ where: { schoolId_key: { schoolId, key: KEY } } });
  const s = (row?.value ?? {}) as Partial<LifecycleSettings>;
  const d = DEFAULT_LIFECYCLE;
  return {
    requireHeadApproval: typeof s.requireHeadApproval === "boolean" ? s.requireHeadApproval : d.requireHeadApproval,
    promotionMinAverage: typeof s.promotionMinAverage === "number" && s.promotionMinAverage >= 0 && s.promotionMinAverage <= 100 ? s.promotionMinAverage : null,
    feePolicy: s.feePolicy === "BLOCK_REGISTRATION" || s.feePolicy === "BLOCK_ACTIVATION" || s.feePolicy === "INFORM_ONLY" ? s.feePolicy : d.feePolicy,
    previousDebtCounts: typeof s.previousDebtCounts === "boolean" ? s.previousDebtCounts : d.previousDebtCounts,
  };
}

const schema = z.object({
  requireHeadApproval: checkbox(),
  promotionMinAverage: z.preprocess((v) => (v === "" || v === undefined || v === null ? null : v), z.coerce.number().min(0).max(100).nullable()),
  feePolicy: z.enum(["INFORM_ONLY", "BLOCK_REGISTRATION", "BLOCK_ACTIVATION"]),
  previousDebtCounts: checkbox(),
});

export async function updateLifecycleSettings(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "school.settings.update");
  const d = parse(schema, input);
  const before = await getLifecycleSettings(db, ctx.schoolId);
  const value: LifecycleSettings = { requireHeadApproval: d.requireHeadApproval, promotionMinAverage: d.promotionMinAverage, feePolicy: d.feePolicy, previousDebtCounts: d.previousDebtCounts };
  await db.$transaction(async (tx) => {
    await tx.schoolSetting.upsert({ where: { schoolId_key: { schoolId: ctx.schoolId, key: KEY } }, create: { schoolId: ctx.schoolId, key: KEY, value, updatedById: ctx.userId }, update: { value, updatedById: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "settings.year_lifecycle_update", entityType: "SchoolSetting", entityId: KEY, changes: { before, after: value } });
  });
}
