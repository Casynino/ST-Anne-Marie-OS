import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { conflict, invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { actorOf, diffFields, writeAudit } from "@/server/audit";
import { dateOnly, optText, parse, text, uuid, optUuid } from "@/lib/validation";

const audit = (tx: Tx, ctx: AuthContext, action: string, entityType: string, entityId: string, summary?: string, changes?: Record<string, unknown>) =>
  writeAudit(tx, actorOf(ctx), { action, entityType, entityId, summary, changes });

// ───────────────────────── Academic years & terms ─────────────────────────

const yearSchema = z
  .object({ name: text(40), startsOn: dateOnly(), endsOn: dateOnly() })
  .refine((v) => v.endsOn > v.startsOn, { path: ["endsOn"], message: "End date must be after the start date" });

export async function listAcademicYears(ctx: AuthContext) {
  requirePermission(ctx, "academic.read");
  return db.academicYear.findMany({
    where: { schoolId: ctx.schoolId },
    orderBy: { startsOn: "desc" },
    include: { terms: { orderBy: { sequence: "asc" } } },
  });
}

export async function getCurrentAcademicContext(schoolId: string) {
  const [year, term] = await Promise.all([
    db.academicYear.findFirst({ where: { schoolId, isCurrent: true } }),
    db.term.findFirst({ where: { schoolId, isCurrent: true } }),
  ]);
  return { year, term };
}

async function assertYearNoOverlap(schoolId: string, startsOn: Date, endsOn: Date, excludeId?: string) {
  const clash = await db.academicYear.findFirst({
    where: { schoolId, id: excludeId ? { not: excludeId } : undefined, startsOn: { lte: endsOn }, endsOn: { gte: startsOn } },
  });
  if (clash) throw invalid("Please correct the highlighted fields.", { startsOn: `Overlaps the academic year ${clash.name}` });
}

export async function createAcademicYear(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "academic.manage");
  const data = parse(yearSchema, input);
  await assertYearNoOverlap(ctx.schoolId, data.startsOn, data.endsOn);
  if (await db.academicYear.findUnique({ where: { schoolId_name: { schoolId: ctx.schoolId, name: data.name } } })) {
    throw invalid("Please correct the highlighted fields.", { name: "An academic year with this name already exists" });
  }
  return db.$transaction(async (tx) => {
    const year = await tx.academicYear.create({ data: { ...data, schoolId: ctx.schoolId } });
    await audit(tx, ctx, "academic_year.create", "AcademicYear", year.id, year.name);
    return year;
  });
}

export async function updateAcademicYear(ctx: AuthContext, yearId: string, input: unknown) {
  requirePermission(ctx, "academic.manage");
  const data = parse(yearSchema, input);
  const year = await db.academicYear.findFirst({ where: { id: yearId, schoolId: ctx.schoolId }, include: { terms: true } });
  if (!year) throw notFound("Academic year");
  await assertYearNoOverlap(ctx.schoolId, data.startsOn, data.endsOn, yearId);
  if (year.terms.some((t) => t.startsOn < data.startsOn || t.endsOn > data.endsOn)) {
    throw invalid("Please correct the highlighted fields.", { startsOn: "The year must still contain all of its terms" });
  }
  await db.$transaction(async (tx) => {
    await tx.academicYear.update({ where: { id: yearId }, data });
    await audit(tx, ctx, "academic_year.update", "AcademicYear", yearId, data.name, diffFields(year, data, ["name", "startsOn", "endsOn"]));
  });
}

export async function setCurrentAcademicYear(ctx: AuthContext, yearId: string) {
  requirePermission(ctx, "academic.manage");
  const year = await db.academicYear.findFirst({ where: { id: yearId, schoolId: ctx.schoolId } });
  if (!year) throw notFound("Academic year");
  if (year.isCurrent) return;
  await db.$transaction(async (tx) => {
    // Only one current year/term per school (partial unique index); clear first, then set.
    await tx.term.updateMany({ where: { schoolId: ctx.schoolId, isCurrent: true }, data: { isCurrent: false } });
    await tx.academicYear.updateMany({ where: { schoolId: ctx.schoolId, isCurrent: true }, data: { isCurrent: false } });
    await tx.academicYear.update({ where: { id: yearId }, data: { isCurrent: true } });
    await audit(tx, ctx, "academic_year.set_current", "AcademicYear", yearId, year.name);
  });
}

const termSchema = z
  .object({
    academicYearId: uuid(),
    name: text(40),
    sequence: z.coerce.number().int().min(1, "Must be 1 or more").max(12),
    startsOn: dateOnly(),
    endsOn: dateOnly(),
  })
  .refine((v) => v.endsOn > v.startsOn, { path: ["endsOn"], message: "End date must be after the start date" });

async function validateTerm(schoolId: string, data: z.infer<typeof termSchema>, excludeId?: string) {
  const year = await db.academicYear.findFirst({ where: { id: data.academicYearId, schoolId }, include: { terms: true } });
  if (!year) throw notFound("Academic year");
  if (data.startsOn < year.startsOn || data.endsOn > year.endsOn) {
    throw invalid("Please correct the highlighted fields.", { startsOn: `Term must fall within ${year.name}` });
  }
  const others = year.terms.filter((t) => t.id !== excludeId);
  if (others.some((t) => t.sequence === data.sequence)) throw invalid("Please correct the highlighted fields.", { sequence: "This term number is already used" });
  if (others.some((t) => t.name.toLowerCase() === data.name.toLowerCase())) throw invalid("Please correct the highlighted fields.", { name: "This term name is already used" });
  const overlap = others.find((t) => t.startsOn <= data.endsOn && t.endsOn >= data.startsOn);
  if (overlap) throw invalid("Please correct the highlighted fields.", { startsOn: `Overlaps ${overlap.name}` });
}

export async function createTerm(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "academic.manage");
  const data = parse(termSchema, input);
  await validateTerm(ctx.schoolId, data);
  return db.$transaction(async (tx) => {
    const term = await tx.term.create({ data: { ...data, schoolId: ctx.schoolId } });
    await audit(tx, ctx, "term.create", "Term", term.id, term.name);
    return term;
  });
}

export async function updateTerm(ctx: AuthContext, termId: string, input: unknown) {
  requirePermission(ctx, "academic.manage");
  const data = parse(termSchema, input);
  const term = await db.term.findFirst({ where: { id: termId, schoolId: ctx.schoolId } });
  if (!term) throw notFound("Term");
  if (term.academicYearId !== data.academicYearId) throw invalid("A term cannot be moved to another academic year.");
  await validateTerm(ctx.schoolId, data, termId);
  await db.$transaction(async (tx) => {
    await tx.term.update({ where: { id: termId }, data });
    await audit(tx, ctx, "term.update", "Term", termId, data.name, diffFields(term, data, ["name", "sequence", "startsOn", "endsOn"]));
  });
}

export async function setCurrentTerm(ctx: AuthContext, termId: string) {
  requirePermission(ctx, "academic.manage");
  const term = await db.term.findFirst({ where: { id: termId, schoolId: ctx.schoolId }, include: { academicYear: true } });
  if (!term) throw notFound("Term");
  if (!term.academicYear.isCurrent) throw conflict("Set the academic year as current before choosing its current term.");
  if (term.isCurrent) return;
  await db.$transaction(async (tx) => {
    await tx.term.updateMany({ where: { schoolId: ctx.schoolId, isCurrent: true }, data: { isCurrent: false } });
    await tx.term.update({ where: { id: termId }, data: { isCurrent: true } });
    await audit(tx, ctx, "term.set_current", "Term", termId, term.name);
  });
}

// ───────────────────────── Levels, classes, streams ─────────────────────────

const levelSchema = z.object({ name: text(60), nameSw: optText(60), sortOrder: z.coerce.number().int().min(0).max(999).default(0) });

export async function listLevels(ctx: AuthContext) {
  requirePermission(ctx, "academic.read");
  return db.academicLevel.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { classes: true } } } });
}

export async function createLevel(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "academic.manage");
  const data = parse(levelSchema, input);
  if (await db.academicLevel.findUnique({ where: { schoolId_name: { schoolId: ctx.schoolId, name: data.name } } })) {
    throw invalid("Please correct the highlighted fields.", { name: "A level with this name already exists" });
  }
  return db.$transaction(async (tx) => {
    const level = await tx.academicLevel.create({ data: { ...data, schoolId: ctx.schoolId } });
    await audit(tx, ctx, "level.create", "AcademicLevel", level.id, level.name);
    return level;
  });
}

export async function deleteLevel(ctx: AuthContext, levelId: string) {
  requirePermission(ctx, "academic.manage");
  const level = await db.academicLevel.findFirst({ where: { id: levelId, schoolId: ctx.schoolId }, include: { _count: { select: { classes: true } } } });
  if (!level) throw notFound("Level");
  if (level._count.classes) throw conflict("This level still has classes. Move or deactivate them first.");
  await db.$transaction(async (tx) => {
    await tx.academicLevel.delete({ where: { id: levelId } });
    await audit(tx, ctx, "level.delete", "AcademicLevel", levelId, level.name);
  });
}

export async function listClasses(ctx: AuthContext) {
  requirePermission(ctx, "academic.read");
  return db.schoolClass.findMany({
    where: { schoolId: ctx.schoolId },
    orderBy: [{ level: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
    include: { level: true, streams: { orderBy: { name: "asc" } }, _count: { select: { subjects: true } } },
  });
}

const classSchema = z.object({ levelId: uuid(), name: text(60), nameSw: optText(60), sortOrder: z.coerce.number().int().min(0).max(999).default(0) });

export async function createClass(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "academic.manage");
  const data = parse(classSchema, input);
  if (!(await db.academicLevel.findFirst({ where: { id: data.levelId, schoolId: ctx.schoolId } }))) throw notFound("Level");
  if (await db.schoolClass.findUnique({ where: { schoolId_name: { schoolId: ctx.schoolId, name: data.name } } })) {
    throw invalid("Please correct the highlighted fields.", { name: "A class with this name already exists" });
  }
  return db.$transaction(async (tx) => {
    const cls = await tx.schoolClass.create({ data: { ...data, schoolId: ctx.schoolId } });
    await audit(tx, ctx, "class.create", "SchoolClass", cls.id, cls.name);
    return cls;
  });
}

/** Adds many classes to a level at once (one name per line); existing names are skipped. */
export async function createClassesBulk(ctx: AuthContext, levelId: string, names: string[]) {
  requirePermission(ctx, "academic.manage");
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (!clean.length) throw invalid("Enter at least one class name.", { names: "Required" });
  if (clean.some((n) => n.length > 60)) throw invalid("Class names can be at most 60 characters.", { names: "Too long" });
  if (!(await db.academicLevel.findFirst({ where: { id: levelId, schoolId: ctx.schoolId } }))) throw notFound("Level");
  return db.$transaction(async (tx) => {
    const existing = new Set((await tx.schoolClass.findMany({ where: { schoolId: ctx.schoolId }, select: { name: true } })).map((c) => c.name.toLowerCase()));
    const todo = clean.filter((n) => !existing.has(n.toLowerCase()));
    const max = (await tx.schoolClass.aggregate({ where: { schoolId: ctx.schoolId, levelId }, _max: { sortOrder: true } }))._max.sortOrder ?? 0;
    if (todo.length) {
      await tx.schoolClass.createMany({ data: todo.map((name, i) => ({ schoolId: ctx.schoolId, levelId, name, sortOrder: max + i + 1 })) });
      await audit(tx, ctx, "class.create_bulk", "SchoolClass", levelId, `${todo.length} classes`, { names: todo });
    }
    return { created: todo.length, skipped: clean.length - todo.length };
  });
}

export async function updateClass(ctx: AuthContext, classId: string, input: unknown) {
  requirePermission(ctx, "academic.manage");
  const data = parse(classSchema.extend({ isActive: z.preprocess((v) => v === "on" || v === true || v === "true", z.boolean()) }), input);
  const cls = await db.schoolClass.findFirst({ where: { id: classId, schoolId: ctx.schoolId } });
  if (!cls) throw notFound("Class");
  if (!(await db.academicLevel.findFirst({ where: { id: data.levelId, schoolId: ctx.schoolId } }))) throw notFound("Level");
  const clash = await db.schoolClass.findFirst({ where: { schoolId: ctx.schoolId, name: data.name, id: { not: classId } } });
  if (clash) throw invalid("Please correct the highlighted fields.", { name: "A class with this name already exists" });
  await db.$transaction(async (tx) => {
    await tx.schoolClass.update({ where: { id: classId }, data });
    await audit(tx, ctx, "class.update", "SchoolClass", classId, data.name, diffFields(cls, data, ["name", "nameSw", "levelId", "sortOrder", "isActive"]));
  });
}

export async function createStream(ctx: AuthContext, classId: string, name: string) {
  requirePermission(ctx, "academic.manage");
  const data = parse(z.object({ name: text(30) }), { name });
  if (!(await db.schoolClass.findFirst({ where: { id: classId, schoolId: ctx.schoolId } }))) throw notFound("Class");
  if (await db.stream.findUnique({ where: { classId_name: { classId, name: data.name } } })) {
    throw invalid("Please correct the highlighted fields.", { name: "This stream already exists for the class" });
  }
  return db.$transaction(async (tx) => {
    const stream = await tx.stream.create({ data: { schoolId: ctx.schoolId, classId, name: data.name } });
    await audit(tx, ctx, "stream.create", "Stream", stream.id, data.name);
    return stream;
  });
}

export async function deleteStream(ctx: AuthContext, streamId: string) {
  requirePermission(ctx, "academic.manage");
  const stream = await db.stream.findFirst({
    where: { id: streamId, schoolId: ctx.schoolId },
    include: { _count: { select: { enrollments: true, classTeachers: true, subjectTeachers: true } } },
  });
  if (!stream) throw notFound("Stream");
  const { enrollments, classTeachers, subjectTeachers } = stream._count;
  if (enrollments || classTeachers || subjectTeachers) throw conflict("This stream is already used by students or teacher assignments and cannot be deleted.");
  await db.$transaction(async (tx) => {
    await tx.stream.delete({ where: { id: streamId } });
    await audit(tx, ctx, "stream.delete", "Stream", streamId, stream.name);
  });
}

// ───────────────────────── Subjects ─────────────────────────

const subjectSchema = z.object({
  code: z.string().trim().min(1, "Required").max(20).transform((v) => v.toUpperCase()),
  name: text(80),
  nameSw: optText(80),
});

export async function listSubjects(ctx: AuthContext) {
  requirePermission(ctx, "academic.read");
  return db.subject.findMany({ where: { schoolId: ctx.schoolId }, orderBy: { name: "asc" }, include: { _count: { select: { classSubjects: true } } } });
}

export async function createSubject(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "academic.manage");
  const data = parse(subjectSchema, input);
  if (await db.subject.findUnique({ where: { schoolId_code: { schoolId: ctx.schoolId, code: data.code } } })) {
    throw invalid("Please correct the highlighted fields.", { code: "This subject code already exists" });
  }
  return db.$transaction(async (tx) => {
    const subject = await tx.subject.create({ data: { ...data, schoolId: ctx.schoolId } });
    await audit(tx, ctx, "subject.create", "Subject", subject.id, `${subject.code} ${subject.name}`);
    return subject;
  });
}

export async function updateSubject(ctx: AuthContext, subjectId: string, input: unknown) {
  requirePermission(ctx, "academic.manage");
  const data = parse(subjectSchema.extend({ isActive: z.preprocess((v) => v === "on" || v === true || v === "true", z.boolean()) }), input);
  const subject = await db.subject.findFirst({ where: { id: subjectId, schoolId: ctx.schoolId } });
  if (!subject) throw notFound("Subject");
  if (await db.subject.findFirst({ where: { schoolId: ctx.schoolId, code: data.code, id: { not: subjectId } } })) {
    throw invalid("Please correct the highlighted fields.", { code: "This subject code already exists" });
  }
  await db.$transaction(async (tx) => {
    await tx.subject.update({ where: { id: subjectId }, data });
    await audit(tx, ctx, "subject.update", "Subject", subjectId, data.name, diffFields(subject, data, ["code", "name", "nameSw", "isActive"]));
  });
}

/** Replaces the set of subjects taught in a class. Subjects with teacher assignments cannot be removed. */
export async function setClassSubjects(ctx: AuthContext, classId: string, subjectIds: string[]) {
  requirePermission(ctx, "academic.manage");
  const wanted = [...new Set(subjectIds)];
  if (!(await db.schoolClass.findFirst({ where: { id: classId, schoolId: ctx.schoolId } }))) throw notFound("Class");
  const valid = await db.subject.count({ where: { id: { in: wanted }, schoolId: ctx.schoolId } });
  if (valid !== wanted.length) throw invalid("One of the selected subjects is not valid.");
  await db.$transaction(async (tx) => {
    const current = await tx.classSubject.findMany({ where: { classId } });
    const removed = current.filter((c) => !wanted.includes(c.subjectId)).map((c) => c.subjectId);
    const added = wanted.filter((id) => !current.some((c) => c.subjectId === id));
    if (removed.length && (await tx.subjectTeacher.count({ where: { classId, subjectId: { in: removed } } }))) {
      throw conflict("Some removed subjects still have teachers assigned in this class. Remove those assignments first.");
    }
    if (removed.length) await tx.classSubject.deleteMany({ where: { classId, subjectId: { in: removed } } });
    if (added.length) await tx.classSubject.createMany({ data: added.map((subjectId) => ({ schoolId: ctx.schoolId, classId, subjectId })) });
    if (removed.length || added.length) await audit(tx, ctx, "class.subjects_update", "SchoolClass", classId, undefined, { added, removed });
  });
}

export async function getClassSubjectIds(ctx: AuthContext, classId: string): Promise<string[]> {
  requirePermission(ctx, "academic.read");
  const rows = await db.classSubject.findMany({ where: { classId, schoolId: ctx.schoolId }, select: { subjectId: true } });
  return rows.map((r) => r.subjectId);
}

// ───────────────────────── Teacher assignments ─────────────────────────

const classTeacherSchema = z.object({ academicYearId: uuid(), classId: uuid(), streamId: optUuid(), staffId: uuid() });
const subjectTeacherSchema = classTeacherSchema.extend({ subjectId: uuid() });

async function assertAssignmentTargets(schoolId: string, d: { academicYearId: string; classId: string; streamId?: string; staffId: string }) {
  const [year, cls, stream, staff] = await Promise.all([
    db.academicYear.findFirst({ where: { id: d.academicYearId, schoolId } }),
    db.schoolClass.findFirst({ where: { id: d.classId, schoolId } }),
    d.streamId ? db.stream.findFirst({ where: { id: d.streamId, schoolId } }) : Promise.resolve(null),
    db.staff.findFirst({ where: { id: d.staffId, schoolId, user: { status: "ACTIVE" } } }),
  ]);
  if (!year) throw notFound("Academic year");
  if (!cls) throw notFound("Class");
  if (d.streamId && (!stream || stream.classId !== d.classId)) throw invalid("That stream does not belong to the selected class.", { streamId: "Invalid stream" });
  if (!staff) throw invalid("Select an active staff member.", { staffId: "Invalid staff member" });
}

export async function listAssignments(ctx: AuthContext, academicYearId: string) {
  requirePermission(ctx, "academic.read");
  const include = { class: true, stream: true, staff: { include: { user: { select: { fullName: true } } } } } as const;
  const [classTeachers, subjectTeachers] = await Promise.all([
    db.classTeacher.findMany({ where: { schoolId: ctx.schoolId, academicYearId }, include, orderBy: { class: { sortOrder: "asc" } } }),
    db.subjectTeacher.findMany({ where: { schoolId: ctx.schoolId, academicYearId }, include: { ...include, subject: true }, orderBy: { class: { sortOrder: "asc" } } }),
  ]);
  return { classTeachers, subjectTeachers };
}

export async function listAssignableStaff(ctx: AuthContext) {
  requirePermission(ctx, "academic.read");
  return db.staff.findMany({
    where: { schoolId: ctx.schoolId, user: { status: "ACTIVE" } },
    select: { id: true, user: { select: { fullName: true } } },
    orderBy: { user: { fullName: "asc" } },
  });
}

/** One class teacher per class/stream per year; assigning again replaces the previous teacher. */
export async function setClassTeacher(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "academic.assign");
  const d = parse(classTeacherSchema, input);
  await assertAssignmentTargets(ctx.schoolId, d);
  await db.$transaction(async (tx) => {
    const existing = await tx.classTeacher.findFirst({ where: { academicYearId: d.academicYearId, classId: d.classId, streamId: d.streamId ?? null } });
    if (existing) {
      if (existing.staffId === d.staffId) return;
      await tx.classTeacher.update({ where: { id: existing.id }, data: { staffId: d.staffId } });
      await audit(tx, ctx, "class_teacher.replace", "ClassTeacher", existing.id, undefined, { from: existing.staffId, to: d.staffId });
    } else {
      const row = await tx.classTeacher.create({ data: { ...d, schoolId: ctx.schoolId } });
      await audit(tx, ctx, "class_teacher.assign", "ClassTeacher", row.id, undefined, { staffId: d.staffId, classId: d.classId });
    }
  });
}

export async function removeClassTeacher(ctx: AuthContext, id: string) {
  requirePermission(ctx, "academic.assign");
  const row = await db.classTeacher.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!row) throw notFound("Assignment");
  await db.$transaction(async (tx) => {
    await tx.classTeacher.delete({ where: { id } });
    await audit(tx, ctx, "class_teacher.remove", "ClassTeacher", id, undefined, { staffId: row.staffId, classId: row.classId });
  });
}

export async function addSubjectTeacher(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "academic.assign");
  const d = parse(subjectTeacherSchema, input);
  await assertAssignmentTargets(ctx.schoolId, d);
  const taught = await db.classSubject.findUnique({ where: { classId_subjectId: { classId: d.classId, subjectId: d.subjectId } } });
  if (!taught) throw invalid("This subject is not taught in the selected class.", { subjectId: "Add the subject to the class first" });
  const dup = await db.subjectTeacher.findFirst({ where: { academicYearId: d.academicYearId, classId: d.classId, streamId: d.streamId ?? null, subjectId: d.subjectId, staffId: d.staffId } });
  if (dup) throw conflict("This teacher is already assigned to that subject and class.");
  await db.$transaction(async (tx) => {
    const row = await tx.subjectTeacher.create({ data: { ...d, schoolId: ctx.schoolId } });
    await audit(tx, ctx, "subject_teacher.assign", "SubjectTeacher", row.id, undefined, { staffId: d.staffId, classId: d.classId, subjectId: d.subjectId });
  });
}

export async function removeSubjectTeacher(ctx: AuthContext, id: string) {
  requirePermission(ctx, "academic.assign");
  const row = await db.subjectTeacher.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!row) throw notFound("Assignment");
  await db.$transaction(async (tx) => {
    await tx.subjectTeacher.delete({ where: { id } });
    await audit(tx, ctx, "subject_teacher.remove", "SubjectTeacher", id, undefined, { staffId: row.staffId, classId: row.classId, subjectId: row.subjectId });
  });
}

/**
 * Classes/streams a staff member teaches in an academic year (as class teacher or subject teacher).
 * `streamId: null` means the whole class. Used to scope what a teacher may see.
 */
export async function teachingScope(staffId: string, academicYearId: string): Promise<{ classId: string; streamId: string | null }[]> {
  const [ct, st] = await Promise.all([
    db.classTeacher.findMany({ where: { staffId, academicYearId }, select: { classId: true, streamId: true } }),
    db.subjectTeacher.findMany({ where: { staffId, academicYearId }, select: { classId: true, streamId: true } }),
  ]);
  const seen = new Set<string>();
  return [...ct, ...st].filter((r) => {
    const k = `${r.classId}:${r.streamId ?? ""}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}
