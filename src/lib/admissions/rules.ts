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
