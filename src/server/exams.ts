import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { conflict, invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { actorOf, writeAudit } from "@/server/audit";
import { optDateOnly, optText, optUuid, parse, text, uuid } from "@/lib/validation";

const decimalField = (min: number, max: number, label: string) =>
  z.coerce.number({ error: `${label} must be a number` }).min(min, `${label} must be at least ${min}`).max(max, `${label} must be at most ${max}`)
    .refine((n) => Math.round(n * 100) / 100 === n, `${label} can have at most 2 decimals`);

const examSchema = z.object({
  termId: uuid(),
  name: text(80),
  category: z.enum(["MONTHLY", "MIDTERM", "TERMINAL", "ANNUAL", "OTHER"]).default("TERMINAL"),
  examDate: optDateOnly(),
  maxMarks: decimalField(1, 1000, "Maximum marks").default(100),
  weight: decimalField(0.01, 100, "Weight").default(100),
  submissionDeadline: optDateOnly(),
  gradingScaleId: optUuid(),
  notes: optText(300),
});

export async function listExams(ctx: AuthContext, filter: { termId?: string; academicYearId?: string } = {}) {
  requirePermission(ctx, "exam.read");
  return db.exam.findMany({
    where: { schoolId: ctx.schoolId, ...(filter.termId ? { termId: filter.termId } : {}), ...(filter.academicYearId ? { academicYearId: filter.academicYearId } : {}) },
    orderBy: [{ examDate: "desc" }, { createdAt: "desc" }],
    include: { _count: { select: { subjects: true } } },
  });
}

async function termOf(client: Tx | typeof db, schoolId: string, termId: string) {
  const term = await client.term.findFirst({ where: { id: termId, schoolId } });
  if (!term) throw invalid("Please correct the highlighted fields.", { termId: "Choose a term" });
  return term;
}

export async function createExam(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "exam.manage");
  const d = parse(examSchema, input);
  const term = await termOf(db, ctx.schoolId, d.termId);
  if (d.gradingScaleId && !(await db.gradingScale.findFirst({ where: { id: d.gradingScaleId, schoolId: ctx.schoolId, isActive: true }, select: { id: true } }))) {
    throw invalid("Please correct the highlighted fields.", { gradingScaleId: "Choose an active grading scale" });
  }
  if (await db.exam.findUnique({ where: { schoolId_termId_name: { schoolId: ctx.schoolId, termId: d.termId, name: d.name } } })) {
    throw invalid("Please correct the highlighted fields.", { name: "This term already has an examination with this name" });
  }
  return db.$transaction(async (tx) => {
    const exam = await tx.exam.create({
      data: {
        schoolId: ctx.schoolId, academicYearId: term.academicYearId, termId: d.termId, name: d.name, category: d.category,
        examDate: d.examDate ?? null, maxMarks: d.maxMarks, weight: d.weight, submissionDeadline: d.submissionDeadline ?? null,
        gradingScaleId: d.gradingScaleId ?? null, createdById: ctx.userId,
      },
    });
    await writeAudit(tx, actorOf(ctx), { action: "exam.create", entityType: "Exam", entityId: exam.id, summary: exam.name });
    return exam;
  });
}

/**
 * Name, date, deadline and category may always change. Weight, scale and the default maximum feed the results,
 * so they are frozen once any submission for this exam has been locked (unlock it first, with a reason).
 */
export async function updateExam(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "exam.manage");
  const d = parse(examSchema, input);
  const exam = await db.exam.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!exam) throw notFound("Examination");
  if (d.termId !== exam.termId) throw invalid("Please correct the highlighted fields.", { termId: "The term of an examination cannot be changed" });
  if (d.name !== exam.name && (await db.exam.findUnique({ where: { schoolId_termId_name: { schoolId: ctx.schoolId, termId: exam.termId, name: d.name } } }))) {
    throw invalid("Please correct the highlighted fields.", { name: "This term already has an examination with this name" });
  }
  const scaleChanged = (d.gradingScaleId ?? null) !== (exam.gradingScaleId ?? null);
  const weightChanged = Number(exam.weight) !== d.weight;
  if (scaleChanged || weightChanged) {
    const locked = await db.resultSubmission.count({ where: { schoolId: ctx.schoolId, status: "LOCKED", examSubject: { examId: id } } });
    if (locked) throw conflict("Some results of this examination are locked. Unlock them before changing the weight or grading scale.");
  }
  if (d.gradingScaleId && !(await db.gradingScale.findFirst({ where: { id: d.gradingScaleId, schoolId: ctx.schoolId }, select: { id: true } }))) {
    throw invalid("Please correct the highlighted fields.", { gradingScaleId: "Choose a grading scale" });
  }
  return db.$transaction(async (tx) => {
    const row = await tx.exam.update({
      where: { id },
      data: { name: d.name, category: d.category, examDate: d.examDate ?? null, maxMarks: d.maxMarks, weight: d.weight, submissionDeadline: d.submissionDeadline ?? null, gradingScaleId: d.gradingScaleId ?? null },
    });
    await writeAudit(tx, actorOf(ctx), { action: "exam.update", entityType: "Exam", entityId: id, summary: row.name, changes: { weight: [Number(exam.weight), d.weight], scale: [exam.gradingScaleId, d.gradingScaleId ?? null] } });
    return row;
  });
}

export async function deleteExam(ctx: AuthContext, id: string) {
  requirePermission(ctx, "exam.manage");
  const exam = await db.exam.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!exam) throw notFound("Examination");
  const marks = await db.mark.count({ where: { schoolId: ctx.schoolId, examSubject: { examId: id } } });
  if (marks) throw conflict("Marks have already been entered for this examination, so it cannot be deleted.");
  await db.$transaction(async (tx) => {
    await tx.resultSubmission.deleteMany({ where: { schoolId: ctx.schoolId, examSubject: { examId: id } } });
    await tx.exam.delete({ where: { id } });
    await writeAudit(tx, actorOf(ctx), { action: "exam.delete", entityType: "Exam", entityId: id, summary: exam.name });
  });
}

const addSubjectsSchema = z.object({
  classIds: z.preprocess((v) => (Array.isArray(v) ? v : v ? [v] : []), z.array(uuid()).min(1, "Choose at least one class")),
  subjectIds: z.preprocess((v) => (Array.isArray(v) ? v : v ? [v] : []), z.array(uuid())).optional(),
  maxMarks: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), decimalField(1, 1000, "Maximum marks").optional()),
});

/**
 * Adds subjects to an examination for the chosen classes. With no subjects given, every subject of each class
 * (class_subjects) is added. One submission unit is created per stream, or one for the whole class when it has no streams.
 */
export async function addExamSubjects(ctx: AuthContext, examId: string, input: unknown) {
  requirePermission(ctx, "exam.manage");
  const d = parse(addSubjectsSchema, input);
  const exam = await db.exam.findFirst({ where: { id: examId, schoolId: ctx.schoolId } });
  if (!exam) throw notFound("Examination");
  const classes = await db.schoolClass.findMany({ where: { id: { in: d.classIds }, schoolId: ctx.schoolId }, include: { streams: { select: { id: true } }, subjects: { select: { subjectId: true } } } });
  if (classes.length !== new Set(d.classIds).size) throw notFound("Class");
  const maxMarks = d.maxMarks ?? Number(exam.maxMarks);
  let added = 0;
  await db.$transaction(async (tx) => {
    for (const cls of classes) {
      const subjectIds = d.subjectIds?.length ? d.subjectIds : cls.subjects.map((s) => s.subjectId);
      if (d.subjectIds?.length) {
        const offered = new Set(cls.subjects.map((s) => s.subjectId));
        if (d.subjectIds.some((s) => !offered.has(s))) throw invalid("Please correct the highlighted fields.", { subjectIds: `A selected subject is not taught in ${cls.name}` });
      }
      if (!subjectIds.length) throw invalid("Please correct the highlighted fields.", { classIds: `${cls.name} has no subjects. Add subjects to the class first.` });
      for (const subjectId of subjectIds) {
        const units: (string | null)[] = cls.streams.length ? cls.streams.map((s) => s.id) : [null];
        const existing = await tx.examSubject.findUnique({ where: { examId_classId_subjectId: { examId, classId: cls.id, subjectId } }, include: { submissions: { select: { streamId: true } } } });
        if (existing) {
          // Already added: only create the units for streams that were added to the class since.
          const have = new Set(existing.submissions.map((u) => u.streamId));
          const missing = units.filter((u) => !have.has(u));
          if (missing.length) await tx.resultSubmission.createMany({ data: missing.map((streamId) => ({ schoolId: ctx.schoolId, examSubjectId: existing.id, streamId })) });
          continue;
        }
        const es = await tx.examSubject.create({ data: { schoolId: ctx.schoolId, examId, classId: cls.id, subjectId, maxMarks } });
        await tx.resultSubmission.createMany({ data: units.map((streamId) => ({ schoolId: ctx.schoolId, examSubjectId: es.id, streamId })) });
        added++;
      }
    }
    await writeAudit(tx, actorOf(ctx), { action: "exam.subjects_add", entityType: "Exam", entityId: examId, summary: exam.name, changes: { added, classes: classes.length } });
  });
  return { added };
}

/** Removes a subject from an examination, only while no marks exist for it. */
export async function removeExamSubject(ctx: AuthContext, examSubjectId: string) {
  requirePermission(ctx, "exam.manage");
  const es = await db.examSubject.findFirst({ where: { id: examSubjectId, schoolId: ctx.schoolId }, include: { exam: { select: { name: true } } } });
  if (!es) throw notFound("Examination subject");
  if (await db.mark.count({ where: { examSubjectId } })) throw conflict("Marks have already been entered for this subject, so it cannot be removed.");
  await db.$transaction(async (tx) => {
    await tx.examSubject.delete({ where: { id: examSubjectId } });
    await writeAudit(tx, actorOf(ctx), { action: "exam.subject_remove", entityType: "Exam", entityId: es.examId, summary: es.exam.name, changes: { classId: es.classId, subjectId: es.subjectId } });
  });
}

/** Examination with its per-class progress. Teachers (read_assigned) only see the submissions in their scope via marks.ts. */
export async function getExam(ctx: AuthContext, id: string) {
  requirePermission(ctx, "exam.read");
  const exam = await db.exam.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!exam) throw notFound("Examination");
  const [term, subjects] = await Promise.all([
    db.term.findUnique({ where: { id: exam.termId }, include: { academicYear: { select: { name: true } } } }),
    db.examSubject.findMany({ where: { examId: id, schoolId: ctx.schoolId } }),
  ]);
  const [classes, subjectRows, submissions, streams] = await Promise.all([
    db.schoolClass.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(subjects.map((s) => s.classId))] } }, orderBy: { sortOrder: "asc" } }),
    db.subject.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(subjects.map((s) => s.subjectId))] } }, orderBy: { name: "asc" } }),
    db.resultSubmission.findMany({ where: { schoolId: ctx.schoolId, examSubjectId: { in: subjects.map((s) => s.id) } } }),
    db.stream.findMany({ where: { schoolId: ctx.schoolId, classId: { in: [...new Set(subjects.map((s) => s.classId))] } } }),
  ]);
  return { exam, term, examSubjects: subjects, classes, subjects: subjectRows, submissions, streams };
}

/** Terms and classes for pickers; readable by anyone who may see examinations (names only). */
export async function listExamTerms(ctx: AuthContext) {
  requirePermission(ctx, "exam.read");
  return db.term.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ academicYear: { startsOn: "desc" } }, { sequence: "asc" }], include: { academicYear: { select: { name: true } } } });
}

export async function listExamClasses(ctx: AuthContext) {
  requirePermission(ctx, "exam.read");
  return db.schoolClass.findMany({
    where: { schoolId: ctx.schoolId, isActive: true },
    orderBy: [{ level: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
    include: { streams: { orderBy: { name: "asc" }, select: { id: true, name: true } }, _count: { select: { subjects: true } } },
  });
}
