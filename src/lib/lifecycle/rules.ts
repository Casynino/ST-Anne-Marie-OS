/*
 * Pure rules of a student's years at school (no database): which grade follows which, whether the examinations of a year are complete, what
 * fee clearance means, how a class is filled, and who has to act next for a returning student. The services load the records and call these,
 * so every screen shows the same answer and the same rules are enforced where the data is written.
 */

// ───────────────────────── Grades ─────────────────────────

export type GradeClass = { id: string; name: string; levelSort: number; sortOrder: number; nextClassId: string | null; isFinalGrade: boolean };

/** The school's grades in order: by level, then by class. This is the order a promoted student follows unless a class names its own next grade. */
export function orderClasses<T extends GradeClass>(classes: readonly T[]): T[] {
  return [...classes].sort((a, b) => a.levelSort - b.levelSort || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export type NextGrade = { kind: "NEXT"; classId: string } | { kind: "FINAL" };

/**
 * Where a student who passes this grade goes: the grade the class names, else the next class in the school's order. A class marked as the final
 * grade, or the last class in the order, completes school: there is no next grade to invent.
 */
export function nextGrade(cls: GradeClass, classes: readonly GradeClass[]): NextGrade {
  if (cls.isFinalGrade) return { kind: "FINAL" };
  if (cls.nextClassId && classes.some((c) => c.id === cls.nextClassId)) return { kind: "NEXT", classId: cls.nextClassId };
  const ordered = orderClasses(classes);
  const at = ordered.findIndex((c) => c.id === cls.id);
  const next = at >= 0 ? ordered[at + 1] : undefined;
  return next ? { kind: "NEXT", classId: next.id } : { kind: "FINAL" };
}

// ───────────────────────── Examinations of a year ─────────────────────────

export type RequiredUnit = { examSubjectId: string; label: string; unit: "LOCKED" | "OPEN" | "NONE" };
export type YearMark = { status: string; percent: number | null };
export type ExamCompletion = { state: "COMPLETE" | "INCOMPLETE" | "NO_EXAMS"; missing: string[]; average: number | null; scored: number; required: number };

/**
 * Whether a student's examinations of the year are complete: every examined subject of their class has its results finalized (locked) and the
 * student has a result for it (a mark, or an explicit absent or exempt). Nothing examined at all is not "complete": it needs the Academic Office.
 */
export function examCompletion(required: readonly RequiredUnit[], marks: ReadonlyMap<string, YearMark>): ExamCompletion {
  if (required.length === 0) return { state: "NO_EXAMS", missing: [], average: null, scored: 0, required: 0 };
  const missing: string[] = [];
  const percents: number[] = [];
  for (const r of required) {
    const m = marks.get(r.examSubjectId);
    if (r.unit !== "LOCKED") missing.push(`${r.label} (results not finalized)`);
    else if (!m) missing.push(`${r.label} (no result)`);
    else if (m.percent !== null) percents.push(m.percent);
  }
  const average = percents.length ? Math.round((percents.reduce((n, x) => n + x, 0) / percents.length) * 10) / 10 : null;
  return { state: missing.length ? "INCOMPLETE" : "COMPLETE", missing, average, scored: percents.length, required: required.length };
}

export type PromotionSignal = "NOT_READY" | "READY" | "ELIGIBLE" | "BELOW";

/**
 * A hint for the Academic Office, never a decision. Results not complete: not ready. Complete and the school configured no promotion average:
 * ready for the office to decide. With a configured average: eligible or below it. The system never promotes or repeats anyone by itself.
 */
export function promotionSignal(c: ExamCompletion, minAverage: number | null): PromotionSignal {
  if (c.state !== "COMPLETE") return "NOT_READY";
  if (minAverage === null) return "READY";
  return c.average !== null && c.average >= minAverage ? "ELIGIBLE" : "BELOW";
}

// ───────────────────────── Fee clearance for a year ─────────────────────────

export type ClearanceState = "CLEARED" | "CLEARED_EXCEPTION" | "OUTSTANDING" | "NOT_BILLED";

/**
 * Whether the fee condition for a year is met, from verified money only: the year's required invoice exists and what is still owed on the year's
 * invoices is within the limit the school allows. Debt from earlier years counts only when the school says so; it is always shown separately.
 * An approved arrangement (recorded by Finance, with a reason) treats the condition as met without changing any balance.
 */
export function clearanceState(a: { billed: boolean; currentOutstanding: number; previousOutstanding: number; maxOutstanding: number; previousCounts: boolean; exception: boolean }): ClearanceState {
  if (a.exception) return "CLEARED_EXCEPTION";
  if (!a.billed) return "NOT_BILLED";
  const currentOk = a.currentOutstanding <= a.maxOutstanding;
  const previousOk = !a.previousCounts || a.previousOutstanding <= a.maxOutstanding;
  return currentOk && previousOk ? "CLEARED" : "OUTSTANDING";
}
export const isCleared = (s: ClearanceState) => s === "CLEARED" || s === "CLEARED_EXCEPTION";

// ───────────────────────── Filling a class ─────────────────────────

/** Places left in a class. null = no limit. Places reserved for returning students count the same as students already in the class. */
export function placesLeft(capacity: number | null, inClass: number, reserved: number): number | null {
  return capacity === null ? null : Math.max(0, capacity - inClass - reserved);
}

/** The stream to suggest for a class: the one with the fewest students (the first one when they are equal), so classes fill evenly. */
export function recommendStream(streams: readonly { id: string; count: number }[]): string | null {
  if (streams.length === 0) return null;
  return [...streams].sort((a, b) => a.count - b.count)[0]!.id;
}

// ───────────────────────── Who acts next ─────────────────────────

export type FeePolicy = "INFORM_ONLY" | "BLOCK_REGISTRATION" | "BLOCK_ACTIVATION";
export type Department = "ACADEMIC" | "HEAD" | "ADMISSIONS" | "FINANCE" | "NONE";
export type NextStage = "ACADEMIC_REVIEW" | "HEAD_APPROVAL" | "NEEDS_REGISTRATION_RECORD" | "NEEDS_PLACEMENT" | "NEEDS_REGISTRATION" | "NEEDS_FEE" | "READY_TO_ACTIVATE" | "WAITING_YEAR_OPEN" | "ACTIVE" | "COMPLETED" | "LEFT" | "NOT_RETURNING";

/**
 * The current responsible department and the next action for a student returning to a year. Academic, administrative and financial conditions
 * are separate: unpaid fees never undo a decision or a placement, they only hold back the step the school's policy says they hold back.
 */
export function nextStep(a: {
  outcome: string | null; decision: "NONE" | "DRAFT" | "AWAITING_HEAD" | "APPROVED"; registration: "NONE" | "PENDING" | "REGISTERED" | "ACTIVE" | "CANCELLED";
  placed: boolean; clearance: ClearanceState; feePolicy: FeePolicy; yearOpen: boolean;
}): { stage: NextStage; department: Department; blocked: boolean } {
  if (a.registration === "ACTIVE") return { stage: "ACTIVE", department: "NONE", blocked: false };
  if (a.registration === "CANCELLED") return { stage: "NOT_RETURNING", department: "NONE", blocked: false };
  if (a.decision === "APPROVED" && a.outcome === "COMPLETED") return { stage: "COMPLETED", department: "NONE", blocked: false };
  if (a.decision === "APPROVED" && (a.outcome === "WITHDRAWN" || a.outcome === "TRANSFERRED")) return { stage: "LEFT", department: "NONE", blocked: false };
  if (a.decision === "AWAITING_HEAD") return { stage: "HEAD_APPROVAL", department: "HEAD", blocked: true };
  if (a.decision !== "APPROVED" || a.outcome === "PENDING_REVIEW") return { stage: "ACADEMIC_REVIEW", department: "ACADEMIC", blocked: true };
  if (a.registration === "NONE") return { stage: "NEEDS_REGISTRATION_RECORD", department: "ADMISSIONS", blocked: false };
  const cleared = isCleared(a.clearance);
  if (a.registration === "PENDING") {
    if (!a.placed) return { stage: "NEEDS_PLACEMENT", department: "ADMISSIONS", blocked: false };
    if (a.feePolicy === "BLOCK_REGISTRATION" && !cleared) return { stage: "NEEDS_FEE", department: "FINANCE", blocked: true };
    return { stage: "NEEDS_REGISTRATION", department: "ADMISSIONS", blocked: false };
  }
  // REGISTERED: placed and registered, waiting to join the roster
  if (a.feePolicy === "BLOCK_ACTIVATION" && !cleared) return { stage: "NEEDS_FEE", department: "FINANCE", blocked: true };
  if (!a.yearOpen) return { stage: "WAITING_YEAR_OPEN", department: "NONE", blocked: false };
  return { stage: "READY_TO_ACTIVATE", department: "ADMISSIONS", blocked: false };
}
