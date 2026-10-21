import { db } from "@/lib/db";
import { conflict, invalid } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { zonedToUtc } from "@/lib/dates";
import { deskRow } from "@/server/admission-desk";
import { acceptApplication } from "@/server/admission-offers";
import { reviewApplication, verifyDocument } from "@/server/admission-review";
import { getInterviewDays } from "@/server/interview-days";
import { recordInterviewResult, scheduleInterview } from "@/server/interviews";

/*
 * The steps an application takes from the desk, each one a short action on its row. An application is first under review: Accept sends it on
 * to the interview list (or straight to accepted when the school asks for no interview), Decline closes it. In the interview list it is given
 * a date (some already came with one), the result is recorded after the interview, and Accept then puts it in the accepted list. Every step
 * calls the same services as the full application page, so each rule still applies.
 */

/**
 * Accepting an application that is under review: the papers are confirmed in order and the application goes on. When the school asks for no
 * interview or entrance examination it is accepted at once (the offer is made with the school's defaults); otherwise it goes to the interview
 * list. Papers still waiting to be checked are checked here only when the person says they have looked at them.
 */
export async function acceptReview(ctx: AuthContext, applicationId: string, input: { papersChecked?: boolean } = {}): Promise<{ state: string; already: boolean }> {
  requirePermission(ctx, "admission.documents.verify");
  const row = await deskRow(ctx, applicationId);
  if (row.state !== "NEW" && row.state !== "UNDER_REVIEW") return { state: row.state, already: true };
  if (row.pendingDocs > 0) {
    if (!input.papersChecked) throw invalid("Please correct the highlighted fields.", { papersChecked: "Tick that you have checked the papers" });
    const pending = await db.document.findMany({ where: { schoolId: ctx.schoolId, applicationId, deletedAt: null, verification: "PENDING" }, select: { id: true } });
    for (const d of pending) await verifyDocument(ctx, d.id, { status: "VERIFIED" });
  }
  await reviewApplication(ctx, applicationId, { decision: "VERIFIED" });
  let after = await deskRow(ctx, applicationId);
  if (after.state === "AWAITING_DECISION" && ctx.permissions.has("admission.review")) {
    await acceptApplication(ctx, applicationId, {});
    after = await deskRow(ctx, applicationId);
  }
  return { state: after.state, already: false };
}

/**
 * Gives the applicant an interview date: one of the interview days the school set (a place is taken on it and the day's venue is used), or
 * another date and time. The date is a local time in the school's zone, "YYYY-MM-DDTHH:MM".
 */
export async function giveInterviewDate(ctx: AuthContext, applicationId: string, scheduledAt: string) {
  requirePermission(ctx, "admission.interview.manage");
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { timezone: true } });
  const at = zonedToUtc(scheduledAt, school.timezone);
  if (!at) throw invalid("Please correct the highlighted fields.", { scheduledAt: "Choose a date and time" });
  const day = (await getInterviewDays(db, ctx.schoolId)).find((d) => `${d.on}T${d.time}` === scheduledAt);
  if (day && day.capacity > 0) {
    const taken = await db.interview.count({ where: { schoolId: ctx.schoolId, status: "SCHEDULED", kind: "INTERVIEW", scheduledAt: at } });
    if (taken >= day.capacity) throw conflict("This interview day is full. Choose another day.");
  }
  await scheduleInterview(ctx, applicationId, { scheduledAt, ...(day ? { location: day.venue || undefined, allowSharedSlot: "on" } : {}) });
}

/** Records the result of the applicant's interview (it has to have taken place). It admits or rejects nobody: the decision is the next step. */
export async function recordQuickResult(ctx: AuthContext, applicationId: string, input: { outcome?: string; note?: string }) {
  requirePermission(ctx, "admission.interview.manage");
  if (input.outcome !== "PASSED" && input.outcome !== "NOT_PASSED") throw invalid("Please correct the highlighted fields.", { outcome: "Choose the result" });
  const iv = await db.interview.findFirst({ where: { schoolId: ctx.schoolId, applicationId, status: "SCHEDULED", kind: "INTERVIEW" }, orderBy: { scheduledAt: "asc" }, select: { id: true } });
  if (!iv) throw conflict("There is no interview waiting for a result.");
  await recordInterviewResult(ctx, iv.id, { status: "COMPLETED", outcome: input.outcome, notes: input.note });
}
