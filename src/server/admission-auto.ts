import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildAuthContext } from "@/lib/auth/context";
import { examSummaryOf } from "@/server/admission-exams";
import { recordQuickResult } from "@/server/admission-flow";
import { getAdmissionPolicy } from "@/server/admission-policy";

/*
 * Accepting by itself on a pass. When the school turns it on (policy `examAutoAccept`) and every required result is final (approved too, when the
 * school asks for approval) with an average that reaches the pass mark, the applicant is recorded as passed and accepted: the same steps the office
 * would press (`recordQuickResult`), so every rule, notice and hand-off still applies, and a pass leads to Awaiting payment (or straight to Class
 * placement when no fee is asked). It runs with the permissions of the person who reviewed the application, so nobody gains a right they do not
 * hold; if that is not possible, nothing happens and the applicant waits in "Ready for decision" for the office. A result below the pass mark is
 * never decided by itself.
 */
export type AutoOutcome = { done: boolean; reason?: string; landing?: string };

export async function autoDecideFromExams(schoolId: string, applicationId: string, trigger: { userId: string }): Promise<AutoOutcome> {
  const policy = await getAdmissionPolicy(db, schoolId);
  if (!policy.examAutoAccept) return { done: false, reason: "off" };
  const app = await db.application.findFirst({ where: { id: applicationId, schoolId }, select: { id: true, status: true, reviewedById: true, applicationNo: true } });
  if (!app || (app.status !== "APPLIED" && app.status !== "INTERVIEW")) return { done: false, reason: "not open" };
  const sum = await examSummaryOf(db, schoolId, applicationId, policy);
  if (sum.progress.state !== "COMPLETE" || sum.average === null) return { done: false, reason: "results not final or not numeric" };
  if (sum.average < policy.examPassPercent) return { done: false, reason: "below the pass mark" };
  if (!app.reviewedById) return { done: false, reason: "nobody reviewed it" };
  try {
    const ctx = await buildAuthContext(app.reviewedById);
    const r = await recordQuickResult(ctx, applicationId, { outcome: "PASSED", note: `Passed by examination results: average ${sum.average}% (pass mark ${policy.examPassPercent}%).` });
    await db.auditLog.create({ data: { schoolId, actorId: null, actorName: "Automatic rule (examination results)", action: "admission.auto_accept", entityType: "Application", entityId: applicationId, summary: `${app.applicationNo}: average ${sum.average}%, pass mark ${policy.examPassPercent}%`, changes: { average: sum.average, passMark: policy.examPassPercent, landing: r.landing ?? null, madeUnderThePermissionsOf: app.reviewedById, triggeredBy: trigger.userId } } });
    return { done: true, landing: r.landing };
  } catch (e) {
    // The office decides by hand: the reason is shown on the screens as the applicant staying in "Ready for decision".
    if (e instanceof AppError) return { done: false, reason: e.message };
    throw e;
  }
}
