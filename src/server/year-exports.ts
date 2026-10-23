import type { AuthContext } from "@/lib/auth/context";
import type { Table } from "@/lib/export/table";
import { formatDateOnly } from "@/lib/dates";
import { returningBoard, type ReturningFilter } from "@/server/annual-registration";
import { progressionBoard, type ProgressionFilter } from "@/server/progression";
import { annualFeeBoard, type FeeFilter } from "@/server/annual-fees";
import { yearReport } from "@/server/year-report";

/*
 * The next-year progress as downloadable reports (Excel, PDF, CSV). Each table is built from the same board as its screen, with the same permission,
 * the same filters and every row (not just the page on screen), so a download can never show more than the screen. Money columns appear only for
 * people who may read fees. Labels are plain English, like the other downloads.
 */

const major = (cents: number | null) => (cents === null ? null : cents / 100);
const DECISION: Record<string, string> = { PROMOTED: "Moving up", REPEAT: "Repeating", PENDING_REVIEW: "Pending review", COMPLETED: "Finished school", WITHDRAWN: "Withdrawn", TRANSFERRED: "Transferred" };
const REGISTRATION: Record<string, string> = { PENDING: "Not registered yet", REGISTERED: "Registered", ACTIVE: "In the class", CANCELLED: "Cancelled" };
const STAGE: Record<string, string> = { NEEDS_PLACEMENT: "Choose the grade and stream", NEEDS_REGISTRATION: "Confirm the registration", READY_TO_ACTIVATE: "Put in the class", NEEDS_FEE: "Waiting for fees", WAITING_YEAR_OPEN: "Waiting for the year to start", ACTIVE: "In the class", NOT_RETURNING: "Not returning" };
const FEES: Record<string, string> = { CLEARED: "Cleared", CLEARED_EXCEPTION: "Arrangement agreed", OUTSTANDING: "Owing", NOT_BILLED: "Not billed" };
const DECISION_STATUS: Record<string, string> = { DRAFT: "Draft", AWAITING_HEAD: "Waiting for the Head Teacher", APPROVED: "Approved" };
const FOLLOW: Record<string, string> = { WILL_RETURN: "Will register", NOT_RETURNING: "Not returning", NO_ANSWER: "No answer", OTHER: "Other" };

/** Returning students and where each one is: decision, placement, registration, next step, fees and the last contact with the family. */
export async function registrationTable(ctx: AuthContext, f: ReturningFilter): Promise<Table> {
  const b = await returningBoard(ctx, { ...f, all: true });
  const money = ctx.permissions.has("fees.read");
  return {
    title: "Next year registration", subtitle: b.year ? `${b.year.name} · ${b.rows.length} students` : undefined,
    columns: [
      { key: "adm", label: "Student ID", width: 16 }, { key: "name", label: "Name", width: 28 }, { key: "from", label: "This year's grade", width: 16 }, { key: "dec", label: "Decision", width: 14 },
      { key: "to", label: "Moving to", width: 16 }, { key: "placed", label: "Placed in", width: 18 }, { key: "reg", label: "Registration", width: 18 }, { key: "next", label: "What is next", width: 28 },
      { key: "fees", label: "Fees", width: 16 },
      ...(money ? [{ key: "owed", label: "First term owed", kind: "money" as const, width: 16 }, { key: "older", label: "Older years owed", kind: "money" as const, width: 16 }] : []),
      { key: "follow", label: "Last contact with the family", width: 36 }, { key: "on", label: "Registered on", width: 14 },
    ],
    rows: b.rows.map((r) => [
      r.admissionNo, r.name, r.fromClassName, DECISION[r.outcome] ?? r.outcome, r.outcome === "REPEAT" ? r.fromClassName : r.decidedClassName, r.className ? `${r.className}${r.streamName ? ` ${r.streamName}` : ""}` : "",
      REGISTRATION[r.status] ?? r.status, STAGE[r.stage] ?? r.stage, FEES[r.clearance] ?? r.clearance,
      ...(money ? [major(r.firstTermOutstanding), major(r.previousOutstanding)] : []),
      r.followUp ? `${FOLLOW[r.followUp.outcome] ?? r.followUp.outcome} · ${formatDateOnly(r.followUp.at)}${r.followUp.note ? ` · ${r.followUp.note}` : ""}` : "", r.registeredAt ? formatDateOnly(r.registeredAt) : "",
    ]),
  };
}

/** The Academic Office's end-of-year decisions for every student: results, decision, status and whether they are registered for next year. */
export async function progressionTable(ctx: AuthContext, f: ProgressionFilter): Promise<Table> {
  const b = await progressionBoard(ctx, { ...f, all: true });
  return {
    title: "End of year decisions", subtitle: b.year ? `${b.year.name}${b.nextYear ? ` to ${b.nextYear.name}` : ""} · ${b.rows.length} students` : undefined,
    columns: [
      { key: "adm", label: "Student ID", width: 16 }, { key: "name", label: "Name", width: 28 }, { key: "class", label: "Grade", width: 16 }, { key: "res", label: "Results", width: 22 }, { key: "avg", label: "Average", kind: "percent", width: 10 },
      { key: "dec", label: "Decision", width: 14 }, { key: "st", label: "Decision status", width: 24 }, { key: "to", label: "Moving to", width: 16 }, { key: "reg", label: "Registered for next year", width: 24 }, { key: "note", label: "Note", width: 36 },
    ],
    rows: b.rows.map((r) => [
      r.admissionNo, r.name, `${r.className}${r.streamName ? ` ${r.streamName}` : ""}`,
      r.completion.state === "COMPLETE" ? "Complete" : r.completion.state === "NO_EXAMS" ? "No examinations" : `Incomplete (${r.completion.scored} of ${r.completion.required})`,
      r.completion.average === null ? null : Math.round(r.completion.average * 10) / 10,
      r.decision ? DECISION[r.decision.outcome] ?? r.decision.outcome : "No decision yet", r.decision ? DECISION_STATUS[r.decision.status] ?? r.decision.status : "",
      r.decision?.toClassName ?? "", r.registration ? REGISTRATION[r.registration] ?? r.registration : "", r.decision?.note ?? "",
    ]),
  };
}

/** What each returning student is billed for next year, what is paid and owed, and the older-year debt on its own column. Needs fee access. */
export async function annualFeesTable(ctx: AuthContext, f: FeeFilter): Promise<Table> {
  const b = await annualFeeBoard(ctx, { ...f, all: true });
  return {
    title: "Next year fees", subtitle: b.year ? `${b.year.name} · ${b.rows.length} students` : undefined,
    columns: [
      { key: "adm", label: "Student ID", width: 16 }, { key: "name", label: "Name", width: 28 }, { key: "class", label: "Grade", width: 18 }, { key: "dec", label: "Decision", width: 14 }, { key: "reg", label: "Registration", width: 18 },
      { key: "fb", label: "First term billed", kind: "money", width: 16 }, { key: "fp", label: "First term paid", kind: "money", width: 16 }, { key: "fo", label: "First term owed", kind: "money", width: 16 },
      { key: "yb", label: "Year billed", kind: "money", width: 14 }, { key: "yp", label: "Year paid", kind: "money", width: 14 }, { key: "yo", label: "Year owed", kind: "money", width: 14 },
      { key: "old", label: "Older years owed", kind: "money", width: 16 }, { key: "state", label: "Fees", width: 18 }, { key: "arr", label: "Arrangement", width: 30 },
    ],
    rows: b.rows.map((r) => [
      r.admissionNo, r.name, `${r.className ?? ""}${r.streamName ? ` ${r.streamName}` : ""}`.trim(), DECISION[r.outcome] ?? r.outcome, REGISTRATION[r.status] ?? r.status,
      major(r.firstTerm.charged), major(r.firstTerm.paid), major(r.firstTerm.outstanding), major(r.year.charged), major(r.year.paid), major(r.year.outstanding), major(r.previousOutstanding),
      FEES[r.state] ?? r.state, r.exceptionReason ?? "",
    ]),
    footnote: "Money in the school's currency. Older years are shown on their own and are not part of next year's figures.",
  };
}

/** The progress report on one page: every number of the "Next year" panel, for the groups the person may see. */
export async function yearSummaryTable(ctx: AuthContext): Promise<Table> {
  const r = await yearReport(ctx);
  const rows: [string, string, string | number][] = [];
  if (r?.academic) rows.push(["Academic decisions", "Students to decide", r.academic.students], ["Academic decisions", "Approved to move up", r.academic.promoted], ["Academic decisions", "Approved to repeat", r.academic.repeat], ["Academic decisions", "Waiting for results", r.academic.awaitingResults], ["Academic decisions", "Waiting for a decision", r.academic.awaitingDecision], ["Academic decisions", "Decision to review", r.academic.toReview]);
  if (r?.admissions) rows.push(["Registration", "Eligible to register", r.admissions.eligible], ["Registration", "Registered", r.admissions.registered], ["Registration", "Awaiting payment", r.admissions.awaitingPayment], ["Registration", "Awaiting registration approval", r.admissions.awaitingApproval], ["Registration", "Awaiting a class", r.admissions.awaitingClass], ["Registration", "Not registered yet", r.admissions.notRegistered], ["Registration", "Approved to repeat", r.admissions.repeat], ["Registration", "Waiting for the Academic Office", r.admissions.undecided]);
  if (r?.finance) {
    const m = (c: number) => (c / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
    rows.push(["Fees", "Expected for the year", m(r.finance.expected)], ["Fees", "First instalments required", r.finance.initialRequired === null ? "Not set" : m(r.finance.initialRequired)], ["Fees", "Collected", m(r.finance.collected)], ["Fees", "First instalment verified", `${r.finance.verified} of ${r.finance.students}`], ["Fees", "Still owed", m(r.finance.outstanding)], ["Fees", "Owed from earlier years", m(r.finance.older)], ["Fees", "Not billed yet", r.finance.notBilled], ["Fees", "Payments waiting in reconciliation", r.finance.awaitingReconciliation]);
  }
  return { title: "Next year progress", subtitle: r?.yearName, columns: [{ key: "g", label: "Area", width: 22 }, { key: "f", label: "Figure", width: 38 }, { key: "v", label: "Value", width: 18 }], rows };
}
