import { requireContext, getT } from "@/lib/auth/next";
import { formatMoney } from "@/lib/finance/money";
import { getSchoolBasics } from "@/server/settings";
import { countUnmatchedEvents } from "@/server/payment-events";

/** Common set-up for finance pages: signed-in staff, translator, currency formatter, reconciliation badge. */
export async function financePage() {
  const ctx = await requireContext();
  const t = await getT();
  const school = await getSchoolBasics(ctx.schoolId);
  const unmatched = ctx.permissions.has("finance.reconcile") ? await countUnmatchedEvents(ctx) : 0;
  return { ctx, t, currency: school.currency, timezone: school.timezone, money: (cents: number) => formatMoney(cents, school.currency), unmatched };
}

export const STATE_TONE = { PAID: "ok", PARTIAL: "warn", UNPAID: "bad", NO_CHARGE: "neutral" } as const;
export const inputDate = (d: Date | string) => (typeof d === "string" ? d : d.toISOString().slice(0, 10));
