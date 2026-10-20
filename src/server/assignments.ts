import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { AppError, conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { requireAnyPermission, requirePermission, type AuthContext } from "@/lib/auth/context";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getStorage } from "@/lib/storage";
import { actorOf, writeAudit } from "@/server/audit";
import { currentPlacement, currentYearId, notifyFamilies, personName, requireTeachesUnit } from "@/server/learning-access";
import { checkLearningFile, listLearningFiles, removeLearningFile, storeLearningFile } from "@/server/learning-store";
import { teachingRows, teaches } from "@/server/marks";
import { childOrThrow } from "@/server/portal";
import { optText, optUuid, parse, text, uuid } from "@/lib/validation";

/*
 * Homework. A teacher sets it for a class/stream and subject they teach; it is invisible to students and families until published.
 * Students hand in text and/or files (PDF/JPEG/PNG/WebP); work done on paper is recorded by the teacher. Marks and feedback stay
 * private to staff until the teacher releases them, and a graded submission is locked until the teacher returns it for revision.
 * Parents see exactly what their child sees and cannot submit.
 */

const SUBMIT_LIMIT = { max: 30, windowMs: 3_600_000 };
const MAX_TEXT = 6000;

const score = (max: number) => z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : Number(v)), z.number("Enter a number").min(0, "Cannot be negative").max(max, `Cannot be more than ${max}`).refine((n) => Math.round(n * 100) === n * 100 || Math.abs(Math.round(n * 100) - n * 100) < 1e-9, "At most 2 decimals"));
const optMaxScore = z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : Number(v)), z.number("Enter a number").positive("Must be more than 0").max(1000, "Maximum 1000").optional());

const baseSchema = z.object({
  title: text(160),
  instructions: z.string().trim().min(1, "Required").max(4000, "Maximum 4000 characters"),
  dueAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Enter a valid date and time").transform((v) => new Date(v)),
  maxScore: optMaxScore,
});
const createSchema = baseSchema.extend({ classId: uuid(), streamId: optUuid(), subjectId: uuid() });

const dec = (n: number) => n.toFixed(2);
const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

// ───────────────────────── Staff: setting homework ─────────────────────────

type UnitKey = { classId: string; streamId: string | null; subjectId: string };

async function loadForTeacher(ctx: AuthContext, id: string) {
  requirePermission(ctx, "assignments.manage");
  if (ctx.userType !== "STAFF") throw forbidden("Only staff members can set homework.");
  const a = await db.assignment.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!a) throw notFound("Assignment");
  await requireTeachesUnit(ctx, a.academicYearId, a satisfies UnitKey);
  return a;
}

export async function createAssignment(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "assignments.manage");
  if (ctx.userType !== "STAFF") throw forbidden("Only staff members can set homework.");
  const d = parse(createSchema, input);
  const yearId = await currentYearId(db, ctx.schoolId);
  if (!yearId) throw invalid("There is no current academic year.");
  await requireTeachesUnit(ctx, yearId, { classId: d.classId, streamId: d.streamId ?? null, subjectId: d.subjectId });
  if (!(await db.classSubject.findFirst({ where: { classId: d.classId, subjectId: d.subjectId, schoolId: ctx.schoolId } }))) throw invalid("Please correct the highlighted fields.", { subjectId: "This subject is not taught in the class" });
  if (d.streamId && !(await db.stream.findFirst({ where: { id: d.streamId, classId: d.classId, schoolId: ctx.schoolId } }))) throw invalid("Please correct the highlighted fields.", { streamId: "That stream does not belong to the class" });
  if (d.dueAt.getTime() <= Date.now()) throw invalid("Please correct the highlighted fields.", { dueAt: "The due date must be in the future" });
  return db.$transaction(async (tx) => {
    const a = await tx.assignment.create({ data: { schoolId: ctx.schoolId, academicYearId: yearId, classId: d.classId, streamId: d.streamId ?? null, subjectId: d.subjectId, teacherStaffId: ctx.staffId ?? null, createdById: ctx.userId, title: d.title, instructions: d.instructions, dueAt: d.dueAt, maxScore: d.maxScore === undefined ? null : dec(d.maxScore) } });
    await writeAudit(tx, actorOf(ctx), { action: "assignment.create", entityType: "Assignment", entityId: a.id, summary: d.title });
    return a;
  });
}

export async function updateAssignment(ctx: AuthContext, id: string, input: unknown) {
  const a = await loadForTeacher(ctx, id);
  if (a.closedAt) throw conflict("This assignment is closed. Reopen it before changing it.");
  const d = parse(baseSchema, input);
  if (!a.publishedAt && d.dueAt.getTime() <= Date.now()) throw invalid("Please correct the highlighted fields.", { dueAt: "The due date must be in the future" });
  const graded = await db.assignmentSubmission.count({ where: { assignmentId: id, state: "GRADED" } });
  const oldMax = num(a.maxScore);
  if (graded && (d.maxScore ?? null) !== oldMax) throw conflict("Some work is already marked, so the maximum score can no longer change.");
  await db.$transaction(async (tx) => {
    await tx.assignment.update({ where: { id }, data: { title: d.title, instructions: d.instructions, dueAt: d.dueAt, maxScore: d.maxScore === undefined ? null : dec(d.maxScore) } });
    // an extended (or shortened) deadline changes which hand-ins count as late
    await tx.assignmentSubmission.updateMany({ where: { assignmentId: id, via: "ONLINE", submittedAt: { gt: d.dueAt }, late: false }, data: { late: true } });
    await tx.assignmentSubmission.updateMany({ where: { assignmentId: id, via: "ONLINE", submittedAt: { lte: d.dueAt }, late: true }, data: { late: false } });
    await writeAudit(tx, actorOf(ctx), { action: "assignment.update", entityType: "Assignment", entityId: id, summary: d.title, changes: { dueAt: d.dueAt.toISOString() } });
  });
}

export async function publishAssignment(ctx: AuthContext, id: string) {
  const a = await loadForTeacher(ctx, id);
  if (a.publishedAt) throw conflict("Already published.");
  if (a.dueAt.getTime() <= Date.now()) throw invalid("Move the due date into the future before publishing.");
  await db.$transaction(async (tx) => {
    await tx.assignment.update({ where: { id }, data: { publishedAt: new Date() } });
    await writeAudit(tx, actorOf(ctx), { action: "assignment.publish", entityType: "Assignment", entityId: id, summary: a.title });
    const roster = await rosterOf(tx, a);
    await notifyFamilies(tx, ctx.schoolId, roster.map((r) => r.studentId), `New homework: ${a.title}`, `Due ${a.dueAt.toISOString().slice(0, 10)}`, (sid) => `/family/${sid}/assignments/${id}`);
  });
}

export async function closeAssignment(ctx: AuthContext, id: string) {
  const a = await loadForTeacher(ctx, id);
  if (!a.publishedAt) throw conflict("Publish the assignment first.");
  if (a.closedAt) return;
  await db.$transaction(async (tx) => {
    await tx.assignment.update({ where: { id }, data: { closedAt: new Date() } });
    await writeAudit(tx, actorOf(ctx), { action: "assignment.close", entityType: "Assignment", entityId: id, summary: a.title });
  });
}

export async function reopenAssignment(ctx: AuthContext, id: string) {
  const a = await loadForTeacher(ctx, id);
  if (!a.closedAt) return;
  await db.$transaction(async (tx) => {
    await tx.assignment.update({ where: { id }, data: { closedAt: null } });
    await writeAudit(tx, actorOf(ctx), { action: "assignment.reopen", entityType: "Assignment", entityId: id, summary: a.title });
  });
}

/** Only an unpublished draft with nothing handed in can be removed; anything else is closed instead so the record stays. */
export async function deleteAssignment(ctx: AuthContext, id: string) {
  const a = await loadForTeacher(ctx, id);
  if (a.publishedAt) throw conflict("A published assignment cannot be deleted. Close it instead.");
  if (await db.assignmentSubmission.count({ where: { assignmentId: id } })) throw conflict("Work has been recorded for this assignment, so it cannot be deleted.");
  await db.$transaction(async (tx) => {
    await tx.learningFile.updateMany({ where: { schoolId: ctx.schoolId, ownerKind: "ASSIGNMENT", ownerId: id, deletedAt: null }, data: { deletedAt: new Date() } });
    await tx.assignment.delete({ where: { id } });
    await writeAudit(tx, actorOf(ctx), { action: "assignment.delete", entityType: "Assignment", entityId: id, summary: a.title });
  });
}

/** Teacher attaches a worksheet or reference file to the assignment. */
export async function attachToAssignment(ctx: AuthContext, id: string, file: { fileName: string; bytes: Buffer }) {
  const a = await loadForTeacher(ctx, id);
  if (a.closedAt) throw conflict("This assignment is closed.");
  return storeLearningFile(ctx, { kind: "ASSIGNMENT", id }, file);
}

export async function removeAssignmentFile(ctx: AuthContext, fileId: string) {
  requirePermission(ctx, "assignments.manage");
  const f = await db.learningFile.findFirst({ where: { id: fileId, schoolId: ctx.schoolId, ownerKind: "ASSIGNMENT", deletedAt: null } });
  if (!f) throw notFound("File");
  await loadForTeacher(ctx, f.ownerId);
  await removeLearningFile(ctx, fileId);
}

// ───────────────────────── Staff: listing, marking ─────────────────────────

async function rosterOf(client: Pick<typeof db, "studentEnrollment">, a: { schoolId: string; academicYearId: string; classId: string; streamId: string | null }) {
  const rows = await client.studentEnrollment.findMany({
    where: { schoolId: a.schoolId, academicYearId: a.academicYearId, classId: a.classId, status: "ACTIVE", ...(a.streamId ? { streamId: a.streamId } : {}), student: { status: "ENROLLED" } },
    select: { studentId: true, student: { select: { firstName: true, middleName: true, lastName: true, admissionNo: true } } },
  });
  return rows.sort((x, y) => personName(x.student).localeCompare(personName(y.student)));
}

export type AssignmentRow = { id: string; title: string; className: string; streamName: string | null; subjectName: string; dueAt: Date; maxScore: number | null; state: "DRAFT" | "OPEN" | "CLOSED"; overdue: boolean; roster: number; handedIn: number; marked: number };

const stateOf = (a: { publishedAt: Date | null; closedAt: Date | null }): AssignmentRow["state"] => (!a.publishedAt ? "DRAFT" : a.closedAt ? "CLOSED" : "OPEN");

export async function listAssignments(ctx: AuthContext, f: { classId?: string; state?: string } = {}): Promise<AssignmentRow[]> {
  requireAnyPermission(ctx, ["assignments.manage", "assignments.oversee"]);
  if (ctx.userType !== "STAFF") throw forbidden("Staff only.");
  const yearId = await currentYearId(db, ctx.schoolId);
  if (!yearId) return [];
  const all = ctx.permissions.has("assignments.oversee");
  const rows = await db.assignment.findMany({
    where: { schoolId: ctx.schoolId, academicYearId: yearId, ...(f.classId ? { classId: f.classId } : {}), ...(f.state === "DRAFT" ? { publishedAt: null } : f.state === "OPEN" ? { publishedAt: { not: null }, closedAt: null } : f.state === "CLOSED" ? { closedAt: { not: null } } : {}) },
    orderBy: [{ dueAt: "desc" }], take: 300,
  });
  const mine = all ? rows : await (async () => { const t = await teachingRows(db, ctx, yearId); return rows.filter((r) => teaches(t, r)); })();
  if (!mine.length) return [];
  const ids = mine.map((r) => r.id);
  const [classes, streams, subjects, subs, counts] = await Promise.all([
    db.schoolClass.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true } }),
    db.stream.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true } }),
    db.subject.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true } }),
    db.assignmentSubmission.groupBy({ by: ["assignmentId", "state"], where: { assignmentId: { in: ids } }, _count: true }),
    db.studentEnrollment.groupBy({ by: ["classId", "streamId"], where: { schoolId: ctx.schoolId, academicYearId: yearId, status: "ACTIVE", student: { status: "ENROLLED" } }, _count: true }),
  ]);
  const now = Date.now();
  return mine.map((a) => {
    const roster = counts.filter((c) => c.classId === a.classId && (!a.streamId || c.streamId === a.streamId)).reduce((n, c) => n + c._count, 0);
    const mySubs = subs.filter((s) => s.assignmentId === a.id);
    const state = stateOf(a);
    return {
      id: a.id, title: a.title, className: classes.find((c) => c.id === a.classId)?.name ?? "", streamName: a.streamId ? (streams.find((s) => s.id === a.streamId)?.name ?? null) : null,
      subjectName: subjects.find((s) => s.id === a.subjectId)?.name ?? "", dueAt: a.dueAt, maxScore: num(a.maxScore), state, overdue: state === "OPEN" && a.dueAt.getTime() < now,
      roster, handedIn: mySubs.reduce((n, s) => n + s._count, 0), marked: mySubs.filter((s) => s.state === "GRADED").reduce((n, s) => n + s._count, 0),
    };
  });
}

export async function getAssignment(ctx: AuthContext, id: string) {
  requireAnyPermission(ctx, ["assignments.manage", "assignments.oversee"]);
  if (ctx.userType !== "STAFF") throw forbidden("Staff only.");
  const a = await db.assignment.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!a) throw notFound("Assignment");
  const assigned = ctx.permissions.has("assignments.manage") && (await teaches(await teachingRows(db, ctx, a.academicYearId), a));
  if (!assigned && !ctx.permissions.has("assignments.oversee")) throw notFound("Assignment");
  const [roster, subs, cls, stream, subject, files] = await Promise.all([
    rosterOf(db, a),
    db.assignmentSubmission.findMany({ where: { assignmentId: id, schoolId: ctx.schoolId } }),
    db.schoolClass.findUnique({ where: { id: a.classId }, select: { name: true } }),
    a.streamId ? db.stream.findUnique({ where: { id: a.streamId }, select: { name: true } }) : null,
    db.subject.findUnique({ where: { id: a.subjectId }, select: { name: true } }),
    listLearningFiles(ctx.schoolId, "ASSIGNMENT", id),
  ]);
  const subFiles = await db.learningFile.findMany({ where: { schoolId: ctx.schoolId, ownerKind: "SUBMISSION", ownerId: { in: subs.map((s) => s.id) }, deletedAt: null }, select: { id: true, ownerId: true, fileName: true, mimeType: true, sizeBytes: true } });
  // students who have since left the class but handed in work stay visible
  const extraIds = subs.map((s) => s.studentId).filter((sid) => !roster.some((r) => r.studentId === sid));
  const extra = extraIds.length ? await db.student.findMany({ where: { id: { in: extraIds }, schoolId: ctx.schoolId }, select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true } }) : [];
  const people = [...roster.map((r) => ({ id: r.studentId, ...r.student })), ...extra];
  const students = people.map((p) => {
    const s = subs.find((x) => x.studentId === p.id) ?? null;
    return {
      studentId: p.id, name: personName(p), admissionNo: p.admissionNo,
      submission: s && { id: s.id, via: s.via, text: s.text, state: s.state, late: s.late, revision: s.revision, submittedAt: s.submittedAt, score: num(s.score), feedback: s.feedback, released: !!s.releasedAt, files: subFiles.filter((f) => f.ownerId === s.id) },
    };
  });
  return {
    assignment: { id: a.id, title: a.title, instructions: a.instructions, dueAt: a.dueAt, maxScore: num(a.maxScore), state: stateOf(a), className: cls?.name ?? "", streamName: stream?.name ?? null, subjectName: subject?.name ?? "", publishedAt: a.publishedAt, closedAt: a.closedAt, classId: a.classId, streamId: a.streamId, subjectId: a.subjectId },
    files, students, canManage: assigned,
  };
}

const gradeSchema = z.object({ decision: z.enum(["GRADE", "RETURN"]), feedback: optText(2000), score: z.unknown().optional(), release: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()) });

/** Marks a hand-in (GRADE) or sends it back for revision (RETURN). A returned item always shows the teacher's note to the student. */
export async function gradeSubmission(ctx: AuthContext, assignmentId: string, studentId: string, input: unknown) {
  const a = await loadForTeacher(ctx, assignmentId);
  if (!a.publishedAt) throw conflict("Publish the assignment before marking.");
  const d = parse(gradeSchema, input);
  const sub = await db.assignmentSubmission.findFirst({ where: { assignmentId, studentId, schoolId: ctx.schoolId } });
  if (!sub) throw notFound("Submission");
  const max = num(a.maxScore);
  let scoreValue: string | null = null;
  if (d.decision === "RETURN") {
    if (!d.feedback) throw invalid("Please correct the highlighted fields.", { feedback: "Say what the student should change" });
  } else if (max !== null) {
    const p = score(max).safeParse(d.score);
    if (!p.success) throw invalid("Please correct the highlighted fields.", { score: d.score === undefined || d.score === "" ? "Enter a score" : (p.error.issues[0]?.message ?? "Invalid score") });
    scoreValue = dec(p.data);
  } else if (d.score !== undefined && d.score !== "") {
    throw invalid("Please correct the highlighted fields.", { score: "This assignment is not marked with a score" });
  }
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.assignmentSubmission.update({
      where: { id: sub.id },
      data: d.decision === "RETURN"
        ? { state: "RETURNED", feedback: d.feedback ?? null, score: null, gradedById: ctx.userId, gradedAt: now, releasedAt: now }
        : { state: "GRADED", score: scoreValue, feedback: d.feedback ?? null, gradedById: ctx.userId, gradedAt: now, releasedAt: d.release ? now : null },
    });
    await writeAudit(tx, actorOf(ctx), { action: d.decision === "RETURN" ? "submission.return" : "submission.grade", entityType: "AssignmentSubmission", entityId: sub.id, summary: a.title, changes: { studentId, score: scoreValue, released: d.decision === "RETURN" || d.release } });
    if (d.decision === "RETURN" || d.release) await notifyFamilies(tx, ctx.schoolId, [studentId], d.decision === "RETURN" ? `Please revise: ${a.title}` : `Feedback ready: ${a.title}`, d.feedback ?? "Open the homework to see the result.", (sid) => `/family/${sid}/assignments/${assignmentId}`);
  });
}

/** Releases every marked-but-unreleased result of an assignment at once. */
export async function releaseResults(ctx: AuthContext, assignmentId: string) {
  const a = await loadForTeacher(ctx, assignmentId);
  const pending = await db.assignmentSubmission.findMany({ where: { assignmentId, schoolId: ctx.schoolId, state: "GRADED", releasedAt: null }, select: { id: true, studentId: true } });
  if (!pending.length) return 0;
  await db.$transaction(async (tx) => {
    await tx.assignmentSubmission.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { releasedAt: new Date() } });
    await writeAudit(tx, actorOf(ctx), { action: "assignment.release_results", entityType: "Assignment", entityId: assignmentId, summary: a.title, changes: { count: pending.length } });
    await notifyFamilies(tx, ctx.schoolId, pending.map((p) => p.studentId), `Feedback ready: ${a.title}`, "Open the homework to see the result.", (sid) => `/family/${sid}/assignments/${assignmentId}`);
  });
  return pending.length;
}

/** Work handed in on paper (many students have no account): the teacher records it so it can be marked like any other. */
export async function recordPaper(ctx: AuthContext, assignmentId: string, studentId: string, input: unknown = {}) {
  const a = await loadForTeacher(ctx, assignmentId);
  if (!a.publishedAt) throw conflict("Publish the assignment first.");
  const d = parse(z.object({ note: optText(1000), late: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()) }), input);
  if (!(await rosterOf(db, a)).some((r) => r.studentId === studentId)) throw notFound("Student");
  if (await db.assignmentSubmission.findFirst({ where: { assignmentId, studentId } })) throw conflict("Work is already recorded for this student.");
  await db.$transaction(async (tx) => {
    const s = await tx.assignmentSubmission.create({ data: { schoolId: ctx.schoolId, assignmentId, studentId, via: "PAPER", text: d.note ?? null, late: d.late } });
    await writeAudit(tx, actorOf(ctx), { action: "submission.record_paper", entityType: "AssignmentSubmission", entityId: s.id, summary: a.title, changes: { studentId, late: d.late } });
  });
}

// ───────────────────────── Student: handing in work ─────────────────────────

async function studentOf(ctx: AuthContext) {
  if (ctx.userType !== "STUDENT") throw forbidden("Only students can hand in work.");
  const s = await db.student.findFirst({ where: { userId: ctx.userId, schoolId: ctx.schoolId, status: "ENROLLED" }, select: { id: true } });
  if (!s) throw forbidden("Your student record is not active.");
  return s.id;
}

/** Does this published assignment belong to the student's current class (and stream)? */
async function assignedTo(studentId: string, schoolId: string, a: { classId: string; streamId: string | null }) {
  const p = await currentPlacement(db, schoolId, studentId);
  return !!p && p.classId === a.classId && (!a.streamId || a.streamId === p.streamId);
}

export type IncomingFile = { fileName: string; bytes: Buffer };

/**
 * The student's answer. First hand-in creates the record; handing in again is allowed while it is waiting for the teacher or has
 * been returned for revision, never once it is marked. Files are checked before anything is saved.
 */
export async function submitWork(ctx: AuthContext, assignmentId: string, input: unknown, files: IncomingFile[] = []) {
  const studentId = await studentOf(ctx);
  const d = parse(z.object({ text: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().trim().max(MAX_TEXT, `Maximum ${MAX_TEXT} characters`).optional()) }), input);
  const a = await db.assignment.findFirst({ where: { id: assignmentId, schoolId: ctx.schoolId, publishedAt: { not: null } } });
  if (!a || !(await assignedTo(studentId, ctx.schoolId, a))) throw notFound("Assignment");
  if (a.closedAt) throw conflict("This assignment is closed and no longer accepts work.");
  if (!(await consumeRateLimit(`submit:${ctx.userId}`, SUBMIT_LIMIT.max, SUBMIT_LIMIT.windowMs))) throw new AppError("RATE_LIMITED", "You are handing in too often. Please wait a little and try again.");
  for (const f of files) checkLearningFile(f.bytes);
  if (files.length && !getStorage()) throw invalid("File storage is not configured, so files cannot be attached yet. You can still write your answer as text.");
  const existing = await db.assignmentSubmission.findFirst({ where: { assignmentId, studentId } });
  if (existing && existing.state === "GRADED") throw conflict("This work has been marked. Ask your teacher if you need to change it.");
  if (existing?.via === "PAPER") throw conflict("Your teacher recorded this work on paper.");
  const hasFiles = !!existing && (await db.learningFile.count({ where: { schoolId: ctx.schoolId, ownerKind: "SUBMISSION", ownerId: existing.id, deletedAt: null } })) > 0;
  if (!d.text && !files.length && !hasFiles) throw invalid("Please correct the highlighted fields.", { text: "Write your answer or attach a file" });
  const now = new Date();
  const late = now.getTime() > a.dueAt.getTime();
  const sub = await db.$transaction(async (tx) => {
    const s = existing
      ? await tx.assignmentSubmission.update({ where: { id: existing.id }, data: { text: d.text ?? null, state: "SUBMITTED", late, revision: { increment: 1 }, submittedAt: now, score: null, releasedAt: null } })
      : await tx.assignmentSubmission.create({ data: { schoolId: ctx.schoolId, assignmentId, studentId, via: "ONLINE", text: d.text ?? null, late, submittedAt: now } });
    await writeAudit(tx, actorOf(ctx), { action: existing ? "submission.resubmit" : "submission.submit", entityType: "AssignmentSubmission", entityId: s.id, summary: a.title, changes: { revision: s.revision, late, files: files.length } });
    return s;
  });
  for (const f of files) await storeLearningFile(ctx, { kind: "SUBMISSION", id: sub.id }, f);
  return { id: sub.id, late, revision: sub.revision };
}

export async function removeMySubmissionFile(ctx: AuthContext, fileId: string) {
  const studentId = await studentOf(ctx);
  const f = await db.learningFile.findFirst({ where: { id: fileId, schoolId: ctx.schoolId, ownerKind: "SUBMISSION", deletedAt: null } });
  const sub = f && (await db.assignmentSubmission.findFirst({ where: { id: f.ownerId, studentId, schoolId: ctx.schoolId } }));
  if (!f || !sub) throw notFound("File");
  if (sub.state === "GRADED") throw conflict("This work has been marked.");
  const a = await db.assignment.findFirst({ where: { id: sub.assignmentId } });
  if (a?.closedAt) throw conflict("This assignment is closed.");
  await removeLearningFile(ctx, fileId);
}

// ───────────────────────── Family portal (student + parents, read-only for parents) ─────────────────────────

/** What the family may see of a submission: the teacher's score and feedback only once released. */
function familyView(s: { id: string; via: string; text: string | null; state: string; late: boolean; revision: number; submittedAt: Date; score: Prisma.Decimal | null; feedback: string | null; releasedAt: Date | null }) {
  const released = !!s.releasedAt;
  // a mark the teacher has not released yet is not revealed, not even as "marked"
  return { id: s.id, via: s.via, text: s.text, state: s.state === "GRADED" && !released ? "SUBMITTED" : s.state, late: s.late, revision: s.revision, submittedAt: s.submittedAt, released, score: released ? num(s.score) : null, feedback: released ? s.feedback : null };
}

export async function childAssignments(ctx: AuthContext, studentId: string) {
  await childOrThrow(ctx, studentId);
  const p = await currentPlacement(db, ctx.schoolId, studentId);
  if (!p) return { canSubmit: ctx.userType === "STUDENT", items: [] };
  const rows = await db.assignment.findMany({
    where: { schoolId: ctx.schoolId, academicYearId: p.academicYearId, classId: p.classId, publishedAt: { not: null }, OR: [{ streamId: null }, { streamId: p.streamId }] },
    orderBy: { dueAt: "desc" }, take: 200,
  });
  const [subs, subjects] = await Promise.all([
    db.assignmentSubmission.findMany({ where: { schoolId: ctx.schoolId, studentId, assignmentId: { in: rows.map((r) => r.id) } } }),
    db.subject.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true } }),
  ]);
  const now = Date.now();
  return {
    canSubmit: ctx.userType === "STUDENT",
    items: rows.map((a) => {
      const s = subs.find((x) => x.assignmentId === a.id);
      const open = !a.closedAt;
      return { id: a.id, title: a.title, subjectName: subjects.find((x) => x.id === a.subjectId)?.name ?? "", dueAt: a.dueAt, maxScore: num(a.maxScore), closed: !open, overdue: open && a.dueAt.getTime() < now && !s, submission: s ? familyView(s) : null };
    }),
  };
}

export async function getChildAssignment(ctx: AuthContext, studentId: string, assignmentId: string) {
  await childOrThrow(ctx, studentId);
  const p = await currentPlacement(db, ctx.schoolId, studentId);
  const a = await db.assignment.findFirst({ where: { id: assignmentId, schoolId: ctx.schoolId, publishedAt: { not: null } } });
  if (!p || !a || a.classId !== p.classId || (a.streamId && a.streamId !== p.streamId)) throw notFound("Assignment");
  const [s, subject, files] = await Promise.all([
    db.assignmentSubmission.findFirst({ where: { assignmentId, studentId, schoolId: ctx.schoolId } }),
    db.subject.findUnique({ where: { id: a.subjectId }, select: { name: true } }),
    listLearningFiles(ctx.schoolId, "ASSIGNMENT", assignmentId),
  ]);
  const myFiles = s ? await listLearningFiles(ctx.schoolId, "SUBMISSION", s.id) : [];
  const editable = ctx.userType === "STUDENT" && !a.closedAt && (!s || (s.via === "ONLINE" && s.state !== "GRADED"));
  return {
    assignment: { id: a.id, title: a.title, instructions: a.instructions, dueAt: a.dueAt, maxScore: num(a.maxScore), closed: !!a.closedAt, subjectName: subject?.name ?? "" },
    files, submission: s ? familyView(s) : null, submissionFiles: myFiles, canSubmit: editable, filesEnabled: !!getStorage(),
  };
}
