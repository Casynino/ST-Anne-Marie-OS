import { db } from "@/lib/db";
import { AppError, conflict, invalid } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { zonedToUtc } from "@/lib/dates";
import { deskRow } from "@/server/admission-desk";
import { enrolApplication } from "@/server/admissions";
import { acceptApplication } from "@/server/admission-offers";
import { reviewApplication, verifyDocument } from "@/server/admission-review";
import { getInterviewDays } from "@/server/interview-days";
import { recordInterviewResult, scheduleInterview } from "@/server/interviews";

/*
 * The steps an application takes from the desk, each one a short action on its row. An application that arrives with an interview date goes
 * straight to the interview list. One without a date waits under review (the office talks it over, often with the Academic Office); accepting
 * it means choosing its interview date, and it then moves to the interview list. After the interview the result is recorded: a pass accepts the
 * applicant and enrols them at once (a student record with no class yet), so they wait in Class placement, and they leave the list when a class
 * is given. Declining closes the application. Nothing is paid at this stage. Every step calls the same services as the full application page,
 * so each rule still applies.
 */

export type Landing = "placement" | "accepted" | "approval" | "blocked";

/**
 * Accepts the applicant (the offer, with the school's defaults) and enrols them at once, without a class, so they appear in Class placement.
 * When the enrolment cannot go ahead (the offer waits for approval, the person may not enrol, or a duplicate needs a look) the applicant stays
 * accepted and the reason is returned. With `strict`, a refusal is raised instead of returned. Pressing it again changes nothing.
 */
export async function acceptAndEnrol(ctx: AuthContext, applicationId: string, opts: { strict?: boolean } = {}): Promise<{ landing: Landing; note?: string }> {
  let r: Awaited<ReturnType<typeof acceptApplication>>;
  try {
    r = await acceptApplication(ctx, applicationId, {});
  } catch (e) {
    if (!opts.strict && e instanceof AppError && (e.code === "CONFLICT" || e.code === "VALIDATION")) return { landing: "blocked", note: e.message };
    throw e;
  }
  if (r.status === "PENDING_APPROVAL") return { landing: "approval" };
  if (!ctx.permissions.has("student.enroll")) return { landing: "accepted" };
  try {
    await enrolApplication(ctx, applicationId, {});
    return { landing: "placement" };
  } catch (e) {
    if (e instanceof AppError && (e.code === "CONFLICT" || e.code === "VALIDATION")) return { landing: "accepted", note: e.message };
    throw e;
  }
}

/** Enrols an accepted applicant (no class yet): the applicant then waits in Class placement. */
export async function enrolNow(ctx: AuthContext, applicationId: string) {
  requirePermission(ctx, "student.enroll");
  await enrolApplication(ctx, applicationId, {});
}

/** Checks the papers and passes the review. Papers still waiting to be checked are checked only when the person says they have looked at them. */
async function confirmPapers(ctx: AuthContext, applicationId: string, papersChecked: boolean) {
  requirePermission(ctx, "admission.documents.verify");
  const pending = await db.document.findMany({ where: { schoolId: ctx.schoolId, applicationId, deletedAt: null, verification: "PENDING" }, select: { id: true } });
  if (pending.length > 0) {
    if (!papersChecked) throw invalid("Please correct the highlighted fields.", { papersChecked: "Tick that you have checked the papers" });
    for (const d of pending) await verifyDocument(ctx, d.id, { status: "VERIFIED" });
  }
  const app = await db.application.findFirst({ where: { id: applicationId, schoolId: ctx.schoolId }, select: { reviewStatus: true } });
  if (app?.reviewStatus !== "VERIFIED") await reviewApplication(ctx, applicationId, { decision: "VERIFIED" });
}

/** A date for an interview must be in the future and, when it is one of the school's interview days, have room. Returns the day's venue. */
async function checkInterviewDate(ctx: AuthContext, scheduledAt: string): Promise<{ venue: string | undefined; onDay: boolean }> {
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { timezone: true } });
  const at = zonedToUtc(scheduledAt, school.timezone);
  if (!at) throw invalid("Please correct the highlighted fields.", { scheduledAt: "Choose the interview date and time" });
  if (at.getTime() < Date.now()) throw invalid("Please correct the highlighted fields.", { scheduledAt: "Choose a time that has not passed" });
  const day = (await getInterviewDays(db, ctx.schoolId)).find((d) => `${d.on}T${d.time}` === scheduledAt);
  if (day && day.capacity > 0) {
    const taken = await db.interview.count({ where: { schoolId: ctx.schoolId, status: "SCHEDULED", kind: "INTERVIEW", scheduledAt: at } });
    if (taken >= day.capacity) throw conflict("This interview day is full. Choose another day.");
  }
  return { venue: day?.venue || undefined, onDay: !!day };
}

/**
 * Gives the applicant an interview date: one of the interview days the school set (a place is taken on it and the day's venue is used), or
 * another date and time. The date is a local time in the school's zone, "YYYY-MM-DDTHH:MM".
 */
export async function giveInterviewDate(ctx: AuthContext, applicationId: string, scheduledAt: string) {
  requirePermission(ctx, "admission.interview.manage");
  const d = await checkInterviewDate(ctx, scheduledAt);
  // An interview day is a group session: its hall and its interviewer are shared by design, so the room clash is confirmed.
  await scheduleInterview(ctx, applicationId, { scheduledAt, ...(d.onDay ? { location: d.venue, allowSharedSlot: "on", confirmLocationClash: "on" } : {}) });
}

/**
 * Accepting an application that is under review (it has no interview date yet): the papers are confirmed in order and, when the school asks
 * for an interview, its date is chosen now and the application moves to the interview list. When the school asks for no interview or entrance
 * examination, the applicant is accepted and enrolled at once and goes to Class placement.
 */
export async function acceptReview(ctx: AuthContext, applicationId: string, input: { papersChecked?: boolean; scheduledAt?: string } = {}): Promise<{ state: string; already: boolean; landing?: Landing; note?: string }> {
  requirePermission(ctx, "admission.documents.verify");
  const row = await deskRow(ctx, applicationId);
  if (row.state !== "NEW" && row.state !== "UNDER_REVIEW") return { state: row.state, already: true };
  const toInterview = row.afterReview === "interview";
  if (toInterview) {
    if (!input.scheduledAt) throw invalid("Please correct the highlighted fields.", { scheduledAt: "Choose the interview date" });
    requirePermission(ctx, "admission.interview.manage");
    await checkInterviewDate(ctx, input.scheduledAt); // refused before anything is changed
  }
  await confirmPapers(ctx, applicationId, !!input.papersChecked);
  if (toInterview) {
    await giveInterviewDate(ctx, applicationId, input.scheduledAt!);
    return { state: (await deskRow(ctx, applicationId)).state, already: false };
  }
  let after = await deskRow(ctx, applicationId);
  let landed: { landing: Landing; note?: string } | null = null;
  if (after.state === "AWAITING_DECISION" && ctx.permissions.has("admission.review")) {
    landed = await acceptAndEnrol(ctx, applicationId);
    after = await deskRow(ctx, applicationId);
  }
  return { state: after.state, already: false, ...(landed ?? {}) };
}

/**
 * Records the result of the applicant's interview (it has to have taken place). A pass accepts the applicant and enrols them at once (when this
 * person may decide), so they wait in Class placement; any other result leaves the decision to the office. Papers still waiting to be checked
 * (an applicant who came with an interview date was not reviewed first) are checked on a pass only when the person says they have looked at them.
 */
export async function recordQuickResult(ctx: AuthContext, applicationId: string, input: { outcome?: string; note?: string; papersChecked?: boolean }): Promise<{ passed: boolean; landing?: Landing; note?: string }> {
  requirePermission(ctx, "admission.interview.manage");
  if (input.outcome !== "PASSED" && input.outcome !== "NOT_PASSED") throw invalid("Please correct the highlighted fields.", { outcome: "Choose the result" });
  const passed = input.outcome === "PASSED";
  const row = await deskRow(ctx, applicationId);
  if (passed && row.pendingDocs > 0 && !input.papersChecked && ctx.permissions.has("admission.review") && ctx.permissions.has("admission.documents.verify")) {
    throw invalid("Please correct the highlighted fields.", { papersChecked: "Tick that you have checked the papers" });
  }
  const iv = await db.interview.findFirst({ where: { schoolId: ctx.schoolId, applicationId, status: "SCHEDULED", kind: "INTERVIEW" }, orderBy: { scheduledAt: "asc" }, select: { id: true } });
  if (!iv) throw conflict("There is no interview waiting for a result.");
  await recordInterviewResult(ctx, iv.id, { status: "COMPLETED", outcome: input.outcome, notes: input.note });
  if (!passed) return { passed: false };
  if (!ctx.permissions.has("admission.review")) return { passed: true };
  try {
    const app = await db.application.findFirst({ where: { id: applicationId, schoolId: ctx.schoolId }, select: { reviewStatus: true } });
    if (app?.reviewStatus !== "VERIFIED") {
      if (!ctx.permissions.has("admission.documents.verify")) return { passed: true };
      await confirmPapers(ctx, applicationId, !!input.papersChecked);
    }
    return { passed: true, ...(await acceptAndEnrol(ctx, applicationId)) };
  } catch (e) {
    // The result is saved; what stops the acceptance (for example a missing paper) is shown and the application stays in the interview list.
    if (e instanceof AppError && (e.code === "CONFLICT" || e.code === "VALIDATION")) return { passed: true, landing: "blocked", note: e.message };
    throw e;
  }
}

/**
 * Sends an application that is under review back to the family because information or papers are missing or wrong. The note says what to add;
 * the family is told (in its account, or by phone when it has none) and the application waits as "needs more information" until they send it
 * again. An incomplete application cannot be accepted: it is sent back.
 */
export async function sendBack(ctx: AuthContext, applicationId: string, note: string | undefined): Promise<{ told: "account" | "phone" }> {
  requirePermission(ctx, "admission.documents.verify");
  const row = await deskRow(ctx, applicationId);
  if (row.state !== "NEW" && row.state !== "UNDER_REVIEW") throw conflict("Only an application under review can be sent back.");
  await reviewApplication(ctx, applicationId, { decision: "RETURNED", note });
  const n = await db.applicationNotice.findFirst({ where: { schoolId: ctx.schoolId, applicationId, kind: "INFO_NEEDED" }, orderBy: { createdAt: "desc" }, select: { status: true } });
  return { told: n?.status === "SENT_IN_APP" ? "account" : "phone" };
}

