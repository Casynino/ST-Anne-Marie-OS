/*
 * Pure rules of the admissions workflow (no database): the document checklist, the admission-payment account and interview overlaps.
 * The services load the records and call these, so the same answer shows on every screen and is enforced by the same code.
 */

export type DocState = "MISSING" | "PENDING" | "VERIFIED" | "NEEDS_CORRECTION";
export type DocLike = { id: string; docType: string; verification: "PENDING" | "VERIFIED" | "NEEDS_CORRECTION" };

/** One row per required document type. A verified copy wins; otherwise a copy waiting for review; otherwise one that needs correction; otherwise missing. */
export function docChecklist(required: readonly string[], docs: readonly DocLike[]): { docType: string; state: DocState; documentId: string | null }[] {
  return required.map((docType) => {
    const mine = docs.filter((d) => d.docType === docType);
    const pick = mine.find((d) => d.verification === "VERIFIED") ?? mine.find((d) => d.verification === "PENDING") ?? mine.find((d) => d.verification === "NEEDS_CORRECTION");
    return { docType, state: (pick?.verification ?? "MISSING") as DocState, documentId: pick?.id ?? null };
  });
}
export const docsComplete = (list: { state: DocState }[]) => list.every((x) => x.state === "VERIFIED");

export type AccountStatus = "NOT_REQUIRED" | "AWAITING_PAYMENT" | "VERIFICATION_PENDING" | "PARTIAL" | "PAID" | "WAIVED";
export type PaymentLike = { status: "PENDING" | "VERIFIED" | "REJECTED" | "REVERSED"; amountCents: number };

/**
 * What an applicant owes and has paid for admission. Only VERIFIED payments count as paid; PENDING ones are shown separately and never
 * make the applicant eligible. A recorded waiver (an authorised exception) satisfies the requirement without any payment.
 */
export function admissionAccount(requiredCents: number, payments: readonly PaymentLike[], waived: boolean) {
  const verified = payments.filter((p) => p.status === "VERIFIED").reduce((n, p) => n + p.amountCents, 0);
  const pending = payments.filter((p) => p.status === "PENDING").reduce((n, p) => n + p.amountCents, 0);
  const balance = Math.max(0, requiredCents - verified);
  const satisfied = requiredCents <= 0 || verified >= requiredCents || waived;
  let status: AccountStatus;
  if (requiredCents <= 0) status = "NOT_REQUIRED";
  else if (verified >= requiredCents) status = "PAID";
  else if (waived) status = "WAIVED";
  else if (verified > 0) status = "PARTIAL";
  else if (pending > 0) status = "VERIFICATION_PENDING";
  else status = "AWAITING_PAYMENT";
  return { requiredCents, verifiedCents: verified, pendingCents: pending, balanceCents: balance, waived, satisfied, status };
}

export type Slot = { start: Date; minutes: number };
/** Two appointments overlap when each starts before the other ends. Touching end-to-start is fine. */
export function slotsOverlap(a: Slot, b: Slot): boolean {
  const aEnd = a.start.getTime() + a.minutes * 60_000;
  const bEnd = b.start.getTime() + b.minutes * 60_000;
  return a.start.getTime() < bEnd && b.start.getTime() < aEnd;
}

// ───────────────────────── The admissions desk: one status for an application, interview state, completeness ─────────────────────────

export type ReviewState = "PENDING" | "IN_REVIEW" | "VERIFIED" | "RETURNED";
export type AppStatus = "APPLIED" | "INTERVIEW" | "ACCEPTED" | "ENROLLED" | "REJECTED" | "WITHDRAWN";

/** The single status the Admissions Office sees. It is worked out from the records (status, review, interviews), never stored, so it cannot contradict them. */
export const WORKFLOW_STATES = ["NEW", "UNDER_REVIEW", "NEEDS_INFO", "REVIEWED", "INTERVIEW_SCHEDULED", "AWAITING_DECISION", "ACCEPTED", "ENROLLED", "REJECTED", "WITHDRAWN"] as const;
export type WorkflowState = (typeof WORKFLOW_STATES)[number];

export function workflowState(a: { status: AppStatus; review: ReviewState; liveInterview: boolean; assessmentResolved: boolean }): WorkflowState {
  if (a.status === "ACCEPTED" || a.status === "ENROLLED" || a.status === "REJECTED" || a.status === "WITHDRAWN") return a.status;
  if (a.review === "RETURNED") return "NEEDS_INFO";
  // An application is reviewed first (accepted or declined); only then does it go on to the interview. A date that came with the application
  // (an interview day set in advance) does not skip the review: it shows in the Interview column while the application is still under review.
  if (a.review !== "VERIFIED") return a.review === "IN_REVIEW" ? "UNDER_REVIEW" : "NEW";
  if (a.liveInterview) return "INTERVIEW_SCHEDULED";
  return a.assessmentResolved ? "AWAITING_DECISION" : "REVIEWED";
}

/** The three lists an application moves through: under review, then the interview, then accepted (enrolled and closed ones are finished). */
export type Stage = "review" | "interview" | "accepted" | "enrolled" | "closed";
export const STAGES = ["review", "interview", "accepted"] as const;
export function stageOf(state: WorkflowState): Stage {
  switch (state) {
    case "NEW": case "UNDER_REVIEW": case "NEEDS_INFO": return "review";
    case "REVIEWED": case "INTERVIEW_SCHEDULED": case "AWAITING_DECISION": return "interview";
    case "ACCEPTED": return "accepted";
    case "ENROLLED": return "enrolled";
    default: return "closed";
  }
}

export type InterviewState = "SCHEDULED" | "COMPLETED" | "WAIVED" | "NOT_REQUIRED" | "TO_ARRANGE";

/**
 * Where the interview stands for an application. A live appointment wins; then a completed interview; then a recorded "not required";
 * then the school's own policy (nothing required = not required); otherwise it still has to be arranged.
 */
export function interviewState(a: { live: boolean; completed: boolean; waived: boolean; required: boolean }): InterviewState {
  if (a.live) return "SCHEDULED";
  if (a.completed) return "COMPLETED";
  if (a.waived) return "WAIVED";
  return a.required ? "TO_ARRANGE" : "NOT_REQUIRED";
}

/**
 * Whether what the school requires before a decision has happened: the interview (done, or recorded as not required, or not required by policy)
 * and the entrance examination (done, or not required). A result of any kind counts as done; the decision itself is a separate step.
 */
export function assessmentResolved(a: { needInterview: boolean; needExam: boolean; interviewDone: boolean; examDone: boolean; interviewWaived: boolean }): boolean {
  return (!a.needInterview || a.interviewDone || a.interviewWaived) && (!a.needExam || a.examDone);
}

/** How complete an application is: every required paper provided (and not marked for correction), the class applied for, and a contact phone. */
export function completeness(a: { checklist: { docType: string; state: DocState }[]; hasClass: boolean; hasContact: boolean }) {
  const items: { key: string; label: string; ok: boolean }[] = [
    ...a.checklist.map((c) => ({ key: `doc:${c.docType}`, label: c.docType, ok: c.state === "VERIFIED" || c.state === "PENDING" })),
    { key: "class", label: "CLASS", ok: a.hasClass },
    { key: "contact", label: "CONTACT", ok: a.hasContact },
  ];
  const done = items.filter((i) => i.ok).length;
  return { percent: Math.round((done / items.length) * 100), complete: done === items.length, missing: items.filter((i) => !i.ok), checked: a.checklist.filter((c) => c.state === "VERIFIED").length, required: a.checklist.length };
}

/** How far an application has got on the road received, reviewed, interview, decision, enrolled (0 to 5 steps done; a closed one shows none). */
export const WORKFLOW_STEPS = 5;
export function workflowProgress(state: WorkflowState): number {
  switch (state) {
    case "NEW": case "UNDER_REVIEW": case "NEEDS_INFO": return 1;
    case "REVIEWED": case "INTERVIEW_SCHEDULED": return 2;
    case "AWAITING_DECISION": return 3;
    case "ACCEPTED": return 4;
    case "ENROLLED": return 5;
    default: return 0;
  }
}
