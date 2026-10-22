/*
 * Pure rules for the examinations an applicant sits at an interview (no database). Each subject is a task marked by one assigned teacher.
 * Whether the results are complete, and where the applicant stands in the interview list, are worked out from the tasks and the
 * interview time every time, so no second status can contradict them.
 */

export type ExamStatus = "ASSIGNED" | "DRAFT" | "SUBMITTED" | "RETURNED" | "APPROVED" | "CANCELLED";
export type ExamLike = { subjectId: string; status: ExamStatus };

/** A result is final once it is submitted, or, when the school asks the Academic Office to approve results, once it is approved. */
export const isFinal = (status: ExamStatus, approval: boolean) => (approval ? status === "APPROVED" : status === "SUBMITTED" || status === "APPROVED");

/** A teacher may enter or change marks only while the task is open: not yet submitted, or returned for correction. */
export const isOpenForMarks = (status: ExamStatus) => status === "ASSIGNED" || status === "DRAFT" || status === "RETURNED";

export type ExamProgressState = "NONE" | "NOT_ASSIGNED" | "INCOMPLETE" | "AWAITING_REVIEW" | "COMPLETE";

/**
 * Where the applicant's examinations stand.
 *  NONE            nothing is required and nothing is assigned
 *  NOT_ASSIGNED    a required subject has no teacher yet
 *  INCOMPLETE      a result is still missing (not marked, saved but not submitted, or returned)
 *  AWAITING_REVIEW every result is in but the Academic Office has not approved all of them (only when the school asks for approval)
 *  COMPLETE        every required result is final
 */
export function examProgress(a: { requiredSubjectIds: readonly string[]; tasks: readonly ExamLike[]; approval: boolean; /** The school expects an entrance examination for this applicant: with no teacher assigned at all it is NOT_ASSIGNED, not NONE. */ expectsExam?: boolean }) {
  const live = a.tasks.filter((t) => t.status !== "CANCELLED");
  const missing = a.requiredSubjectIds.filter((id) => !live.some((t) => t.subjectId === id));
  const open = live.filter((t) => !isFinal(t.status, a.approval));
  let state: ExamProgressState;
  if (a.requiredSubjectIds.length === 0 && live.length === 0) state = a.expectsExam ? "NOT_ASSIGNED" : "NONE";
  else if (missing.length > 0) state = "NOT_ASSIGNED";
  else if (open.length === 0) state = "COMPLETE";
  else if (open.every((t) => t.status === "SUBMITTED")) state = "AWAITING_REVIEW";
  else state = "INCOMPLETE";
  return { state, total: live.length, final: live.length - open.length, missingSubjectIds: missing, openSubjectIds: open.map((t) => t.subjectId), waitingReviewSubjectIds: open.filter((t) => t.status === "SUBMITTED").map((t) => t.subjectId) };
}
export type ExamProgress = ReturnType<typeof examProgress>;

/** A decision on the applicant needs the results to be in: complete, or nothing to wait for. */
export const examsAllowDecision = (state: ExamProgressState) => state === "NONE" || state === "COMPLETE";

/** Where an applicant in the interview list stands: the interview is still ahead, results are being collected, being reviewed, or all in. */
export type InterviewStage = "SCHEDULED" | "EXAMS" | "REVIEW" | "READY";
export function interviewStage(a: { interviewAt: Date | null; now: number; progress: ExamProgressState }): InterviewStage {
  if (a.interviewAt && a.interviewAt.getTime() > a.now) return "SCHEDULED";
  if (a.progress === "AWAITING_REVIEW") return "REVIEW";
  if (examsAllowDecision(a.progress)) return "READY";
  return "EXAMS";
}

/** What one task is called on screen, from its status and the interview time (the interview has not happened yet, or it has and marking is due). */
export type ExamLabel = "SCHEDULED" | "AWAITING_MARKING" | "MARKING" | "SUBMITTED" | "AWAITING_REVIEW" | "RETURNED" | "APPROVED" | "CANCELLED";
export function examLabel(status: ExamStatus, interviewAt: Date | null, now: number, approval: boolean): ExamLabel {
  switch (status) {
    case "ASSIGNED": return interviewAt && interviewAt.getTime() > now ? "SCHEDULED" : "AWAITING_MARKING";
    case "DRAFT": return "MARKING";
    case "SUBMITTED": return approval ? "AWAITING_REVIEW" : "SUBMITTED";
    case "RETURNED": return "RETURNED";
    case "APPROVED": return "APPROVED";
    default: return "CANCELLED";
  }
}

export type MarkInput = { mark?: string | null; outcome?: string | null; max: number; outcomes: readonly string[] };
export type MarkResult = { ok: true; mark: number | null; outcome: string | null } | { ok: false; field: "mark" | "outcome"; message: string };

/**
 * A mark is a number from 0 up to the maximum of that examination (at most two decimals); 85 out of 100 is fine, 120 out of 100 is refused.
 * A non-numeric result is accepted only when the school has configured that outcome. A mark and an outcome together are not allowed:
 * the result is one or the other.
 */
export function validateMark(i: MarkInput): MarkResult {
  const raw = (i.mark ?? "").toString().trim().replace(",", ".");
  const outcome = (i.outcome ?? "").trim();
  if (raw && outcome) return { ok: false, field: "outcome", message: "Give a mark or an outcome, not both" };
  if (outcome) {
    if (!i.outcomes.includes(outcome)) return { ok: false, field: "outcome", message: "Choose one of the outcomes the school has set" };
    return { ok: true, mark: null, outcome };
  }
  if (!raw) return { ok: false, field: "mark", message: "Enter the mark" };
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(raw)) return { ok: false, field: "mark", message: "Enter a number such as 85 or 72.5" };
  const n = Number(raw);
  if (n > i.max) return { ok: false, field: "mark", message: `The mark cannot be more than ${i.max}` };
  return { ok: true, mark: n, outcome: null };
}

/**
 * The applicant's average over their live examinations, as a percentage of each maximum (one decimal). null when there is nothing to average
 * or any examination has no numeric mark (a non-numeric outcome cannot be averaged, so the office decides by hand).
 */
export function examAverage(tasks: readonly { status: ExamStatus; mark: number | null; maxMark: number }[]): number | null {
  const live = tasks.filter((t) => t.status !== "CANCELLED");
  if (live.length === 0 || live.some((t) => t.mark === null || t.maxMark <= 0)) return null;
  const pct = live.reduce((n, t) => n + (t.mark! / t.maxMark) * 100, 0) / live.length;
  return Math.round(pct * 10) / 10;
}

export type TeacherRecord = { id: string; inClass: readonly string[]; anywhere: readonly string[] };

/**
 * Which teachers to offer for a subject: the ones recorded as teaching it in the class the applicant applied for; when the school recorded none
 * for that class, the ones who teach it anywhere; when it recorded nobody for the subject, every teacher who may mark. The server applies the
 * same order when it checks an assignment.
 */
export function teachersFor(subjectId: string, teachers: readonly TeacherRecord[]): { tier: "CLASS" | "SUBJECT" | "ANY"; ids: string[] } {
  const here = teachers.filter((t) => t.inClass.includes(subjectId));
  if (here.length) return { tier: "CLASS", ids: here.map((t) => t.id) };
  const any = teachers.filter((t) => t.anywhere.includes(subjectId));
  if (any.length) return { tier: "SUBJECT", ids: any.map((t) => t.id) };
  return { tier: "ANY", ids: teachers.map((t) => t.id) };
}
