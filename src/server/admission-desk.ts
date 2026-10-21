import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { admissionAccount, assessmentResolved, completeness, docChecklist, interviewState, stageOf, workflowState, WORKFLOW_STATES, type InterviewState, type Stage, type WorkflowState } from "@/lib/admissions/rules";
import { examsAllowDecision, interviewStage, type ExamProgressState, type ExamStatus, type InterviewStage } from "@/lib/admissions/exams";
import { centsOf } from "@/lib/finance/money";
import { examSummaries, type ExamSummary } from "@/server/admission-exams";
import { formatDateOnly, parseDateOnly } from "@/lib/dates";
import type { Table } from "@/lib/export/table";
import { actorOf, writeAudit } from "@/server/audit";
import { assessmentFor, getAdmissionPolicy, requiredDocsFor } from "@/server/admission-policy";
import { assignApplication, reviewApplication, startReview } from "@/server/admission-review";
import { optUuid, parse } from "@/lib/validation";

/*
 * The Admissions Office desk: every application, wherever it came from, in one list with the one status that says where it stands.
 * Online applications appear here by themselves (they are the same records, never copied). Status, interview state, completeness and
 * "needs attention" are worked out from the real records on each load, so the list cannot disagree with the application itself.
 */

export const INTERVIEW_STATES = ["SCHEDULED", "COMPLETED", "WAIVED", "NOT_REQUIRED", "TO_ARRANGE"] as const;
export type AttentionReason = "OLD_UNREVIEWED" | "RESULT_MISSING" | "DOCS_TO_CHECK" | "EXAMS_OUTSTANDING";
const OLD_DAYS = 3;
export const PAGE_SIZE = 25;
export const STAGE_NAMES = ["review", "interview"] as const;

export type DeskFilters = { ivStage?: string; q?: string; state?: string; classId?: string; from?: string; to?: string; interview?: string; assigned?: string; source?: string; attention?: boolean; stage?: string };

export type DeskRow = {
  id: string; applicationNo: string; name: string; classAppliedId: string | null; className: string | null;
  guardianName: string | null; guardianPhone: string | null; submittedAt: Date; source: "ONLINE" | "STAFF";
  state: WorkflowState; interview: InterviewState; interviewAt: Date | null;
  completeness: { percent: number; complete: boolean; missing: string[]; checked: number; required: number };
  assignedToId: string | null; assignedTo: string | null; attention: AttentionReason[]; interviewRequired: boolean;
  /** The live interview (its id), papers still to check, and where an accepted review leads: the interview list, or straight to accepted when nothing is required. */
  interviewId: string | null; pendingDocs: number; afterReview: "interview" | "placement";
  /** The applicant's examinations (teachers, marks, what is outstanding) and where they stand in the interview list. */
  exam: { state: ExamProgressState; total: number; final: number; outstanding: ExamSummary["outstanding"]; lines: { subject: string; teacher: string; status: ExamStatus; mark: number | null; maxMark: number }[] };
  ivStage: InterviewStage | null;
  /** Average of the final examination results as a percentage, once they are all in (null otherwise). */
  examAverage: number | null;
  /** For an accepted applicant: waiting for the school fee to be verified, or ready for registration (papers and the rest). */
  after: "payment" | "registration" | null; decidedAt: Date | null;
};
const NO_EXAM: DeskRow["exam"] = { state: "NONE", total: 0, final: 0, outstanding: [], lines: [] };

const OPEN = ["APPLIED", "INTERVIEW", "ACCEPTED"] as const;
const isUuid = (s: string | undefined): s is string => !!s && /^[0-9a-f-]{36}$/i.test(s);

async function compute(ctx: AuthContext, where: Prisma.ApplicationWhereInput): Promise<DeskRow[]> {
  const now = Date.now();
  const [policy, classes] = await Promise.all([
    getAdmissionPolicy(db, ctx.schoolId),
    db.schoolClass.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true, levelId: true } }),
  ]);
  const apps = await db.application.findMany({
    where: { schoolId: ctx.schoolId, ...where }, orderBy: { createdAt: "desc" },
    select: { id: true, applicationNo: true, firstName: true, middleName: true, lastName: true, status: true, source: true, createdAt: true, classAppliedId: true, guardians: true, reviewStatus: true, docsExceptionAt: true, entryType: true, interviewWaivedAt: true, assignedToId: true, decidedAt: true },
  });
  const openIds = apps.filter((a) => a.status !== "ENROLLED" && a.status !== "REJECTED" && a.status !== "WITHDRAWN").map((a) => a.id);
  const acceptedIds = apps.filter((a) => a.status === "ACCEPTED").map((a) => a.id);
  const [exams, offers, pays] = await Promise.all([
    examSummaries(db, ctx.schoolId, apps.filter((a) => a.status === "APPLIED" || a.status === "INTERVIEW").map((a) => ({ id: a.id, classAppliedId: a.classAppliedId })), policy),
    acceptedIds.length ? db.admissionOffer.findMany({ where: { schoolId: ctx.schoolId, applicationId: { in: acceptedIds } }, select: { applicationId: true, feeAmount: true, paymentWaivedAt: true } }) : [],
    acceptedIds.length ? db.admissionPayment.findMany({ where: { schoolId: ctx.schoolId, applicationId: { in: acceptedIds } }, select: { applicationId: true, status: true, amount: true } }) : [],
  ]);
  const [docs, interviews, people] = await Promise.all([
    openIds.length ? db.document.findMany({ where: { schoolId: ctx.schoolId, applicationId: { in: openIds }, deletedAt: null }, select: { applicationId: true, docType: true, verification: true, id: true } }) : [],
    openIds.length ? db.interview.findMany({ where: { schoolId: ctx.schoolId, applicationId: { in: openIds } }, select: { id: true, applicationId: true, status: true, kind: true, scheduledAt: true } }) : [],
    db.user.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(apps.flatMap((a) => (a.assignedToId ? [a.assignedToId] : [])))] } }, select: { id: true, fullName: true } }),
  ]);
  return apps.map((a) => {
    const g = (a.guardians as { fullName?: string; phone?: string }[])[0] ?? null;
    const cls = classes.find((c) => c.id === a.classAppliedId) ?? null;
    const open = openIds.includes(a.id);
    const myDocs = docs.filter((d) => d.applicationId === a.id);
    const myIv = interviews.filter((i) => i.applicationId === a.id);
    const live = myIv.find((i) => i.status === "SCHEDULED") ?? null;
    const need = assessmentFor(policy, cls?.levelId ?? null);
    const doneI = myIv.some((i) => i.status === "COMPLETED" && (i.kind === "INTERVIEW" || i.kind === "ASSESSMENT"));
    const sum = exams.get(a.id);
    const exam: DeskRow["exam"] = sum ? { state: sum.progress.state, total: sum.progress.total, final: sum.progress.final, outstanding: sum.outstanding, lines: sum.lines.map((l) => ({ subject: l.subject, teacher: l.teacher, status: l.status, mark: l.mark, maxMark: l.maxMark })) } : NO_EXAM;
    // The entrance examination is done when its recorded result exists, or when every subject's result is final.
    const doneE = myIv.some((i) => i.status === "COMPLETED" && i.kind === "ENTRANCE_EXAM") || (exam.state === "COMPLETE" && exam.total > 0);
    const checklist = docChecklist(requiredDocsFor(policy, a.entryType), myDocs.map((d) => ({ id: d.id, docType: d.docType, verification: d.verification })));
    const comp = open ? completeness({ checklist, hasClass: !!a.classAppliedId, hasContact: !!g?.phone }) : { percent: 100, complete: true, missing: [], checked: 0, required: 0 };
    const resolved = assessmentResolved({ needInterview: need.interview, needExam: need.exam, interviewDone: doneI, examDone: doneE, interviewWaived: !!a.interviewWaivedAt });
    const state = workflowState({ status: a.status, review: a.reviewStatus, liveInterview: !!live, assessmentResolved: resolved, interviewHeld: doneI || doneE });
    const attention: AttentionReason[] = [];
    if (open && a.status !== "ACCEPTED") {
      if ((state === "NEW" || state === "UNDER_REVIEW") && now - a.createdAt.getTime() > OLD_DAYS * 86_400_000) attention.push("OLD_UNREVIEWED");
      if (live && live.scheduledAt.getTime() < now) attention.push(examsAllowDecision(exam.state) ? "RESULT_MISSING" : "EXAMS_OUTSTANDING");
      if (myDocs.some((d) => d.verification === "PENDING") && a.reviewStatus !== "VERIFIED") attention.push("DOCS_TO_CHECK");
    }
    // An accepted applicant waits for the school fee when the school asks for it before registration and Finance has not verified enough; otherwise for registration.
    const offer = offers.find((o) => o.applicationId === a.id);
    const account = a.status === "ACCEPTED" && offer ? admissionAccount(centsOf(offer.feeAmount), pays.filter((p) => p.applicationId === a.id).map((p) => ({ status: p.status, amountCents: centsOf(p.amount) })), !!offer.paymentWaivedAt) : null;
    const after: DeskRow["after"] = a.status !== "ACCEPTED" ? null : policy.requirePaymentBeforeEnrol && account && !account.satisfied ? "payment" : "registration";
    return {
      id: a.id, applicationNo: a.applicationNo, name: [a.firstName, a.middleName, a.lastName].filter(Boolean).join(" "), classAppliedId: a.classAppliedId, className: cls?.name ?? null,
      guardianName: g?.fullName ?? null, guardianPhone: g?.phone ?? null, submittedAt: a.createdAt, source: a.source, state,
      interview: interviewState({ live: !!live, completed: doneI, waived: !!a.interviewWaivedAt, required: need.interview }), interviewAt: live?.scheduledAt ?? null,
      interviewId: live?.id ?? null, pendingDocs: myDocs.filter((d) => d.verification === "PENDING").length, afterReview: resolved ? "placement" : "interview",
      completeness: { percent: comp.percent, complete: comp.complete, missing: comp.missing.map((m) => m.key), checked: comp.checked, required: comp.required },
      assignedToId: a.assignedToId, assignedTo: people.find((p) => p.id === a.assignedToId)?.fullName ?? null, attention, interviewRequired: need.interview,
      exam, examAverage: sum?.average ?? null, ivStage: live ? interviewStage({ interviewAt: live.scheduledAt, now, progress: exam.state }) : state === "AWAITING_DECISION" ? "READY" : null, after, decidedAt: a.decidedAt,
    };
  });
}

export type DeskCounts = Record<WorkflowState, number> & { total: number; awaitingInterview: number; attention: number; closed: number; stages: Record<"review" | "interview", number>; iv: Record<InterviewStage, number>; accepted: { payment: number; registration: number } };

function countRows(rows: DeskRow[]): DeskCounts {
  const c = Object.fromEntries(WORKFLOW_STATES.map((s) => [s, rows.filter((r) => r.state === s).length])) as Record<WorkflowState, number>;
  const closed = c.REJECTED + c.WITHDRAWN;
  // "total" is the working list: an application that is finished (rejected, withdrawn or enrolled) leaves it; it is still found under its own status, or by searching.
  const stages = { review: rows.filter((r) => stageOf(r.state) === "review").length, interview: rows.filter((r) => stageOf(r.state) === "interview").length };
  const iv = Object.fromEntries((["SCHEDULED", "EXAMS", "REVIEW", "READY"] as const).map((k) => [k, rows.filter((r) => stageOf(r.state) === "interview" && r.ivStage === k).length])) as Record<InterviewStage, number>;
  const accepted = { payment: rows.filter((r) => r.state === "ACCEPTED" && r.after === "payment").length, registration: rows.filter((r) => r.state === "ACCEPTED" && r.after === "registration").length };
  return { ...c, stages, iv, accepted, total: rows.length - closed - c.ENROLLED, awaitingInterview: rows.filter((r) => r.state === "REVIEWED" && r.interview === "TO_ARRANGE").length, attention: rows.filter((r) => r.attention.length > 0).length, closed };
}

function sqlWhere(ctx: AuthContext, f: DeskFilters): Prisma.ApplicationWhereInput {
  const and: Prisma.ApplicationWhereInput[] = [];
  for (const token of (f.q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 4)) {
    and.push({ OR: [{ firstName: { contains: token, mode: "insensitive" } }, { lastName: { contains: token, mode: "insensitive" } }, { applicationNo: { contains: token, mode: "insensitive" } }] });
  }
  if (isUuid(f.classId)) and.push({ classAppliedId: f.classId });
  const from = f.from ? parseDateOnly(f.from) : null;
  const to = f.to ? parseDateOnly(f.to) : null;
  if (from) and.push({ createdAt: { gte: from } });
  if (to) and.push({ createdAt: { lt: new Date(to.getTime() + 86_400_000) } });
  if (f.source === "ONLINE" || f.source === "STAFF") and.push({ source: f.source });
  if (f.assigned === "me") and.push({ assignedToId: ctx.userId });
  else if (f.assigned === "none") and.push({ assignedToId: null });
  else if (isUuid(f.assigned)) and.push({ assignedToId: f.assigned });
  return and.length ? { AND: and } : {};
}

/** One application as the desk sees it (status, interview state, completeness, who has it). */
export async function deskRow(ctx: AuthContext, id: string): Promise<DeskRow> {
  requirePermission(ctx, "admission.read");
  const [r] = await compute(ctx, { id });
  if (!r) throw notFound("Application");
  return r;
}

/** Every accepted applicant who is not enrolled yet, as the desk sees them (Awaiting payment and Registration are views of these). */
export async function acceptedDesk(ctx: AuthContext): Promise<DeskRow[]> {
  requirePermission(ctx, "admission.read");
  return (await compute(ctx, { status: "ACCEPTED" })).filter((r) => r.state === "ACCEPTED");
}

/** The filters that depend on the worked-out status (the others are applied in the database). */
function applyDerived(rows: DeskRow[], f: DeskFilters): DeskRow[] {
  let r = rows;
  const searching = !!(f.q ?? "").trim();
  if (f.state === "AWAITING_INTERVIEW") r = r.filter((x) => x.state === "REVIEWED" && x.interview === "TO_ARRANGE");
  else if (f.state === "CLOSED") r = r.filter((x) => x.state === "REJECTED" || x.state === "WITHDRAWN");
  else if (f.state === "UNDER_REVIEW") r = r.filter((x) => x.state === "NEW" || x.state === "UNDER_REVIEW" || x.state === "REVIEWED"); // one simple status for everything waiting to be accepted
  else if ((WORKFLOW_STATES as readonly string[]).includes(f.state ?? "")) r = r.filter((x) => x.state === f.state);
  else if (!searching) {
    // Each application is in one list: under review, then the interview, then accepted. Enrolled, declined and withdrawn ones are finished
    // (found under their own status, or by searching). Searching by name or number looks in every list.
    const stage: Stage = (STAGE_NAMES as readonly string[]).includes(f.stage ?? "") ? (f.stage as Stage) : "review";
    r = r.filter((x) => stageOf(x.state) === stage);
  }
  if (["SCHEDULED", "EXAMS", "REVIEW", "READY"].includes(f.ivStage ?? "")) r = r.filter((x) => x.ivStage === f.ivStage);
  if ((INTERVIEW_STATES as readonly string[]).includes(f.interview ?? "")) r = r.filter((x) => x.interview === f.interview);
  if (f.attention) r = r.filter((x) => x.attention.length > 0);
  return r;
}

/** The list for the desk (a page of it), the counts that head it, and the total after every filter. */
export async function loadDesk(ctx: AuthContext, f: DeskFilters, page = 1) {
  requirePermission(ctx, "admission.read");
  const where = sqlWhere(ctx, f);
  const filtered = Object.keys(where).length > 0;
  const all = await compute(ctx, where);
  const everything = filtered ? await compute(ctx, {}) : all;
  const rows = applyDerived(all, f);
  const p = Math.max(1, page);
  return { rows: rows.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE), total: rows.length, page: p, pageSize: PAGE_SIZE, counts: countRows(everything) };
}

// ───────────────────────── Bulk review ─────────────────────────

const bulkSchema = z.object({ action: z.enum(["START_REVIEW", "MARK_REVIEWED", "ASSIGN"]), ids: z.array(z.string().uuid()).min(1, "Select at least one application").max(100, "Select at most 100 applications at a time"), assigneeId: optUuid() });
export type BulkLine = { id: string; applicationNo: string; reason?: string };
export type BulkOutcome = { action: "START_REVIEW" | "MARK_REVIEWED" | "ASSIGN"; done: BulkLine[]; unchanged: BulkLine[]; failed: BulkLine[] };

/**
 * Starts the review of, marks as reviewed, or assigns several applications. Each application is handled on its own (so one that cannot
 * be done does not stop the rest) with the same rules as doing it by hand: an application with missing or unverified papers is never marked
 * reviewed. The result lists what was done, what needed nothing and what could not be done and why. Accepting is never done in bulk.
 */
export async function bulkDesk(ctx: AuthContext, input: unknown): Promise<BulkOutcome> {
  const d = parse(bulkSchema, input);
  requirePermission(ctx, d.action === "ASSIGN" ? "admission.review" : "admission.documents.verify");
  if (d.action === "ASSIGN" && !d.assigneeId) throw new AppError("VALIDATION", "Choose who the applications go to.", { assigneeId: "Required" });
  const apps = await db.application.findMany({ where: { schoolId: ctx.schoolId, id: { in: d.ids } }, select: { id: true, applicationNo: true, reviewStatus: true, status: true } });
  const out: BulkOutcome = { action: d.action, done: [], unchanged: [], failed: [] };
  for (const id of d.ids) {
    const a = apps.find((x) => x.id === id);
    if (!a) { out.failed.push({ id, applicationNo: "?", reason: "Application not found" }); continue; }
    const line = { id, applicationNo: a.applicationNo };
    try {
      if (d.action === "START_REVIEW") (await startReview(ctx, id)).changed ? out.done.push(line) : out.unchanged.push({ ...line, reason: "Already being reviewed or reviewed" });
      else if (d.action === "MARK_REVIEWED") {
        if (a.reviewStatus === "VERIFIED") out.unchanged.push({ ...line, reason: "Already reviewed" });
        else { await reviewApplication(ctx, id, { decision: "VERIFIED" }); out.done.push(line); }
      } else (await assignApplication(ctx, id, d.assigneeId!)).changed ? out.done.push(line) : out.unchanged.push({ ...line, reason: "Already assigned to this person" });
    } catch (e) {
      if (e instanceof AppError) out.failed.push({ ...line, reason: e.message });
      else throw e;
    }
  }
  await db.$transaction((tx) => writeAudit(tx, actorOf(ctx), { action: "admission.bulk_update", entityType: "Application", entityId: out.done[0]?.id ?? d.ids[0]!, summary: `${d.action}: ${out.done.length} done, ${out.unchanged.length} unchanged, ${out.failed.length} not done`, changes: { action: d.action, selected: d.ids.length, done: out.done.map((x) => x.id), failed: out.failed.map((x) => ({ id: x.id, reason: x.reason })), assigneeId: d.assigneeId ?? null } }));
  return out;
}

// ───────────────────────── Export ─────────────────────────

const STATE_LABEL: Record<WorkflowState, string> = { NEW: "New", UNDER_REVIEW: "Under review", NEEDS_INFO: "Needs more information", REVIEWED: "Reviewed", INTERVIEW_SCHEDULED: "Interview scheduled", AWAITING_DECISION: "Awaiting decision", ACCEPTED: "Accepted", ENROLLED: "Enrolled", REJECTED: "Rejected", WITHDRAWN: "Withdrawn" };
const IV_LABEL: Record<InterviewState, string> = { SCHEDULED: "Scheduled", COMPLETED: "Completed", WAIVED: "Not required (recorded)", NOT_REQUIRED: "Not required", TO_ARRANGE: "To arrange" };

/** The same applications as the screen (every page of them, with the same filters), for CSV, Excel or PDF. */
export async function deskTable(ctx: AuthContext, f: DeskFilters): Promise<Table> {
  requirePermission(ctx, "admission.read");
  const rows = applyDerived(await compute(ctx, sqlWhere(ctx, f)), f);
  return {
    title: "Admissions applications", subtitle: `${rows.length} applications`,
    columns: [
      { key: "no", label: "Application no", width: 16 }, { key: "name", label: "Applicant", width: 28 }, { key: "class", label: "Class applied", width: 14 }, { key: "guardian", label: "Parent or guardian", width: 24 }, { key: "phone", label: "Phone", width: 16 },
      { key: "on", label: "Submitted", width: 12 }, { key: "state", label: "Status", width: 22 }, { key: "done", label: "Complete %", width: 10 }, { key: "iv", label: "Interview", width: 20 }, { key: "ivat", label: "Interview date", width: 16 }, { key: "who", label: "Assigned to", width: 20 },
    ],
    rows: rows.map((r) => [r.applicationNo, r.name, r.className ?? "", r.guardianName ?? "", r.guardianPhone ?? "", formatDateOnly(r.submittedAt), STATE_LABEL[r.state], `${r.completeness.percent}`, IV_LABEL[r.interview], r.interviewAt ? r.interviewAt.toISOString().slice(0, 16).replace("T", " ") : "", r.assignedTo ?? ""]),
  };
}
