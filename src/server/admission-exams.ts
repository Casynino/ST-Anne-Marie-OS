import { z } from "zod";
import { db, type Db, type Tx } from "@/lib/db";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { requireAnyPermission, requirePermission, type AuthContext } from "@/lib/auth/context";
import { examAverage, examLabel, examProgress, examsAllowDecision, isFinal, isOpenForMarks, validateMark, type ExamLabel, type ExamProgress, type ExamStatus } from "@/lib/admissions/exams";
import { actorOf, writeAudit } from "@/server/audit";
import { assessmentFor, getAdmissionPolicy, type AdmissionPolicy } from "@/server/admission-policy";
import { closeTasks, openTask } from "@/server/workflow";
import { optDateOnly, optText, parse } from "@/lib/validation";

/*
 * The examinations an applicant sits at an interview. Each subject is one task, marked by one assigned teacher. Assigning is done by the Admissions
 * or Academic Office, marking only by the assigned teacher, and approving or returning a result only by someone who reviews results. The marks never
 * touch the admission decision: they are read by the office, which decides. Every change is written to an append-only history.
 */

type Client = Db | Tx;
const num = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? null : Number(d.toString()));
const MARK_PERMISSION = "admission.exam.mark";

export type ExamLine = {
  id: string; interviewId: string; subjectId: string; subject: string; teacherId: string; teacher: string; status: ExamStatus; maxMark: number;
  /** Marks are shown to the assigned teacher always, and to everybody else only once submitted. */
  mark: number | null; outcome: string | null; comment: string | null; dueOn: Date | null; returnNote: string | null;
};
export type ExamSummary = {
  progress: ExamProgress; lines: ExamLine[]; approval: boolean;
  /** Once every result is final: the average as a percentage, the school's pass mark, whether the average reaches it (null when it cannot be averaged), and whether the school accepts by itself on a pass. */
  average: number | null; passMark: number; passed: boolean | null; autoAccept: boolean;
  /** What is still outstanding, by name, so staff can follow up without opening the record. */
  outstanding: { subject: string; teacher: string | null; why: "NOT_ASSIGNED" | "MARKING" | "REVIEW" }[];
};

/**
 * Subjects that must all have a teacher before a decision. Normally none: the office assigns the teachers it wants and the examination is complete
 * when those teachers have submitted. Only a school that switches on "every usual subject is required" has a list.
 */
function requiredFor(policy: AdmissionPolicy, levelId: string | null): string[] {
  return policy.examRequireAll && assessmentFor(policy, levelId).exam ? policy.examSubjects : [];
}

/** The examination summary of several applications (names resolved), for the desk and the workspace. No permission check: callers check. */
export async function examSummaries(client: Client, schoolId: string, apps: { id: string; classAppliedId: string | null }[], policyIn?: AdmissionPolicy, viewerId?: string): Promise<Map<string, ExamSummary>> {
  const out = new Map<string, ExamSummary>();
  if (apps.length === 0) return out;
  const policy = policyIn ?? (await getAdmissionPolicy(client, schoolId));
  const classIds = [...new Set(apps.map((a) => a.classAppliedId).filter((x): x is string => !!x))];
  const [classes, tasks] = await Promise.all([
    classIds.length ? client.schoolClass.findMany({ where: { schoolId, id: { in: classIds } }, select: { id: true, levelId: true } }) : [],
    client.applicationExam.findMany({ where: { schoolId, applicationId: { in: apps.map((a) => a.id) }, status: { not: "CANCELLED" } }, orderBy: { createdAt: "asc" } }),
  ]);
  const subjectIds = [...new Set([...tasks.map((t) => t.subjectId), ...policy.examSubjects])];
  const [subjects, users] = await Promise.all([
    subjectIds.length ? client.subject.findMany({ where: { schoolId, id: { in: subjectIds } }, select: { id: true, name: true } }) : [],
    tasks.length ? client.user.findMany({ where: { schoolId, id: { in: [...new Set(tasks.map((t) => t.assignedToId))] } }, select: { id: true, fullName: true } }) : [],
  ]);
  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? "?";
  for (const a of apps) {
    const levelId = classes.find((c) => c.id === a.classAppliedId)?.levelId ?? null;
    const mine = tasks.filter((t) => t.applicationId === a.id);
    const progress = examProgress({ requiredSubjectIds: requiredFor(policy, levelId), tasks: mine.map((t) => ({ subjectId: t.subjectId, status: t.status })), approval: policy.examApproval, expectsExam: assessmentFor(policy, levelId).exam });
    const lines: ExamLine[] = mine.map((t) => {
      const visible = t.status === "SUBMITTED" || t.status === "APPROVED" || t.assignedToId === viewerId;
      return {
        id: t.id, interviewId: t.interviewId, subjectId: t.subjectId, subject: subjectName(t.subjectId), teacherId: t.assignedToId, teacher: users.find((u) => u.id === t.assignedToId)?.fullName ?? "?", status: t.status,
        maxMark: num(t.maxMark) ?? 100, mark: visible ? num(t.mark) : null, outcome: visible ? t.outcome : null, comment: visible ? t.comment : null, dueOn: t.dueOn, returnNote: t.returnNote,
      };
    });
    const outstanding: ExamSummary["outstanding"] = [
      ...progress.missingSubjectIds.map((id) => ({ subject: subjectName(id), teacher: null, why: "NOT_ASSIGNED" as const })),
      ...lines.filter((l) => !isFinal(l.status, policy.examApproval)).map((l) => ({ subject: l.subject, teacher: l.teacher, why: l.status === "SUBMITTED" ? ("REVIEW" as const) : ("MARKING" as const) })),
    ];
    const average = progress.state === "COMPLETE" ? examAverage(mine.map((t) => ({ status: t.status, mark: num(t.mark), maxMark: num(t.maxMark) ?? 100 }))) : null;
    out.set(a.id, { progress, lines, approval: policy.examApproval, outstanding, average, passMark: policy.examPassPercent, passed: average === null ? null : average >= policy.examPassPercent, autoAccept: policy.examAutoAccept });
  }
  return out;
}

export async function examSummaryOf(client: Client, schoolId: string, applicationId: string, policyIn?: AdmissionPolicy, viewerId?: string): Promise<ExamSummary> {
  const app = await client.application.findFirst({ where: { id: applicationId, schoolId }, select: { id: true, classAppliedId: true } });
  if (!app) throw notFound("Application");
  return (await examSummaries(client, schoolId, [app], policyIn, viewerId)).get(applicationId)!;
}

/** The sentence that says why a decision has to wait for the examinations (null when it need not). The same words are used on every screen. */
export function examBlock(s: ExamSummary): string | null {
  if (examsAllowDecision(s.progress.state)) return null;
  if (s.outstanding.length === 0) return "No teacher has been assigned to mark the examination yet.";
  const parts = s.outstanding.map((o) => (o.why === "NOT_ASSIGNED" ? `${o.subject} has no teacher yet` : o.why === "REVIEW" ? `${o.subject} is waiting for the Academic Office to approve it` : `${o.subject} is still waiting for marks from ${o.teacher}`));
  return `The examination results are not complete: ${parts.join("; ")}.`;
}

/** Used by every way of recording an interview result or an acceptance: refuses while the examination results are incomplete. */
export async function assertExamsComplete(client: Client, schoolId: string, applicationId: string) {
  const block = examBlock(await examSummaryOf(client, schoolId, applicationId));
  if (block) throw conflict(block);
}

// ───────────────────────── Assigning teachers ─────────────────────────

const assignSchema = z.object({
  subjectId: z.uuid("Choose the subject"),
  teacherId: z.uuid("Choose the teacher"),
  maxMark: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.coerce.number().min(1).max(1000).optional()),
  dueOn: optDateOnly(),
  instructions: optText(600),
});

/** The staff who can mark applicant examinations (an active staff account with a role that allows marking), those who teach the subject first. */
export async function eligibleTeachers(ctx: AuthContext, subjectId?: string) {
  requireAnyPermission(ctx, ["admission.exam.assign", "admission.read"]);
  const [users, teaching] = await Promise.all([
    db.user.findMany({ where: { schoolId: ctx.schoolId, type: "STAFF", status: "ACTIVE", roles: { some: { role: { permissions: { some: { permission: { key: MARK_PERMISSION } } } } }, none: { role: { key: "super_admin" } } } }, select: { id: true, fullName: true, staff: { select: { id: true } } }, orderBy: { fullName: "asc" } }),
    subjectId ? db.subjectTeacher.findMany({ where: { schoolId: ctx.schoolId, subjectId }, select: { staffId: true } }) : [],
  ]);
  const teachingIds = new Set(teaching.map((x) => x.staffId));
  return users.map((u) => ({ id: u.id, name: u.fullName, teachesSubject: !!u.staff && teachingIds.has(u.staff.id) })).sort((a, b) => Number(b.teachesSubject) - Number(a.teachesSubject) || a.name.localeCompare(b.name));
}

/**
 * Assigns a teacher to one subject of an interview. The teacher must have an active staff account, be allowed to mark applicant examinations and,
 * when the school has recorded who teaches the subject, be one of them. Assigning the same teacher again changes nothing; assigning another
 * teacher replaces the first while no result is submitted (the change and who made it are kept in the history).
 */
export async function assignExam(ctx: AuthContext, interviewId: string, input: unknown): Promise<{ id: string; already: boolean }> {
  requirePermission(ctx, "admission.exam.assign");
  const d = parse(assignSchema, input);
  const [iv, subject, teacher, policy] = await Promise.all([
    db.interview.findFirst({ where: { id: interviewId, schoolId: ctx.schoolId }, select: { id: true, applicationId: true, status: true, scheduledAt: true } }),
    db.subject.findFirst({ where: { id: d.subjectId, schoolId: ctx.schoolId, isActive: true }, select: { id: true, name: true } }),
    db.user.findFirst({ where: { id: d.teacherId, schoolId: ctx.schoolId }, select: { id: true, fullName: true, type: true, status: true, staff: { select: { id: true } } } }),
    getAdmissionPolicy(db, ctx.schoolId),
  ]);
  if (!iv) throw notFound("Interview");
  if (iv.status !== "SCHEDULED") throw conflict("Teachers can be assigned only while the interview is still waiting.");
  if (!subject) throw invalid("Please correct the highlighted fields.", { subjectId: "Choose a subject the school teaches" });
  if (!teacher || teacher.type !== "STAFF" || teacher.status !== "ACTIVE") throw invalid("Please correct the highlighted fields.", { teacherId: "Choose a teacher with an active staff account" });
  const allowed = await db.user.count({ where: { id: teacher.id, roles: { some: { role: { permissions: { some: { permission: { key: MARK_PERMISSION } } } } } } } });
  if (!allowed) throw invalid("Please correct the highlighted fields.", { teacherId: `${teacher.fullName} cannot mark applicant examinations` });
  // Who may mark this subject: the teachers recorded for it in the class the applicant applied for; else those recorded for it anywhere this year; else any teacher who may mark.
  const [year, appForClass] = await Promise.all([
    db.academicYear.findFirst({ where: { schoolId: ctx.schoolId, isCurrent: true }, select: { id: true } }),
    db.application.findFirstOrThrow({ where: { id: iv.applicationId, schoolId: ctx.schoolId }, select: { classAppliedId: true } }),
  ]);
  const rows = await db.subjectTeacher.findMany({ where: { schoolId: ctx.schoolId, subjectId: subject.id, ...(year ? { academicYearId: year.id } : {}) }, select: { staffId: true, classId: true } });
  const here = appForClass.classAppliedId ? rows.filter((r) => r.classId === appForClass.classAppliedId) : [];
  const allowedRows = here.length ? here : rows;
  if (allowedRows.length > 0 && !(teacher.staff && allowedRows.some((x) => x.staffId === teacher.staff!.id))) {
    const where = here.length ? ` in ${(await db.schoolClass.findFirst({ where: { id: appForClass.classAppliedId!, schoolId: ctx.schoolId }, select: { name: true } }))?.name ?? "this class"}` : "";
    throw invalid("Please correct the highlighted fields.", { teacherId: `${teacher.fullName} does not teach ${subject.name}${where}` });
  }
  const maxMark = d.maxMark ?? policy.examMaxMark;

  return db.$transaction(async (tx) => {
    const app = await tx.application.findFirstOrThrow({ where: { id: iv.applicationId, schoolId: ctx.schoolId }, select: { id: true, applicationNo: true, firstName: true, lastName: true } });
    const label = `${app.firstName} ${app.lastName} (${app.applicationNo}) · ${subject.name}`;
    const existing = await tx.applicationExam.findFirst({ where: { interviewId, subjectId: subject.id, status: { not: "CANCELLED" } } });
    if (existing) {
      if (existing.assignedToId === teacher.id) return { id: existing.id, already: true };
      if (!isOpenForMarks(existing.status)) throw conflict("This result is already submitted. Return it for correction first, then change the teacher.");
      await tx.applicationExam.update({ where: { id: existing.id }, data: { assignedToId: teacher.id, ...(d.dueOn ? { dueOn: d.dueOn } : {}), ...(d.instructions ? { instructions: d.instructions } : {}) } });
      await tx.applicationExamEvent.create({ data: { schoolId: ctx.schoolId, examId: existing.id, kind: "REASSIGN", byId: ctx.userId, detail: { from: existing.assignedToId, to: teacher.id } } });
      await writeAudit(tx, actorOf(ctx), { action: "admission_exam.reassign", entityType: "ApplicationExam", entityId: existing.id, summary: `${label} → ${teacher.fullName}`, changes: { from: existing.assignedToId, to: teacher.id } });
      return { id: existing.id, already: false };
    }
    const exam = await tx.applicationExam.create({ data: { schoolId: ctx.schoolId, applicationId: app.id, interviewId, subjectId: subject.id, assignedToId: teacher.id, maxMark, dueOn: d.dueOn ?? null, instructions: d.instructions ?? null, createdById: ctx.userId } });
    await tx.applicationExamEvent.create({ data: { schoolId: ctx.schoolId, examId: exam.id, kind: "ASSIGN", byId: ctx.userId, detail: { to: teacher.id, maxMark } } });
    await writeAudit(tx, actorOf(ctx), { action: "admission_exam.assign", entityType: "ApplicationExam", entityId: exam.id, summary: `${label} → ${teacher.fullName}`, changes: { teacherId: teacher.id, subjectId: subject.id, interviewId, maxMark } });
    return { id: exam.id, already: false };
  });
}

/** Withdraws an assignment that has no submitted result (a submitted one is returned for correction instead). Withdrawing it again changes nothing. */
export async function removeExam(ctx: AuthContext, examId: string, reason: string) {
  requirePermission(ctx, "admission.exam.assign");
  const why = parse(z.string().trim().min(1, "Give a reason").max(300), reason);
  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM application_exams WHERE id = ${examId}::uuid AND "schoolId" = ${ctx.schoolId}::uuid FOR UPDATE`;
    if (!rows.length) throw notFound("Examination");
    const e = await tx.applicationExam.findUniqueOrThrow({ where: { id: examId } });
    if (e.status === "CANCELLED") return;
    if (!isOpenForMarks(e.status)) throw conflict("A submitted result cannot be withdrawn. Return it for correction first.");
    await tx.applicationExam.update({ where: { id: e.id }, data: { status: "CANCELLED", cancelReason: why } });
    await tx.applicationExamEvent.create({ data: { schoolId: ctx.schoolId, examId: e.id, kind: "CANCEL", byId: ctx.userId, detail: { reason: why } } });
    await writeAudit(tx, actorOf(ctx), { action: "admission_exam.cancel", entityType: "ApplicationExam", entityId: e.id, summary: why, changes: { teacherId: e.assignedToId } });
  });
}

/** Called when an interview is cancelled: its open assignments are withdrawn (submitted results are kept as they are). */
export async function withdrawOpenExams(tx: Tx, ctx: AuthContext, interviewId: string, reason: string) {
  const open = await tx.applicationExam.findMany({ where: { schoolId: ctx.schoolId, interviewId, status: { in: ["ASSIGNED", "DRAFT", "RETURNED"] } }, select: { id: true, assignedToId: true } });
  for (const e of open) {
    await tx.applicationExam.update({ where: { id: e.id }, data: { status: "CANCELLED", cancelReason: reason } });
    await tx.applicationExamEvent.create({ data: { schoolId: ctx.schoolId, examId: e.id, kind: "CANCEL", byId: ctx.userId, detail: { reason } } });
  }
}

/** Called when an interview moves to a new date (a new row replaces the old one): the assignments follow the applicant to the new interview. */
export async function moveExams(tx: Tx, schoolId: string, fromInterviewId: string, toInterviewId: string) {
  await tx.applicationExam.updateMany({ where: { schoolId, interviewId: fromInterviewId, status: { not: "CANCELLED" } }, data: { interviewId: toInterviewId } });
}

// ───────────────────────── Reading ─────────────────────────

export type ExamRow = {
  id: string; applicationId: string; interviewId: string; applicationNo: string; applicant: string; className: string | null; subject: string; teacherId: string; teacher: string;
  interviewAt: Date; venue: string | null; dueOn: Date | null; status: ExamStatus; label: ExamLabel; maxMark: number; mark: number | null; outcome: string | null; mine: boolean;
};

/** Who sees which tasks: a teacher who only marks sees their own; the offices that assign, review or read admissions see all. */
function seesAll(ctx: AuthContext) {
  return ctx.permissions.has("admission.exam.review") || ctx.permissions.has("admission.exam.assign") || ctx.permissions.has("admission.read");
}

type ExamWithRefs = Awaited<ReturnType<typeof loadExams>>[number];
function loadExams(ctx: AuthContext, where: Record<string, unknown>) {
  return db.applicationExam.findMany({
    where: { schoolId: ctx.schoolId, ...where }, orderBy: [{ createdAt: "desc" }], take: 300,
    include: { application: { select: { applicationNo: true, firstName: true, lastName: true, classAppliedId: true } }, interview: { select: { scheduledAt: true, location: true } }, subject: { select: { name: true } } },
  });
}

async function toRows(ctx: AuthContext, list: ExamWithRefs[], approval: boolean): Promise<ExamRow[]> {
  const [users, classes] = await Promise.all([
    db.user.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(list.map((e) => e.assignedToId))] } }, select: { id: true, fullName: true } }),
    db.schoolClass.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(list.map((e) => e.application.classAppliedId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } }),
  ]);
  const now = Date.now();
  return list.map((e) => {
    const mine = e.assignedToId === ctx.userId;
    const visible = mine || e.status === "SUBMITTED" || e.status === "APPROVED";
    return {
      id: e.id, applicationId: e.applicationId, interviewId: e.interviewId, applicationNo: e.application.applicationNo, applicant: `${e.application.firstName} ${e.application.lastName}`, className: classes.find((c) => c.id === e.application.classAppliedId)?.name ?? null,
      subject: e.subject.name, teacherId: e.assignedToId, teacher: users.find((u) => u.id === e.assignedToId)?.fullName ?? "?", interviewAt: e.interview.scheduledAt, venue: e.interview.location, dueOn: e.dueOn, status: e.status,
      label: examLabel(e.status, e.interview.scheduledAt, now, approval), maxMark: num(e.maxMark) ?? 100, mark: visible ? num(e.mark) : null, outcome: visible ? e.outcome : null, mine,
    };
  });
}

export async function listExams(ctx: AuthContext, opts: { view?: "open" | "review" | "all" } = {}): Promise<{ rows: ExamRow[]; approval: boolean; all: boolean }> {
  requireAnyPermission(ctx, ["admission.exam.mark", "admission.exam.review", "admission.exam.assign", "admission.read"]);
  const all = seesAll(ctx);
  const policy = await getAdmissionPolicy(db, ctx.schoolId);
  const list = await loadExams(ctx, { status: opts.view === "review" ? "SUBMITTED" : { not: "CANCELLED" }, ...(all ? {} : { assignedToId: ctx.userId }) });
  const rows = await toRows(ctx, list, policy.examApproval);
  return { rows: opts.view === "open" ? rows.filter((r) => !isFinal(r.status, policy.examApproval)) : rows, approval: policy.examApproval, all };
}

export type ExamDetail = ExamRow & {
  instructions: string | null; comment: string | null; returnNote: string | null; outcomes: string[];
  canMark: boolean; markBlocked: string | null; canReview: boolean; canRemove: boolean;
  history: { kind: string; by: string; at: Date; detail: unknown }[];
};

/** One task. A teacher who is not assigned to it, and has no reviewing or admissions role, gets "not found". */
export async function getExam(ctx: AuthContext, id: string): Promise<ExamDetail> {
  requireAnyPermission(ctx, ["admission.exam.mark", "admission.exam.review", "admission.exam.assign", "admission.read"]);
  const [found] = await loadExams(ctx, { id });
  if (!found || (found.assignedToId !== ctx.userId && !seesAll(ctx))) throw notFound("Examination");
  const [policy, events, iv] = await Promise.all([
    getAdmissionPolicy(db, ctx.schoolId),
    db.applicationExamEvent.findMany({ where: { schoolId: ctx.schoolId, examId: id }, orderBy: { createdAt: "asc" } }),
    db.interview.findUniqueOrThrow({ where: { id: found.interviewId }, select: { status: true } }),
  ]);
  const [row] = await toRows(ctx, [found], policy.examApproval);
  const by = await db.user.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(events.map((x) => x.byId))] } }, select: { id: true, fullName: true } });
  const mine = found.assignedToId === ctx.userId;
  const visible = mine || found.status === "SUBMITTED" || found.status === "APPROVED";
  const started = found.interview.scheduledAt.getTime() <= Date.now();
  const open = isOpenForMarks(found.status);
  return {
    ...row!, instructions: found.instructions, comment: visible ? found.comment : null, returnNote: found.returnNote, outcomes: policy.examOutcomes,
    canMark: mine && ctx.permissions.has(MARK_PERMISSION) && open && started && iv.status !== "CANCELLED", markBlocked: mine && open && !started ? "The examination has not taken place yet." : null,
    canReview: ctx.permissions.has("admission.exam.review") && (found.status === "SUBMITTED" || found.status === "APPROVED"), canRemove: ctx.permissions.has("admission.exam.assign") && open,
    history: events.map((x) => ({ kind: x.kind, by: by.find((u) => u.id === x.byId)?.fullName ?? "?", at: x.createdAt, detail: x.detail })),
  };
}

/** The sidebar badge: tasks waiting for me to mark, or (for a reviewer) results waiting for approval. */
export async function countExamWork(ctx: AuthContext): Promise<number> {
  const policy = await getAdmissionPolicy(db, ctx.schoolId);
  const [mine, review] = await Promise.all([
    ctx.permissions.has(MARK_PERMISSION) ? db.applicationExam.count({ where: { schoolId: ctx.schoolId, assignedToId: ctx.userId, status: { in: ["ASSIGNED", "DRAFT", "RETURNED"] }, interview: { scheduledAt: { lte: new Date() } } } }) : 0,
    ctx.permissions.has("admission.exam.review") && policy.examApproval ? db.applicationExam.count({ where: { schoolId: ctx.schoolId, status: "SUBMITTED" } }) : 0,
  ]);
  return mine + review;
}

// ───────────────────────── Marking ─────────────────────────

const markSchema = z.object({
  mark: z.union([z.string(), z.number()]).optional(),
  outcome: z.string().trim().max(60).optional(),
  comment: optText(1000),
  submit: z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.boolean()),
});

/**
 * The assigned teacher saves marks (a draft) or submits the result. A mark is checked against the maximum of that examination; a non-numeric
 * outcome only if the school configured it. A submitted result can be changed only after the Academic Office returns it for correction.
 */
export async function saveExamMarks(ctx: AuthContext, examId: string, input: unknown): Promise<{ status: ExamStatus; complete: boolean }> {
  requirePermission(ctx, MARK_PERMISSION);
  const d = parse(markSchema, input);
  const policy = await getAdmissionPolicy(db, ctx.schoolId);
  const out = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM application_exams WHERE id = ${examId}::uuid AND "schoolId" = ${ctx.schoolId}::uuid FOR UPDATE`;
    if (!rows.length) throw notFound("Examination");
    const e = await tx.applicationExam.findUniqueOrThrow({ where: { id: examId }, include: { interview: { select: { scheduledAt: true, status: true } }, subject: { select: { name: true } }, application: { select: { id: true, applicationNo: true, firstName: true, lastName: true, status: true, classAppliedId: true } } } });
    if (e.assignedToId !== ctx.userId) throw forbidden("This examination is assigned to another teacher.");
    if (!isOpenForMarks(e.status)) throw conflict("This result is already submitted. Ask the Academic Office to return it for correction.");
    if (e.interview.status === "CANCELLED") throw conflict("The interview was cancelled.");
    if (e.interview.scheduledAt.getTime() > Date.now()) throw conflict("The examination has not taken place yet.");
    if (e.application.status === "ACCEPTED" || e.application.status === "ENROLLED" || e.application.status === "REJECTED" || e.application.status === "WITHDRAWN") throw conflict("A decision has already been made on this applicant.");
    const max = num(e.maxMark) ?? 100;
    const blank = (d.mark === undefined || String(d.mark).trim() === "") && !d.outcome;
    let mark: number | null = null, outcome: string | null = null;
    if (!(blank && !d.submit)) {
      const v = validateMark({ mark: d.mark === undefined ? "" : String(d.mark), outcome: d.outcome ?? "", max, outcomes: policy.examOutcomes });
      if (!v.ok) throw invalid("Please correct the highlighted fields.", { [v.field]: v.message });
      mark = v.mark; outcome = v.outcome;
    }
    if (blank && !d.submit && !d.comment) throw invalid("Please correct the highlighted fields.", { mark: "Enter the mark" });
    const status: ExamStatus = d.submit ? "SUBMITTED" : "DRAFT";
    const before = { mark: num(e.mark), outcome: e.outcome, status: e.status };
    await tx.applicationExam.update({ where: { id: e.id }, data: { mark, outcome, comment: d.comment ?? null, status, returnNote: d.submit ? null : e.returnNote, ...(d.submit ? { submittedAt: new Date(), submittedById: ctx.userId, reviewedAt: null, reviewedById: null } : {}) } });
    await tx.applicationExamEvent.create({ data: { schoolId: ctx.schoolId, examId: e.id, kind: d.submit ? "SUBMIT" : "SAVE", byId: ctx.userId, detail: { before, after: { mark, outcome, status } } } });
    await writeAudit(tx, actorOf(ctx), { action: d.submit ? "admission_exam.submit" : "admission_exam.save", entityType: "ApplicationExam", entityId: e.id, summary: `${e.application.firstName} ${e.application.lastName} (${e.application.applicationNo}) · ${e.subject.name}`, changes: { before, after: { mark, outcome, status } } });
    let complete = false;
    if (d.submit) complete = await afterSubmit(tx, ctx, policy, e.application, e.id, e.interviewId, await tx.applicationExamEvent.count({ where: { examId: e.id, kind: "SUBMIT" } }));
    return { status, complete, applicationId: e.application.id };
  });
  // The marks are saved either way; accepting by itself on a pass is a separate step that never undoes them.
  if (d.submit && out.complete) await autoAfterResults(ctx.schoolId, out.applicationId, ctx.userId);
  return { status: out.status, complete: out.complete };
}

/** After a result is submitted: leave the review task for the Academic Office (when the school wants approval) and tell Admissions when every result is in. */
async function afterSubmit(tx: Tx, ctx: AuthContext, policy: AdmissionPolicy, app: { id: string; applicationNo: string; firstName: string; lastName: string; classAppliedId: string | null }, examId: string, interviewId: string, round: number): Promise<boolean> {
  const label = `${app.firstName} ${app.lastName} (${app.applicationNo})`;
  if (policy.examApproval) await openTask(tx, { schoolId: ctx.schoolId, kind: "EXAM_REVIEW", relatedType: "Application", relatedId: app.id, relatedLabel: label, sourceEvent: "admission_exam.submitted", createdById: ctx.userId, discriminator: `r${round}:${examId}` }); // a result sent back and submitted again is a new piece of review work
  return notifyIfComplete(tx, ctx, policy, app, interviewId);
}

async function notifyIfComplete(tx: Tx, ctx: AuthContext, policy: AdmissionPolicy, app: { id: string; applicationNo: string; firstName: string; lastName: string; classAppliedId: string | null }, interviewId: string): Promise<boolean> {
  const s = await examSummaryOf(tx, ctx.schoolId, app.id, policy);
  if (s.progress.state !== "COMPLETE") return false;
  await openTask(tx, { schoolId: ctx.schoolId, kind: "DECISION_REVIEW", relatedType: "Application", relatedId: app.id, relatedLabel: `${app.firstName} ${app.lastName} (${app.applicationNo})`, sourceEvent: "admission_exam.complete", createdById: ctx.userId, discriminator: `exams-${interviewId}` });
  return true;
}

const reviewSchema = z.object({ decision: z.enum(["APPROVE", "RETURN"]), note: optText(500) });

/**
 * The Academic Office approves a submitted result, or returns it to the teacher with a note (the only way a submitted or approved result changes).
 * Approving is done by someone other than the teacher who submitted it. Nothing changes once the applicant's admission decision has been made.
 */
export async function reviewExam(ctx: AuthContext, examId: string, input: unknown): Promise<{ status: ExamStatus; already: boolean }> {
  requirePermission(ctx, "admission.exam.review");
  const d = parse(reviewSchema, input);
  if (d.decision === "RETURN" && !d.note) throw invalid("Please correct the highlighted fields.", { note: "Say what the teacher should correct" });
  const policy = await getAdmissionPolicy(db, ctx.schoolId);
  const out = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM application_exams WHERE id = ${examId}::uuid AND "schoolId" = ${ctx.schoolId}::uuid FOR UPDATE`;
    if (!rows.length) throw notFound("Examination");
    const e = await tx.applicationExam.findUniqueOrThrow({ where: { id: examId }, include: { subject: { select: { name: true } }, application: { select: { id: true, applicationNo: true, firstName: true, lastName: true, status: true, classAppliedId: true } } } });
    const label = `${e.application.firstName} ${e.application.lastName} (${e.application.applicationNo}) · ${e.subject.name}`;
    if (d.decision === "APPROVE") {
      if (e.status === "APPROVED") return { status: e.status, already: true, applicationId: e.application.id, approved: false };
      if (e.status !== "SUBMITTED") throw conflict("Only a submitted result can be approved.");
      if (e.submittedById === ctx.userId) throw conflict("A result must be approved by someone other than the teacher who submitted it.");
      await tx.applicationExam.update({ where: { id: e.id }, data: { status: "APPROVED", reviewedAt: new Date(), reviewedById: ctx.userId } });
      await tx.applicationExamEvent.create({ data: { schoolId: ctx.schoolId, examId: e.id, kind: "APPROVE", byId: ctx.userId, detail: { mark: num(e.mark), outcome: e.outcome } } });
      await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Application", relatedId: e.application.id, kinds: ["EXAM_REVIEW"], discriminator: e.id, by: ctx.userId, note: "Approved" });
      await writeAudit(tx, actorOf(ctx), { action: "admission_exam.approve", entityType: "ApplicationExam", entityId: e.id, summary: label, changes: { mark: num(e.mark), outcome: e.outcome } });
      await notifyIfComplete(tx, ctx, policy, e.application, e.interviewId);
      return { status: "APPROVED" as ExamStatus, already: false, applicationId: e.application.id, approved: true };
    }
    if (e.status !== "SUBMITTED" && e.status !== "APPROVED") throw conflict("Only a submitted or approved result can be returned.");
    if (e.application.status === "ACCEPTED" || e.application.status === "ENROLLED" || e.application.status === "REJECTED" || e.application.status === "WITHDRAWN") throw conflict("A decision has already been made on this applicant, so the result cannot be changed.");
    await tx.applicationExam.update({ where: { id: e.id }, data: { status: "RETURNED", returnNote: d.note ?? null, reviewedAt: new Date(), reviewedById: ctx.userId } });
    await tx.applicationExamEvent.create({ data: { schoolId: ctx.schoolId, examId: e.id, kind: "RETURN", byId: ctx.userId, detail: { note: d.note, mark: num(e.mark), outcome: e.outcome, was: e.status } } });
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Application", relatedId: e.application.id, kinds: ["EXAM_REVIEW"], discriminator: e.id, by: ctx.userId, note: "Returned to the teacher", status: "CANCELLED" });
    await writeAudit(tx, actorOf(ctx), { action: "admission_exam.return", entityType: "ApplicationExam", entityId: e.id, summary: label, changes: { was: e.status, mark: num(e.mark), outcome: e.outcome }, reason: d.note });
    return { status: "RETURNED" as ExamStatus, already: false, applicationId: e.application.id, approved: false };
  });
  // The last approval can complete the results: accepting by itself on a pass is a separate step after the approval is saved.
  if (out.approved && !out.already) await autoAfterResults(ctx.schoolId, out.applicationId, ctx.userId);
  return { status: out.status, already: out.already };
}

/** After results are final the school may accept the applicant by itself on a pass (see `admission-auto.ts`). Best effort: a failure here never undoes a saved result. */
async function autoAfterResults(schoolId: string, applicationId: string, triggeredById: string) {
  try {
    const { autoDecideFromExams } = await import("@/server/admission-auto");
    await autoDecideFromExams(schoolId, applicationId, { userId: triggeredById });
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "auto_decision_failed", applicationId, error: e instanceof Error ? e.message : String(e) }));
  }
}
