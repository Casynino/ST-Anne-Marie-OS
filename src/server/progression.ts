import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { AppError, conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { parseDateOnly } from "@/lib/dates";
import { checkDecision, orderClasses, nextGrade, promotionSignal, LEAVING_OUTCOMES, MOVING_OUTCOMES, type ExamCompletion, type Outcome, type PromotionSignal } from "@/lib/lifecycle/rules";
import { actorOf, writeAudit } from "@/server/audit";
import { schoolToday } from "@/server/balances";
import { ensureRegistrationTx, releaseRegistrationTx } from "@/server/annual-registration";
import { examCompletions, loadGrades, loadYears, yearAfter, type Grade } from "@/server/lifecycle-data";
import { getLifecycleSettings, type LifecycleSettings } from "@/server/lifecycle-settings";
import { applyStatusChangeTx } from "@/server/students";
import { optText, optUuid, parse, uuid } from "@/lib/validation";

/*
 * End-of-year progression: the Academic Office decides, for every student, where they go next year (or that they finished or left). A decision is
 * its own record: it is not a class assignment and not a registration. It is prepared (draft), approved (and by the Head Teacher where the school
 * asks for it), and from then on it never changes; a revision supersedes it and keeps it for the history. The system never decides promotion or
 * repetition by itself: with no promotion average configured the Academic Office decides every student, and incomplete results are only
 * decided as an exception with a recorded reason.
 */

const label = (s: { firstName: string; middleName?: string | null; lastName: string; admissionNo: string }) => `${[s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ")} (${s.admissionNo})`;
const nameOf = (s: { firstName: string; middleName?: string | null; lastName: string }) => [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");
const isUnique = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

// ───────────────────────── Reading ─────────────────────────

export type DecisionView = {
  id: string; outcome: Outcome; status: "DRAFT" | "AWAITING_HEAD" | "APPROVED"; toClassId: string | null; toClassName: string | null; note: string | null; exceptionReason: string | null;
  preparedAt: Date; approvedAt: Date | null; approvedByName: string | null; headApprovedAt: Date | null; headApprovedByName: string | null;
};
export type ProgressionRow = {
  studentId: string; admissionNo: string; name: string; classId: string; className: string; streamId: string | null; streamName: string | null;
  completion: ExamCompletion; signal: PromotionSignal; suggested: { classId: string; className: string } | { final: true };
  decision: DecisionView | null; registration: string | null;
};
export type ProgressionFilter = { yearId?: string; classId?: string; streamId?: string; q?: string; show?: "none" | "draft" | "awaiting_head" | "approved" | "review" | "incomplete"; page?: number };
export type ClassProgress = { classId: string; name: string; total: number; none: number; draft: number; awaitingHead: number; approved: number; incomplete: number };

const PAGE = 50;

/** The progression year the screens open on: the current academic year. */
export async function progressionYear(ctx: AuthContext, yearId?: string) {
  const years = await loadYears(db, ctx.schoolId);
  const year = (yearId ? years.find((y) => y.id === yearId) : null) ?? years.find((y) => y.isCurrent) ?? years[years.length - 1] ?? null;
  return { years, year };
}

export async function progressionBoard(ctx: AuthContext, opts: ProgressionFilter = {}) {
  requirePermission(ctx, "progression.read");
  const { years, year } = await progressionYear(ctx, opts.yearId);
  const settings = await getLifecycleSettings(db, ctx.schoolId);
  if (!year) return { year: null, years, nextYear: null, rows: [] as ProgressionRow[], total: 0, page: 1, pages: 1, classes: [] as ClassProgress[], totals: totalsOf([]), settings, grades: [] as Grade[], streams: [] as { id: string; name: string; classId: string }[] };
  const nextYear = yearAfter(years, year.id);

  const [grades, streams, enrols, decisions] = await Promise.all([
    loadGrades(db, ctx.schoolId),
    db.stream.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true, classId: true } }),
    db.studentEnrollment.findMany({ where: { schoolId: ctx.schoolId, academicYearId: year.id, status: "ACTIVE", student: { status: "ENROLLED" } }, include: { student: { select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true } } } }),
    db.studentProgression.findMany({ where: { schoolId: ctx.schoolId, fromAcademicYearId: year.id, status: { not: "SUPERSEDED" } }, include: { student: { select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true } } } }),
  ]);
  const gradeBy = new Map(grades.map((g) => [g.id, g]));
  const streamBy = new Map(streams.map((s) => [s.id, s]));
  const byStudent = new Map<string, { student: (typeof enrols)[number]["student"]; classId: string; streamId: string | null }>();
  for (const e of enrols) byStudent.set(e.studentId, { student: e.student, classId: e.classId, streamId: e.streamId });
  for (const d of decisions) if (!byStudent.has(d.studentId)) byStudent.set(d.studentId, { student: d.student, classId: d.fromClassId, streamId: d.fromStreamId });

  const completions = await examCompletions(db, ctx.schoolId, year.id, [...byStudent.entries()].map(([studentId, v]) => ({ studentId, classId: v.classId, streamId: v.streamId })));
  const userIds = [...new Set(decisions.flatMap((d) => [d.approvedById, d.headApprovedById]).filter((x): x is string => !!x))];
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [];
  const userName = new Map(users.map((u) => [u.id, u.fullName]));
  const regs = nextYear && decisions.length ? await db.annualRegistration.findMany({ where: { schoolId: ctx.schoolId, academicYearId: nextYear.id, studentId: { in: decisions.map((d) => d.studentId) } }, select: { studentId: true, status: true } }) : [];
  const regBy = new Map(regs.map((r) => [r.studentId, r.status]));
  const decisionBy = new Map(decisions.map((d) => [d.studentId, d]));

  const all: ProgressionRow[] = [...byStudent.entries()].map(([studentId, v]) => {
    const g = gradeBy.get(v.classId);
    const completion = completions.get(studentId) ?? { state: "NO_EXAMS" as const, missing: [], average: null, scored: 0, required: 0 };
    const next = g ? nextGrade(g, grades) : ({ kind: "FINAL" } as const);
    const d = decisionBy.get(studentId);
    return {
      studentId, admissionNo: v.student.admissionNo, name: nameOf(v.student), classId: v.classId, className: g?.name ?? "", streamId: v.streamId, streamName: v.streamId ? streamBy.get(v.streamId)?.name ?? null : null,
      completion, signal: promotionSignal(completion, settings.promotionMinAverage),
      suggested: next.kind === "NEXT" ? { classId: next.classId, className: gradeBy.get(next.classId)?.name ?? "" } : { final: true },
      decision: d ? {
        id: d.id, outcome: d.outcome, status: d.status as DecisionView["status"], toClassId: d.toClassId, toClassName: d.toClassId ? gradeBy.get(d.toClassId)?.name ?? null : null, note: d.note, exceptionReason: d.exceptionReason,
        preparedAt: d.preparedAt, approvedAt: d.approvedAt, approvedByName: d.approvedById ? userName.get(d.approvedById) ?? null : null, headApprovedAt: d.headApprovedAt, headApprovedByName: d.headApprovedById ? userName.get(d.headApprovedById) ?? null : null,
      } : null,
      registration: regBy.get(studentId) ?? null,
    };
  });

  const order = new Map(orderClasses(grades).map((g, i) => [g.id, i]));
  const classes: ClassProgress[] = orderClasses(grades).filter((g) => all.some((r) => r.classId === g.id)).map((g) => {
    const rs = all.filter((r) => r.classId === g.id);
    return {
      classId: g.id, name: g.name, total: rs.length, none: rs.filter((r) => !r.decision).length, draft: rs.filter((r) => r.decision?.status === "DRAFT").length,
      awaitingHead: rs.filter((r) => r.decision?.status === "AWAITING_HEAD").length, approved: rs.filter((r) => r.decision?.status === "APPROVED").length, incomplete: rs.filter((r) => r.completion.state !== "COMPLETE").length,
    };
  });

  const q = opts.q?.trim().toLowerCase();
  const rows = all.filter((r) => {
    if (opts.classId && r.classId !== opts.classId) return false;
    if (opts.streamId && r.streamId !== opts.streamId) return false;
    if (q && !r.name.toLowerCase().includes(q) && !r.admissionNo.toLowerCase().includes(q)) return false;
    switch (opts.show) {
      case "none": return !r.decision;
      case "draft": return r.decision?.status === "DRAFT";
      case "awaiting_head": return r.decision?.status === "AWAITING_HEAD";
      case "approved": return r.decision?.status === "APPROVED";
      case "review": return r.decision?.outcome === "PENDING_REVIEW";
      case "incomplete": return r.completion.state !== "COMPLETE";
      default: return true;
    }
  }).sort((a, b) => (order.get(a.classId) ?? 0) - (order.get(b.classId) ?? 0) || (a.streamName ?? "").localeCompare(b.streamName ?? "") || a.name.localeCompare(b.name));

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const page = Math.min(Math.max(1, opts.page ?? 1), pages);
  return { year, years, nextYear, rows: rows.slice((page - 1) * PAGE, page * PAGE), total: rows.length, page, pages, classes, totals: totalsOf(all), settings, grades, streams };
}
function totalsOf(all: ProgressionRow[]) {
  const n = (f: (r: ProgressionRow) => boolean) => all.filter(f).length;
  return {
    students: all.length, none: n((r) => !r.decision), draft: n((r) => r.decision?.status === "DRAFT"), awaitingHead: n((r) => r.decision?.status === "AWAITING_HEAD"), approved: n((r) => r.decision?.status === "APPROVED"),
    incomplete: n((r) => r.completion.state !== "COMPLETE"), review: n((r) => r.decision?.outcome === "PENDING_REVIEW"),
    promoted: n((r) => r.decision?.status === "APPROVED" && r.decision.outcome === "PROMOTED"), repeat: n((r) => r.decision?.status === "APPROVED" && r.decision.outcome === "REPEAT"),
    left: n((r) => r.decision?.status === "APPROVED" && (r.decision.outcome === "COMPLETED" || r.decision.outcome === "WITHDRAWN" || r.decision.outcome === "TRANSFERRED")),
  };
}

// ───────────────────────── Deciding ─────────────────────────

const OUTCOMES = ["PROMOTED", "REPEAT", "PENDING_REVIEW", "COMPLETED", "WITHDRAWN", "TRANSFERRED"] as const;
const decideSchema = z.object({ yearId: uuid(), studentId: uuid(), outcome: z.enum(OUTCOMES), toClassId: optUuid(), note: optText(500), exceptionReason: optText(300) });

type Roll = { enrollmentId: string | null; classId: string; streamId: string | null };

/** Where a student stands in the year being closed: the active enrolment, or the class of an existing decision. */
async function rollOf(tx: Tx, schoolId: string, studentId: string, yearId: string): Promise<Roll> {
  const e = await tx.studentEnrollment.findFirst({ where: { schoolId, studentId, academicYearId: yearId, status: "ACTIVE" }, select: { id: true, classId: true, streamId: true } });
  if (e) return { enrollmentId: e.id, classId: e.classId, streamId: e.streamId };
  const d = await tx.studentProgression.findFirst({ where: { schoolId, studentId, fromAcademicYearId: yearId, status: { not: "SUPERSEDED" } }, select: { fromEnrollmentId: true, fromClassId: true, fromStreamId: true } });
  if (d) return { enrollmentId: d.fromEnrollmentId, classId: d.fromClassId, streamId: d.fromStreamId };
  throw notFound("Student in this academic year");
}

async function decideTx(tx: Tx, ctx: AuthContext, a: {
  yearId: string; studentId: string; outcome: Outcome; toClassId: string | null; note: string; exceptionReason: string;
  grades: readonly Grade[]; completion: ExamCompletion; settings: LifecycleSettings; revising?: boolean;
}): Promise<{ id: string }> {
  const roll = await rollOf(tx, ctx.schoolId, a.studentId, a.yearId);
  const student = await tx.student.findFirst({ where: { id: a.studentId, schoolId: ctx.schoolId } });
  if (!student) throw notFound("Student");
  if (student.status !== "ENROLLED") throw conflict("Only students who are Enrolled have an end-of-year decision.");
  const cls = a.grades.find((g) => g.id === roll.classId);
  if (!cls) throw notFound("Class");
  const found = await tx.studentProgression.findFirst({ where: { schoolId: ctx.schoolId, studentId: a.studentId, fromAcademicYearId: a.yearId, status: { not: "SUPERSEDED" } }, select: { id: true } });
  if (found) await tx.$queryRaw`SELECT "id" FROM student_progressions WHERE "id" = ${found.id}::uuid FOR UPDATE`;
  const existing = found ? await tx.studentProgression.findUnique({ where: { id: found.id } }) : null;
  if (existing?.status === "APPROVED" && !a.revising) throw conflict(`${label(student)} already has an approved decision. Revise it with a reason instead.`);

  const signal = promotionSignal(a.completion, a.settings.promotionMinAverage);
  const check = checkDecision({ outcome: a.outcome, cls, classes: a.grades, requestedTo: a.toClassId, completion: a.completion, signal, note: a.note });
  if (check.error) throw invalid(check.error, { outcome: check.error });
  if (check.toClassId) {
    const target = await tx.schoolClass.findFirst({ where: { id: check.toClassId, schoolId: ctx.schoolId } });
    if (!target || !target.isActive) throw invalid("The grade for next year is not available.", { toClassId: "Not available" });
  }
  let exceptionReason: string | null = null;
  if (check.exceptions.length > 0 || a.revising) {
    if (check.exceptions.length > 0 && !ctx.permissions.has("progression.exception")) {
      throw invalid(`${check.exceptions[0]} Only someone allowed to decide exceptions (for example the Head Teacher) can decide this now.`, { outcome: "Needs an exception" });
    }
    if (!a.exceptionReason.trim()) throw invalid(a.revising ? "Say why the decision is being revised." : `${check.exceptions[0]} Give the reason for deciding now.`, { exceptionReason: "Required" });
    exceptionReason = [a.revising ? "Revision" : null, check.exceptions.length ? check.exceptions.join(" ") : null, a.exceptionReason.trim()].filter(Boolean).join(" · ");
  }

  const evidence = { completion: a.completion, signal, minAverage: a.settings.promotionMinAverage };
  const data = {
    outcome: a.outcome, toClassId: check.toClassId, note: a.note.trim() || null, exceptionReason, evidence, status: "DRAFT" as const,
    approvedById: null, approvedAt: null, headApprovedById: null, headApprovedAt: null, preparedById: ctx.userId, preparedAt: new Date(),
  };
  const saved = existing
    ? await tx.studentProgression.update({ where: { id: existing.id }, data })
    : await tx.studentProgression.create({ data: { schoolId: ctx.schoolId, studentId: a.studentId, fromAcademicYearId: a.yearId, fromEnrollmentId: roll.enrollmentId, fromClassId: roll.classId, fromStreamId: roll.streamId, ...data } });
  await writeAudit(tx, actorOf(ctx), {
    action: existing ? "progression.update" : "progression.prepare", entityType: "StudentProgression", entityId: saved.id, summary: label(student),
    changes: { outcome: a.outcome, fromClassId: roll.classId, toClassId: check.toClassId, previous: existing ? { outcome: existing.outcome, toClassId: existing.toClassId } : null, ...(exceptionReason ? { exception: exceptionReason } : {}) },
    reason: exceptionReason ?? undefined,
  });
  return { id: saved.id };
}

export type BulkResult = { studentId: string; name: string; ok: boolean; message: string };

/**
 * The Academic Office's decision for one student or for a whole selection (the same outcome for each; the grade follows the school's order).
 * Each student is decided on their own and the result says who was done and who was refused, with the reason.
 */
export async function decideProgressions(ctx: AuthContext, input: unknown): Promise<BulkResult[]> {
  requirePermission(ctx, "progression.prepare");
  const d = parse(z.object({ yearId: uuid(), studentIds: z.array(uuid()).min(1).max(300), outcome: z.enum(OUTCOMES), toClassId: optUuid(), note: optText(500), exceptionReason: optText(300) }), input);
  const year = await db.academicYear.findFirst({ where: { id: d.yearId, schoolId: ctx.schoolId } });
  if (!year) throw notFound("Academic year");
  const [grades, settings] = await Promise.all([loadGrades(db, ctx.schoolId), getLifecycleSettings(db, ctx.schoolId)]);
  const unique = [...new Set(d.studentIds)];
  const rolls = await db.studentEnrollment.findMany({ where: { schoolId: ctx.schoolId, academicYearId: year.id, studentId: { in: unique }, status: "ACTIVE" }, select: { studentId: true, classId: true, streamId: true } });
  const completions = await examCompletions(db, ctx.schoolId, year.id, rolls);
  const out: BulkResult[] = [];
  for (const studentId of unique) {
    const s = await db.student.findFirst({ where: { id: studentId, schoolId: ctx.schoolId }, select: { firstName: true, middleName: true, lastName: true } });
    const name = s ? nameOf(s) : "";
    try {
      const completion = completions.get(studentId) ?? { state: "NO_EXAMS" as const, missing: [], average: null, scored: 0, required: 0 };
      await db.$transaction((tx) => decideTx(tx, ctx, { yearId: year.id, studentId, outcome: d.outcome, toClassId: unique.length === 1 ? d.toClassId ?? null : null, note: d.note ?? "", exceptionReason: d.exceptionReason ?? "", grades, completion, settings }));
      out.push({ studentId, name, ok: true, message: "Saved as a draft." });
    } catch (e) {
      if (isUnique(e)) out.push({ studentId, name, ok: false, message: "Someone else just decided this student. Reload the list." });
      else if (e instanceof AppError) out.push({ studentId, name, ok: false, message: e.message });
      else throw e;
    }
  }
  return out;
}

/**
 * Prepares drafts for everyone in the selection who has no decision yet, using only what the school has configured: finalized results and a
 * promotion average the school set. A student who reaches it is drafted as promoted (or as completed in the final grade); everybody else is
 * drafted as Pending review, because the system never decides repetition or invents a pass mark. Nothing here is approved.
 */
export async function prepareProgressions(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "progression.prepare");
  const d = parse(z.object({ yearId: uuid(), classId: optUuid(), streamId: optUuid() }), input);
  const year = await db.academicYear.findFirst({ where: { id: d.yearId, schoolId: ctx.schoolId } });
  if (!year) throw notFound("Academic year");
  const [grades, settings] = await Promise.all([loadGrades(db, ctx.schoolId), getLifecycleSettings(db, ctx.schoolId)]);
  const enrols = await db.studentEnrollment.findMany({
    where: { schoolId: ctx.schoolId, academicYearId: year.id, status: "ACTIVE", student: { status: "ENROLLED" }, ...(d.classId ? { classId: d.classId } : {}), ...(d.streamId ? { streamId: d.streamId } : {}) },
    select: { studentId: true, classId: true, streamId: true },
  });
  const have = new Set((await db.studentProgression.findMany({ where: { schoolId: ctx.schoolId, fromAcademicYearId: year.id, status: { not: "SUPERSEDED" } }, select: { studentId: true } })).map((p) => p.studentId));
  const todo = enrols.filter((e) => !have.has(e.studentId));
  const completions = await examCompletions(db, ctx.schoolId, year.id, todo);
  const summary = { created: 0, skipped: enrols.length - todo.length, promoted: 0, completed: 0, review: 0, failed: 0 };
  for (const e of todo) {
    const completion = completions.get(e.studentId)!;
    const signal = promotionSignal(completion, settings.promotionMinAverage);
    const cls = grades.find((g) => g.id === e.classId)!;
    const isFinal = nextGrade(cls, grades).kind === "FINAL";
    const outcome: Outcome = signal === "ELIGIBLE" ? (isFinal ? "COMPLETED" : "PROMOTED") : "PENDING_REVIEW";
    try {
      await db.$transaction((tx) => decideTx(tx, ctx, { yearId: year.id, studentId: e.studentId, outcome, toClassId: null, note: outcome === "PENDING_REVIEW" ? (signal === "NOT_READY" ? "Results are not complete yet." : signal === "READY" ? "No promotion average is set: the Academic Office decides." : "Below the school's promotion average.") : "", exceptionReason: "", grades, completion, settings }));
      summary.created++;
      if (outcome === "PROMOTED") summary.promoted++; else if (outcome === "COMPLETED") summary.completed++; else summary.review++;
    } catch (err) {
      if (!(err instanceof AppError) && !isUnique(err)) throw err;
      summary.failed++;
    }
  }
  return summary;
}

// ───────────────────────── Approving ─────────────────────────

/** What a final decision does: a moving one makes the returning-student record; finishing or leaving closes the student's enrolment through the normal status change. */
async function applyFinalTx(tx: Tx, ctx: AuthContext, p: { id: string; studentId: string; fromAcademicYearId: string; outcome: Outcome; toClassId: string | null; note: string | null }) {
  if ((MOVING_OUTCOMES as readonly string[]).includes(p.outcome)) {
    await ensureRegistrationTx(tx, ctx, p);
    return;
  }
  await releaseRegistrationTx(tx, ctx, p, "The student is not returning (end-of-year decision).");
  if (!(LEAVING_OUTCOMES as readonly string[]).includes(p.outcome)) return;
  const year = await tx.academicYear.findFirstOrThrow({ where: { id: p.fromAcademicYearId, schoolId: ctx.schoolId } });
  const student = await tx.student.findFirstOrThrow({ where: { id: p.studentId, schoolId: ctx.schoolId } });
  const today = parseDateOnly(await schoolToday(tx, ctx.schoolId)) as Date;
  let effectiveOn = year.endsOn < today ? year.endsOn : today;
  if (effectiveOn < student.admissionDate) effectiveOn = student.admissionDate;
  const status = p.outcome === "COMPLETED" ? "GRADUATED" : p.outcome === "WITHDRAWN" ? "WITHDRAWN" : "TRANSFERRED";
  await applyStatusChangeTx(tx, ctx, p.studentId, { status, reason: p.note?.trim() || (p.outcome === "COMPLETED" ? `Completed school (${year.name})` : "End-of-year decision"), effectiveOn });
}

export type ApproveResult = { id: string; name: string; ok: boolean; message: string; status?: string };

/**
 * Approves decisions. The Academic Office approval makes a decision final; when the school asks for the Head Teacher's approval too, it waits
 * for it (a Head Teacher approving gives both at once). Each decision is approved on its own, in its own transaction, and reported.
 */
export async function approveProgressions(ctx: AuthContext, input: unknown): Promise<ApproveResult[]> {
  const { ids } = parse(z.object({ ids: z.array(uuid()).min(1).max(300) }), input);
  const settings = await getLifecycleSettings(db, ctx.schoolId);
  const out: ApproveResult[] = [];
  for (const id of [...new Set(ids)]) {
    const head = await db.studentProgression.findFirst({ where: { id, schoolId: ctx.schoolId }, include: { student: true } });
    const name = head ? nameOf(head.student) : "";
    try {
      const status = await db.$transaction(async (tx) => {
        // Two people approving the same decision at once: the second waits here and then finds it already approved.
        await tx.$queryRaw`SELECT "id" FROM student_progressions WHERE "id" = ${id}::uuid AND "schoolId" = ${ctx.schoolId}::uuid FOR UPDATE`;
        const p = await tx.studentProgression.findFirst({ where: { id, schoolId: ctx.schoolId }, include: { student: true } });
        if (!p) throw notFound("Decision");
        if (p.status === "APPROVED") throw conflict("Already approved.");
        if (p.status === "SUPERSEDED") throw conflict("This decision was replaced by a newer one.");
        if (p.outcome === "PENDING_REVIEW") throw conflict("Decide where the student goes first (Pending review cannot be approved).");
        const canHead = ctx.permissions.has("progression.head_approve");
        const canAcademic = ctx.permissions.has("progression.approve");
        let next: "AWAITING_HEAD" | "APPROVED";
        const now = new Date();
        const data: Record<string, unknown> = {};
        if (p.status === "DRAFT") {
          if (!canAcademic) throw forbidden();
          Object.assign(data, { approvedById: ctx.userId, approvedAt: now });
          if (settings.requireHeadApproval && !canHead) next = "AWAITING_HEAD";
          else { next = "APPROVED"; if (settings.requireHeadApproval) Object.assign(data, { headApprovedById: ctx.userId, headApprovedAt: now }); }
        } else {
          if (!canHead) throw forbidden();
          next = "APPROVED";
          Object.assign(data, { headApprovedById: ctx.userId, headApprovedAt: now });
        }
        await tx.studentProgression.update({ where: { id: p.id }, data: { ...data, status: next } });
        await writeAudit(tx, actorOf(ctx), { action: next === "APPROVED" ? "progression.approve" : "progression.send_to_head", entityType: "StudentProgression", entityId: p.id, summary: label(p.student), changes: { outcome: p.outcome, toClassId: p.toClassId, status: next } });
        if (next === "APPROVED") await applyFinalTx(tx, ctx, { id: p.id, studentId: p.studentId, fromAcademicYearId: p.fromAcademicYearId, outcome: p.outcome, toClassId: p.toClassId, note: p.note });
        return next;
      });
      out.push({ id, name, ok: true, status, message: status === "APPROVED" ? "Approved." : "Sent to the Head Teacher for approval." });
    } catch (e) {
      if (e instanceof AppError) out.push({ id, name, ok: false, message: e.message });
      else throw e;
    }
  }
  return out;
}

/** The Head Teacher (or the Academic Office) sends a decision that waits for approval back to draft, with a reason. */
export async function sendBackProgression(ctx: AuthContext, input: unknown) {
  const d = parse(z.object({ id: uuid(), reason: z.string().trim().min(1, "Required").max(300) }), input);
  if (!ctx.permissions.has("progression.head_approve") && !ctx.permissions.has("progression.approve")) throw forbidden();
  await db.$transaction(async (tx) => {
    const p = await tx.studentProgression.findFirst({ where: { id: d.id, schoolId: ctx.schoolId }, include: { student: true } });
    if (!p) throw notFound("Decision");
    if (p.status !== "AWAITING_HEAD") throw conflict("Only a decision that is waiting for approval can be sent back.");
    await tx.studentProgression.update({ where: { id: p.id }, data: { status: "DRAFT", approvedById: null, approvedAt: null, note: [p.note, `Sent back: ${d.reason}`].filter(Boolean).join(" · ") } });
    await writeAudit(tx, actorOf(ctx), { action: "progression.send_back", entityType: "StudentProgression", entityId: p.id, summary: label(p.student), reason: d.reason });
  });
}

const reviseSchema = z.object({ id: uuid(), outcome: z.enum(["PROMOTED", "REPEAT"]), toClassId: optUuid(), note: optText(500), exceptionReason: z.string().trim().min(1, "Say why the decision is changed").max(300) });

/**
 * Changes an approved decision (promoted or repeat only). Needs the exception permission and a reason; the old decision stays as history and the
 * new one starts as a draft that must be approved again. Refused once the student is registered for the next year (cancel that first).
 */
export async function reviseProgression(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "progression.exception");
  const d = parse(reviseSchema, input);
  return db.$transaction(async (tx) => {
    const old = await tx.studentProgression.findFirst({ where: { id: d.id, schoolId: ctx.schoolId }, include: { student: true } });
    if (!old) throw notFound("Decision");
    if (old.status !== "APPROVED") throw conflict("Only an approved decision needs a revision; edit a draft directly.");
    if (old.outcome !== "PROMOTED" && old.outcome !== "REPEAT") throw conflict("A student who finished or left is reinstated from the student's page first.");
    const years = await loadYears(tx, ctx.schoolId);
    const next = yearAfter(years, old.fromAcademicYearId);
    const reg = next ? await tx.annualRegistration.findUnique({ where: { studentId_academicYearId: { studentId: old.studentId, academicYearId: next.id } } }) : null;
    if (reg && (reg.status === "REGISTERED" || reg.status === "ACTIVE")) throw conflict("The student is already registered for the next year. Cancel the registration before revising the decision.");
    const [grades, settings] = await Promise.all([loadGrades(tx, ctx.schoolId), getLifecycleSettings(tx, ctx.schoolId)]);
    const roll = { studentId: old.studentId, classId: old.fromClassId, streamId: old.fromStreamId };
    const completion = (await examCompletions(tx, ctx.schoolId, old.fromAcademicYearId, [roll])).get(old.studentId)!;
    await tx.studentProgression.update({ where: { id: old.id }, data: { status: "SUPERSEDED" } });
    const created = await decideTx(tx, ctx, { yearId: old.fromAcademicYearId, studentId: old.studentId, outcome: d.outcome, toClassId: d.toClassId ?? null, note: d.note ?? "", exceptionReason: d.exceptionReason, grades, completion, settings, revising: true });
    await writeAudit(tx, actorOf(ctx), { action: "progression.revise", entityType: "StudentProgression", entityId: old.id, summary: label(old.student), changes: { supersededBy: created.id, from: { outcome: old.outcome, toClassId: old.toClassId }, to: { outcome: d.outcome, toClassId: d.toClassId ?? null } }, reason: d.exceptionReason });
    return created;
  });
}

/** The decision history of one student across their years (newest first), for the student's timeline. */
export async function studentProgressions(ctx: AuthContext, studentId: string) {
  requirePermission(ctx, "progression.read");
  const rows = await db.studentProgression.findMany({ where: { schoolId: ctx.schoolId, studentId }, orderBy: { createdAt: "desc" }, include: { fromYear: { select: { name: true } } } });
  const grades = await loadGrades(db, ctx.schoolId);
  const name = new Map(grades.map((g) => [g.id, g.name]));
  return rows.map((r) => ({ id: r.id, yearName: r.fromYear.name, outcome: r.outcome, status: r.status, fromClass: name.get(r.fromClassId) ?? "", toClass: r.toClassId ? name.get(r.toClassId) ?? null : null, note: r.note, exceptionReason: r.exceptionReason, approvedAt: r.approvedAt, headApprovedAt: r.headApprovedAt }));
}

