import type { AuthContext } from "@/lib/auth/context";
import { returningBoard } from "@/server/annual-registration";
import { annualFeeBoard } from "@/server/annual-fees";
import { progressionBoard } from "@/server/progression";

/*
 * The new-year picture in one place, for the school homes and the returning-students page. Each group is built by the service that owns the
 * numbers (the registration board, the Academic Office's decisions, the annual fee board), so a figure here is the same figure on its own screen.
 * A group is null when the person may not see it or there is nothing to count yet; nothing is ever estimated.
 */

export type YearReport = {
  yearName: string;
  admissions: null | { eligible: number; registered: number; awaitingPayment: number; awaitingApproval: number; awaitingClass: number; notRegistered: number; repeat: number; undecided: number };
  academic: null | { students: number; promoted: number; repeat: number; awaitingResults: number; awaitingDecision: number; toReview: number };
  finance: null | { expected: number; initialRequired: number | null; collected: number; verified: number; students: number; outstanding: number; older: number; notBilled: number; awaitingReconciliation: number };
};

export async function yearReport(ctx: AuthContext): Promise<YearReport | null> {
  const has = (p: string) => ctx.permissions.has(p as never);
  const [adm, acad, fin] = await Promise.all([
    has("registration.read") ? returningBoard(ctx, {}).catch(() => null) : null,
    has("progression.read") ? progressionBoard(ctx, {}).catch(() => null) : null,
    has("fees.read") && has("registration.read") ? annualFeeBoard(ctx, {}).catch(() => null) : null,
  ]);
  const yearName = adm?.year?.name ?? fin?.year?.name ?? acad?.nextYear?.name ?? null;
  if (!yearName) return null;
  return {
    yearName,
    admissions: adm?.year ? {
      eligible: adm.counts.total, registered: adm.counts.registered, awaitingPayment: adm.counts.awaitingPayment, awaitingApproval: adm.counts.byStage.NEEDS_REGISTRATION ?? 0,
      awaitingClass: adm.counts.byStage.NEEDS_PLACEMENT ?? 0, notRegistered: adm.counts.notRegistered, repeat: adm.counts.repeat, undecided: adm.counts.undecided,
    } : null,
    academic: acad?.year ? {
      students: acad.totals.students, promoted: acad.totals.promoted, repeat: acad.totals.repeat, awaitingResults: acad.totals.incomplete, awaitingDecision: acad.totals.none + acad.totals.draft, toReview: acad.totals.review,
    } : null,
    finance: fin?.year ? {
      expected: fin.totals.expected, initialRequired: fin.initial.required, collected: fin.totals.collected, verified: fin.totals.cleared, students: fin.totals.students,
      outstanding: fin.totals.outstanding, older: fin.totals.previousOutstanding, notBilled: fin.totals.notBilled, awaitingReconciliation: fin.awaitingReconciliation,
    } : null,
  };
}
