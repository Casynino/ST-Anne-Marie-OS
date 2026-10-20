import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Db, type Tx } from "@/lib/db";
import { AppError, conflict, forbidden, invalid, notFound } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import { requireAnyPermission } from "@/lib/auth/context";
import { gradeFor, percentOf } from "@/lib/results/engine";
import { normalizeMark, type RawMark } from "@/lib/results/entry";
import { actorOf, writeAudit } from "@/server/audit";
import { getResultsSettings, resolveScale, type ResolvedScale } from "@/server/grading";
import { parse, text } from "@/lib/validation";

/*
 * Marks workflow:  DRAFT -> SUBMITTED -> APPROVED -> LOCKED, with RETURNED for corrections.
 *   - teachers enter and submit (only DRAFT / RETURNED are editable);
 *   - approvers (results.approve) approve or return;
 *   - results.lock freezes an approved unit and snapshots each mark's percent/grade/points;
 *   - results.unlock reopens a locked unit with a reason (audited), which clears the snapshots.
 * A missing mark means "not entered". Absent and exempt are explicit states and are never silently zero.
 */

// ───────────────────────── Access ─────────────────────────

type TeachingRow = { classId: string; streamId: string | null; subjectId: string | null };

/** What the signed-in teacher teaches in a year. subjectId null = class teacher (any subject of the class/stream). */
async function teachingRows(client: Db | Tx, ctx: AuthContext, academicYearId: string): Promise<TeachingRow[]> {
  if (!ctx.staffId) return [];
  const [ct, st] = await Promise.all([
    client.classTeacher.findMany({ where: { staffId: ctx.staffId, academicYearId, schoolId: ctx.schoolId }, select: { classId: true, streamId: true } }),
    client.subjectTeacher.findMany({ where: { staffId: ctx.staffId, academicYearId, schoolId: ctx.schoolId }, select: { classId: true, streamId: true, subjectId: true } }),
  ]);
  return [...ct.map((r) => ({ ...r, subjectId: null })), ...st];
}

export function teaches(rows: TeachingRow[], u: { classId: string; streamId: string | null; subjectId: string }): boolean {
  return rows.some((r) => r.classId === u.classId && (r.streamId === null || r.streamId === u.streamId) && (r.subjectId === null || r.subjectId === u.subjectId));
}

type Access = { view: boolean; enter: boolean };
function accessFor(ctx: AuthContext, rows: TeachingRow[], u: { classId: string; streamId: string | null; subjectId: string }): Access {
  const assigned = teaches(rows, u);
  const enter = ctx.permissions.has("marks.enter_any") || (ctx.permissions.has("marks.enter") && assigned);
  const view = enter || ctx.permissions.has("results.read") || (ctx.permissions.has("results.read_assigned") && assigned);
  return { view, enter };
}

// ───────────────────────── Unit loading ─────────────────────────

const unitInclude = { examSubject: { include: { exam: true } } } satisfies Prisma.ResultSubmissionInclude;

async function loadUnit(client: Db | Tx, ctx: AuthContext, submissionId: string) {
  const sub = await client.resultSubmission.findFirst({ where: { id: submissionId, schoolId: ctx.schoolId }, include: unitInclude });
  if (!sub) throw notFound("Result submission");
  return sub;
}

/** Students on the unit's list: enrolled in that class (and stream) at any point during the exam's term. */
export async function loadRoster(client: Db | Tx, schoolId: string, exam: { academicYearId: string; termId: string }, classId: string, streamId: string | null) {
  const term = await client.term.findFirstOrThrow({ where: { id: exam.termId, schoolId }, select: { startsOn: true, endsOn: true } });
  const rows = await client.studentEnrollment.findMany({
    where: {
      schoolId, academicYearId: exam.academicYearId, classId, ...(streamId ? { streamId } : {}),
      startedOn: { lte: term.endsOn }, OR: [{ endedOn: null }, { endedOn: { gte: term.startsOn } }],
    },
    select: { student: { select: { id: true, admissionNo: true, firstName: true, middleName: true, lastName: true, status: true } } },
  });
  const seen = new Set<string>();
  return rows
    .map((r) => r.student)
    .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
}

const fullName = (s: { firstName: string; middleName: string | null; lastName: string }) => [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");

async function lockRow(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM result_submissions WHERE id = ${id}::uuid FOR UPDATE`;
}

// ───────────────────────── Reading ─────────────────────────

export type SheetRow = {
  studentId: string; admissionNo: string; name: string; studentStatus: string;
  mark: { status: "SCORED" | "ABSENT" | "EXEMPT"; score: number | null; percent: number | null; grade: string | null; points: number | null } | null;
};

export async function getMarkSheet(ctx: AuthContext, submissionId: string) {
  requireAnyPermission(ctx, ["marks.enter", "marks.enter_any", "results.read", "results.read_assigned"]);
  const sub = await loadUnit(db, ctx, submissionId);
  const es = sub.examSubject;
  const rows = await teachingRows(db, ctx, es.exam.academicYearId);
  const unit = { classId: es.classId, streamId: sub.streamId, subjectId: es.subjectId };
  const access = accessFor(ctx, rows, unit);
  if (!access.view) throw notFound("Result submission"); // do not reveal units outside the user's scope

  const cls = await db.schoolClass.findUniqueOrThrow({ where: { id: es.classId }, select: { name: true, nameSw: true, levelId: true } });
  const [roster, marks, stream, subject, term, scale] = await Promise.all([
    loadRoster(db, ctx.schoolId, es.exam, es.classId, sub.streamId),
    db.mark.findMany({ where: { examSubjectId: es.id, schoolId: ctx.schoolId } }),
    sub.streamId ? db.stream.findUnique({ where: { id: sub.streamId }, select: { name: true } }) : null,
    db.subject.findUniqueOrThrow({ where: { id: es.subjectId }, select: { name: true, nameSw: true, code: true } }),
    db.term.findUniqueOrThrow({ where: { id: es.exam.termId }, select: { name: true, startsOn: true, endsOn: true } }),
    resolveScale(db, ctx.schoolId, { examScaleId: es.exam.gradingScaleId, levelId: cls.levelId }),
  ]);
  const max = Number(es.maxMarks);
  const byStudent = new Map(marks.map((m) => [m.studentId, m]));
  const sheet: SheetRow[] = roster.map((s) => {
    const m = byStudent.get(s.id);
    let mark: SheetRow["mark"] = null;
    if (m) {
      const score = m.score === null ? null : Number(m.score);
      let percent: number | null = null, grade: string | null = null, points: number | null = null;
      if (m.status === "SCORED" && score !== null) {
        if (sub.status === "LOCKED" && m.lockedPercent !== null) { percent = Number(m.lockedPercent); grade = m.lockedGrade; points = m.lockedPoints; }
        else { percent = percentOf(score, max); const g = scale ? gradeFor(percent, scale.bands) : null; grade = g?.grade ?? null; points = g?.points ?? null; }
      }
      mark = { status: m.status, score, percent, grade, points };
    }
    return { studentId: s.id, admissionNo: s.admissionNo, name: fullName(s), studentStatus: s.status, mark };
  });
  const status = sub.status;
  const editable = access.enter && (status === "DRAFT" || status === "RETURNED");
  const today = new Date();
  return {
    submission: { id: sub.id, status, version: sub.version, returnReason: sub.returnReason, unlockReason: sub.unlockReason, submittedAt: sub.submittedAt, approvedAt: sub.approvedAt, lockedAt: sub.lockedAt },
    exam: { id: es.exam.id, name: es.exam.name, category: es.exam.category, examDate: es.exam.examDate, deadline: es.exam.submissionDeadline, weight: Number(es.exam.weight) },
    examSubjectId: es.id, maxMarks: max,
    className: cls.name, classNameSw: cls.nameSw, streamName: stream?.name ?? null, subjectName: subject.name, subjectNameSw: subject.nameSw, termName: term.name,
    scaleName: scale?.name ?? null,
    rows: sheet,
    entered: sheet.filter((r) => r.mark).length,
    overdue: !!es.exam.submissionDeadline && es.exam.submissionDeadline < today && (status === "DRAFT" || status === "RETURNED"),
    can: {
      edit: editable,
      submit: editable,
      approve: ctx.permissions.has("results.approve") && status === "SUBMITTED",
      return: ctx.permissions.has("results.approve") && (status === "SUBMITTED" || status === "APPROVED"),
      lock: ctx.permissions.has("results.lock") && status === "APPROVED",
      unlock: ctx.permissions.has("results.unlock") && status === "LOCKED",
    },
  };
}

export type SubmissionRow = {
  id: string; examId: string; examName: string; classId: string; className: string; streamName: string | null; subjectId: string; subjectName: string;
  status: string; roster: number; entered: number; maxMarks: number; deadline: Date | null; overdue: boolean; canEnter: boolean;
};

/**
 * Submissions of one examination (or every examination of a term) the user may see, with entry progress.
 * Teachers see only the units they teach; users with results.read / marks.enter_any see all.
 */
export async function listSubmissions(ctx: AuthContext, filter: { examId?: string; termId?: string; status?: string; mine?: boolean }): Promise<SubmissionRow[]> {
  requireAnyPermission(ctx, ["marks.enter", "marks.enter_any", "results.read", "results.read_assigned"]);
  const exams = await db.exam.findMany({ where: { schoolId: ctx.schoolId, ...(filter.examId ? { id: filter.examId } : {}), ...(filter.termId ? { termId: filter.termId } : {}) } });
  if (!exams.length) return [];
  const subs = await db.resultSubmission.findMany({
    where: { schoolId: ctx.schoolId, examSubject: { examId: { in: exams.map((e) => e.id) } }, ...(filter.status ? { status: filter.status as never } : {}) },
    include: { examSubject: true },
  });
  if (!subs.length) return [];
  const examById = new Map(exams.map((e) => [e.id, e]));
  const years = [...new Set(exams.map((e) => e.academicYearId))];
  const rowsByYear = new Map<string, TeachingRow[]>();
  for (const y of years) rowsByYear.set(y, await teachingRows(db, ctx, y));

  const visible = subs.filter((s) => {
    const ex = examById.get(s.examSubject.examId)!;
    const a = accessFor(ctx, rowsByYear.get(ex.academicYearId) ?? [], { classId: s.examSubject.classId, streamId: s.streamId, subjectId: s.examSubject.subjectId });
    return filter.mine ? a.enter : a.view;
  });
  if (!visible.length) return [];

  const classIds = [...new Set(visible.map((s) => s.examSubject.classId))];
  const subjectIds = [...new Set(visible.map((s) => s.examSubject.subjectId))];
  const [classes, subjects, streams] = await Promise.all([
    db.schoolClass.findMany({ where: { id: { in: classIds }, schoolId: ctx.schoolId }, select: { id: true, name: true } }),
    db.subject.findMany({ where: { id: { in: subjectIds }, schoolId: ctx.schoolId }, select: { id: true, name: true } }),
    db.stream.findMany({ where: { classId: { in: classIds }, schoolId: ctx.schoolId }, select: { id: true, name: true } }),
  ]);
  const marks = await db.mark.findMany({ where: { schoolId: ctx.schoolId, examSubjectId: { in: [...new Set(visible.map((s) => s.examSubjectId))] } }, select: { examSubjectId: true, studentId: true } });
  const marksBy = new Map<string, Set<string>>();
  for (const m of marks) (marksBy.get(m.examSubjectId) ?? marksBy.set(m.examSubjectId, new Set()).get(m.examSubjectId)!).add(m.studentId);

  // Roster per (year, term, class, stream) computed once.
  const rosterCache = new Map<string, Set<string>>();
  const rosterOf = async (examId: string, classId: string, streamId: string | null) => {
    const ex = examById.get(examId)!;
    const key = `${ex.termId}:${classId}:${streamId ?? ""}`;
    if (!rosterCache.has(key)) rosterCache.set(key, new Set((await loadRoster(db, ctx.schoolId, ex, classId, streamId)).map((s) => s.id)));
    return rosterCache.get(key)!;
  };

  const now = new Date();
  const out: SubmissionRow[] = [];
  for (const s of visible) {
    const ex = examById.get(s.examSubject.examId)!;
    const roster = await rosterOf(ex.id, s.examSubject.classId, s.streamId);
    const have = marksBy.get(s.examSubjectId) ?? new Set<string>();
    let entered = 0;
    for (const id of roster) if (have.has(id)) entered++;
    const a = accessFor(ctx, rowsByYear.get(ex.academicYearId) ?? [], { classId: s.examSubject.classId, streamId: s.streamId, subjectId: s.examSubject.subjectId });
    out.push({
      id: s.id, examId: ex.id, examName: ex.name, classId: s.examSubject.classId, className: classes.find((c) => c.id === s.examSubject.classId)?.name ?? "",
      streamName: s.streamId ? (streams.find((x) => x.id === s.streamId)?.name ?? null) : null,
      subjectId: s.examSubject.subjectId, subjectName: subjects.find((x) => x.id === s.examSubject.subjectId)?.name ?? "",
      status: s.status, roster: roster.size, entered, maxMarks: Number(s.examSubject.maxMarks), deadline: ex.submissionDeadline,
      overdue: !!ex.submissionDeadline && ex.submissionDeadline < now && (s.status === "DRAFT" || s.status === "RETURNED"), canEnter: a.enter,
    });
  }
  return out.sort((a, b) => a.className.localeCompare(b.className) || (a.streamName ?? "").localeCompare(b.streamName ?? "") || a.subjectName.localeCompare(b.subjectName));
}

// ───────────────────────── Entering marks ─────────────────────────

export type MarkEntryInput = { studentId: string; status?: string | null; score?: string | number | null };

const entriesSchema = z.object({
  expectedVersion: z.number().int().optional(),
  entries: z.array(z.object({ studentId: z.uuid(), status: z.string().nullish(), score: z.union([z.string(), z.number()]).nullish() })).max(2000),
});

/**
 * Saves a draft of marks for a unit. All-or-nothing: if any entry is invalid nothing is saved and every problem is
 * returned per student (`marks.<studentId>`), so the teacher can fix and retry. Empty entries clear a mark ("not entered").
 */
export async function saveMarks(ctx: AuthContext, submissionId: string, input: { expectedVersion?: number; entries: MarkEntryInput[] }) {
  requireAnyPermission(ctx, ["marks.enter", "marks.enter_any"]);
  const d = parse(entriesSchema, input);
  const pre = await loadUnit(db, ctx, submissionId);
  const rows = await teachingRows(db, ctx, pre.examSubject.exam.academicYearId);
  const unit = { classId: pre.examSubject.classId, streamId: pre.streamId, subjectId: pre.examSubject.subjectId };
  const access = accessFor(ctx, rows, unit);
  if (!access.view) throw notFound("Result submission");
  if (!access.enter) throw forbidden("You are not assigned to enter marks for this class and subject.");

  return db.$transaction(async (tx) => {
    await lockRow(tx, submissionId);
    const sub = await loadUnit(tx, ctx, submissionId);
    if (sub.status !== "DRAFT" && sub.status !== "RETURNED") throw conflict(`Marks are ${sub.status === "LOCKED" ? "locked" : sub.status === "APPROVED" ? "approved" : "submitted"} and can no longer be edited here.`);
    if (d.expectedVersion !== undefined && d.expectedVersion !== sub.version) throw conflict("These marks were changed by someone else. Reload the page to see the latest values.");
    const es = sub.examSubject;
    const max = Number(es.maxMarks);
    const roster = new Map((await loadRoster(tx, ctx.schoolId, es.exam, es.classId, sub.streamId)).map((s) => [s.id, s]));
    const existing = new Map((await tx.mark.findMany({ where: { examSubjectId: es.id, schoolId: ctx.schoolId } })).map((m) => [m.studentId, m]));

    const errors: Record<string, string> = {};
    const seen = new Set<string>();
    const plan: { studentId: string; next: { status: "SCORED" | "ABSENT" | "EXEMPT"; score: number | null } | null }[] = [];
    for (const e of d.entries) {
      const key = `marks.${e.studentId}`;
      if (seen.has(e.studentId)) { errors[key] = "Listed twice"; continue; }
      seen.add(e.studentId);
      if (!roster.has(e.studentId)) { errors[key] = "Not on this class list"; continue; }
      const check = normalizeMark(e as RawMark, max);
      if (!check.ok) { errors[key] = check.error; continue; }
      plan.push({ studentId: e.studentId, next: check.value });
    }
    if (Object.keys(errors).length) throw new AppError("VALIDATION", `${Object.keys(errors).length} mark(s) need correcting. Nothing was saved.`, errors);

    const track = sub.submittedAt !== null; // history is kept once marks have been submitted at least once
    const reason = sub.returnReason ?? sub.unlockReason ?? null;
    let saved = 0, cleared = 0, unchanged = 0;
    for (const p of plan) {
      const old = existing.get(p.studentId);
      const oldScore = old?.score === null || old?.score === undefined ? null : Number(old.score);
      const same = p.next ? old?.status === p.next.status && oldScore === p.next.score : !old;
      if (same) { unchanged++; continue; }
      if (p.next) {
        await tx.mark.upsert({
          where: { examSubjectId_studentId: { examSubjectId: es.id, studentId: p.studentId } },
          create: { schoolId: ctx.schoolId, examSubjectId: es.id, studentId: p.studentId, status: p.next.status, score: p.next.score, enteredById: ctx.userId },
          update: { status: p.next.status, score: p.next.score, enteredById: ctx.userId },
        });
        saved++;
      } else {
        await tx.mark.delete({ where: { examSubjectId_studentId: { examSubjectId: es.id, studentId: p.studentId } } });
        cleared++;
      }
      if (track) {
        await tx.resultChange.create({
          data: {
            schoolId: ctx.schoolId, examSubjectId: es.id, studentId: p.studentId,
            oldStatus: old?.status ?? null, oldScore: old?.score ?? null, newStatus: p.next?.status ?? null, newScore: p.next?.score ?? null,
            reason, changedById: ctx.userId,
          },
        });
      }
    }
    const changed = saved + cleared;
    if (changed) {
      await tx.resultSubmission.update({ where: { id: sub.id }, data: { version: { increment: 1 } } });
      await writeAudit(tx, actorOf(ctx), { action: "marks.save", entityType: "ResultSubmission", entityId: sub.id, summary: es.exam.name, changes: { saved, cleared, afterSubmission: track } });
    }
    return { saved, cleared, unchanged, version: sub.version + (changed ? 1 : 0) };
  });
}

// ───────────────────────── Workflow ─────────────────────────

const reasonSchema = z.object({ reason: text(300) });

async function transition<T>(
  ctx: AuthContext, submissionId: string,
  fn: (tx: Tx, sub: Awaited<ReturnType<typeof loadUnit>>) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await lockRow(tx, submissionId);
    const sub = await loadUnit(tx, ctx, submissionId);
    return fn(tx, sub);
  });
}

async function enterAccessOrThrow(ctx: AuthContext, sub: Awaited<ReturnType<typeof loadUnit>>) {
  const rows = await teachingRows(db, ctx, sub.examSubject.exam.academicYearId);
  const a = accessFor(ctx, rows, { classId: sub.examSubject.classId, streamId: sub.streamId, subjectId: sub.examSubject.subjectId });
  if (!a.view) throw notFound("Result submission");
  if (!a.enter) throw forbidden("You are not assigned to enter marks for this class and subject.");
}

export async function submitMarks(ctx: AuthContext, submissionId: string) {
  requireAnyPermission(ctx, ["marks.enter", "marks.enter_any"]);
  await enterAccessOrThrow(ctx, await loadUnit(db, ctx, submissionId));
  return transition(ctx, submissionId, async (tx, sub) => {
    if (sub.status !== "DRAFT" && sub.status !== "RETURNED") throw conflict("These marks have already been submitted.");
    const es = sub.examSubject;
    const roster = await loadRoster(tx, ctx.schoolId, es.exam, es.classId, sub.streamId);
    if (!roster.length) throw conflict("There are no students on this class list, so there is nothing to submit.");
    const settings = await getResultsSettings(tx, ctx.schoolId);
    if (settings.requireAllMarksBeforeSubmit) {
      const have = new Set((await tx.mark.findMany({ where: { examSubjectId: es.id, schoolId: ctx.schoolId }, select: { studentId: true } })).map((m) => m.studentId));
      const missing = roster.filter((s) => !have.has(s.id));
      if (missing.length) {
        throw new AppError("VALIDATION", `${missing.length} student(s) have no mark yet. Enter a score, or mark them Absent or Exempt, before submitting.`, Object.fromEntries(missing.map((s) => [`marks.${s.id}`, "Required before submitting"])));
      }
    }
    await tx.resultSubmission.update({ where: { id: sub.id }, data: { status: "SUBMITTED", submittedById: ctx.userId, submittedAt: new Date(), returnReason: null, version: { increment: 1 } } });
    await writeAudit(tx, actorOf(ctx), { action: "marks.submit", entityType: "ResultSubmission", entityId: sub.id, summary: es.exam.name });
  });
}

export async function approveMarks(ctx: AuthContext, submissionId: string) {
  requireAnyPermission(ctx, ["results.approve"]);
  return transition(ctx, submissionId, async (tx, sub) => {
    if (sub.status !== "SUBMITTED") throw conflict("Only submitted marks can be approved.");
    await tx.resultSubmission.update({ where: { id: sub.id }, data: { status: "APPROVED", approvedById: ctx.userId, approvedAt: new Date(), version: { increment: 1 } } });
    await writeAudit(tx, actorOf(ctx), { action: "marks.approve", entityType: "ResultSubmission", entityId: sub.id, summary: sub.examSubject.exam.name });
  });
}

export async function returnMarks(ctx: AuthContext, submissionId: string, input: unknown) {
  requireAnyPermission(ctx, ["results.approve"]);
  const { reason } = parse(reasonSchema, input);
  return transition(ctx, submissionId, async (tx, sub) => {
    if (sub.status !== "SUBMITTED" && sub.status !== "APPROVED") throw conflict("Only submitted or approved marks can be returned. Locked results must be unlocked first.");
    await tx.resultSubmission.update({ where: { id: sub.id }, data: { status: "RETURNED", returnReason: reason, approvedById: null, approvedAt: null, version: { increment: 1 } } });
    await writeAudit(tx, actorOf(ctx), { action: "marks.return", entityType: "ResultSubmission", entityId: sub.id, summary: sub.examSubject.exam.name, changes: { reason } });
  });
}

/** Freezes an approved unit and snapshots each scored mark's percent, grade and points against the scale in force now. */
export async function lockMarks(ctx: AuthContext, submissionId: string) {
  requireAnyPermission(ctx, ["results.lock"]);
  return transition(ctx, submissionId, async (tx, sub) => {
    if (sub.status !== "APPROVED") throw conflict("Only approved marks can be locked.");
    const es = sub.examSubject;
    const cls = await tx.schoolClass.findUniqueOrThrow({ where: { id: es.classId }, select: { levelId: true } });
    const scale = await resolveScale(tx, ctx.schoolId, { examScaleId: es.exam.gradingScaleId, levelId: cls.levelId });
    if (!scale) throw conflict("No grading scale is configured for this class. Set up a grading scale before locking results.");
    const roster = await loadRoster(tx, ctx.schoolId, es.exam, es.classId, sub.streamId);
    const marks = await tx.mark.findMany({ where: { examSubjectId: es.id, schoolId: ctx.schoolId, studentId: { in: roster.map((s) => s.id) } } });
    const max = Number(es.maxMarks);
    let snapshotted = 0;
    for (const m of marks) {
      if (m.status !== "SCORED" || m.score === null) continue;
      const percent = percentOf(Number(m.score), max);
      const g = gradeFor(percent, scale.bands);
      if (!g) throw conflict(`The grading scale has no band for ${percent}%. Fix the scale before locking.`);
      await tx.mark.update({ where: { id: m.id }, data: { lockedPercent: percent, lockedGrade: g.grade, lockedPoints: g.points, lockedScaleId: scale.id } });
      snapshotted++;
    }
    await tx.resultSubmission.update({ where: { id: sub.id }, data: { status: "LOCKED", lockedById: ctx.userId, lockedAt: new Date(), version: { increment: 1 } } });
    await writeAudit(tx, actorOf(ctx), { action: "marks.lock", entityType: "ResultSubmission", entityId: sub.id, summary: es.exam.name, changes: { scale: scale.name, snapshotted } });
  });
}

export async function unlockMarks(ctx: AuthContext, submissionId: string, input: unknown) {
  requireAnyPermission(ctx, ["results.unlock"]);
  const { reason } = parse(reasonSchema, input);
  return transition(ctx, submissionId, async (tx, sub) => {
    if (sub.status !== "LOCKED") throw conflict("Only locked results can be unlocked.");
    const es = sub.examSubject;
    const roster = await loadRoster(tx, ctx.schoolId, es.exam, es.classId, sub.streamId);
    await tx.mark.updateMany({ where: { examSubjectId: es.id, schoolId: ctx.schoolId, studentId: { in: roster.map((s) => s.id) } }, data: { lockedPercent: null, lockedGrade: null, lockedPoints: null, lockedScaleId: null } });
    await tx.resultSubmission.update({
      where: { id: sub.id },
      data: { status: "RETURNED", unlockedById: ctx.userId, unlockedAt: new Date(), unlockReason: reason, returnReason: null, approvedById: null, approvedAt: null, lockedById: null, lockedAt: null, version: { increment: 1 } },
    });
    await writeAudit(tx, actorOf(ctx), { action: "marks.unlock", entityType: "ResultSubmission", entityId: sub.id, summary: es.exam.name, changes: { reason } });
  });
}

/** Applies approve / lock to several units; each runs in its own transaction and failures are reported, not hidden. */
export async function bulkTransition(ctx: AuthContext, action: "approve" | "lock", ids: string[]) {
  const done: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const id of [...new Set(ids)].slice(0, 500)) {
    try {
      if (action === "approve") await approveMarks(ctx, id); else await lockMarks(ctx, id);
      done.push(id);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      failed.push({ id, error: e.message });
    }
  }
  return { done, failed };
}

/** Change history for one student's mark in a unit (post-submission edits). */
export async function markHistory(ctx: AuthContext, submissionId: string) {
  requireAnyPermission(ctx, ["results.read", "results.approve", "marks.enter_any"]);
  const sub = await loadUnit(db, ctx, submissionId);
  const changes = await db.resultChange.findMany({ where: { schoolId: ctx.schoolId, examSubjectId: sub.examSubjectId }, orderBy: { createdAt: "desc" }, take: 200 });
  const [students, users] = await Promise.all([
    db.student.findMany({ where: { id: { in: [...new Set(changes.map((c) => c.studentId))] }, schoolId: ctx.schoolId }, select: { id: true, firstName: true, middleName: true, lastName: true } }),
    db.user.findMany({ where: { id: { in: [...new Set(changes.map((c) => c.changedById))] }, schoolId: ctx.schoolId }, select: { id: true, fullName: true } }),
  ]);
  return changes.map((c) => ({
    id: c.id, at: c.createdAt, reason: c.reason,
    student: fullName(students.find((s) => s.id === c.studentId) ?? { firstName: "?", middleName: null, lastName: "" }),
    by: users.find((u) => u.id === c.changedById)?.fullName ?? "—",
    from: c.oldStatus ? (c.oldStatus === "SCORED" ? String(Number(c.oldScore)) : c.oldStatus) : "—",
    to: c.newStatus ? (c.newStatus === "SCORED" ? String(Number(c.newScore)) : c.newStatus) : "cleared",
  }));
}

export type { ResolvedScale };
