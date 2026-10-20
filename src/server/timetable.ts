import { z } from "zod";
import { db, type Db, type Tx } from "@/lib/db";
import { conflict, invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { actorOf, writeAudit } from "@/server/audit";
import { currentYearId } from "@/server/learning-access";
import { childOrThrow } from "@/server/portal";
import { optText, optUuid, parse, text, uuid } from "@/lib/validation";

export const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";

// ───────────────────────── Periods ─────────────────────────

const time = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, for example 08:00");
const periodSchema = z.object({ name: text(40), startTime: time, endTime: time, isBreak: z.preprocess((v) => v === "on" || v === true || v === "true", z.boolean()) }).refine((v) => v.endTime > v.startTime, { path: ["endTime"], message: "The end must be after the start" });

export async function listPeriods(ctx: AuthContext) {
  requirePermission(ctx, "timetable.read");
  return db.timetablePeriod.findMany({ where: { schoolId: ctx.schoolId }, orderBy: { sequence: "asc" } });
}

async function assertNoOverlap(client: Db | Tx, schoolId: string, d: { startTime: string; endTime: string }, exceptId?: string) {
  const others = await client.timetablePeriod.findMany({ where: { schoolId, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  const clash = others.find((o) => d.startTime < o.endTime && o.startTime < d.endTime);
  if (clash) throw invalid("Please correct the highlighted fields.", { startTime: `This overlaps ${clash.name} (${clash.startTime}-${clash.endTime})` });
}

export async function createPeriod(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "timetable.manage");
  const d = parse(periodSchema, input);
  await assertNoOverlap(db, ctx.schoolId, d);
  return db.$transaction(async (tx) => {
    const seq = ((await tx.timetablePeriod.aggregate({ where: { schoolId: ctx.schoolId }, _max: { sequence: true } }))._max.sequence ?? 0) + 1;
    const p = await tx.timetablePeriod.create({ data: { schoolId: ctx.schoolId, sequence: seq, ...d } });
    await writeAudit(tx, actorOf(ctx), { action: "timetable.period_create", entityType: "TimetablePeriod", entityId: p.id, summary: `${p.name} ${p.startTime}-${p.endTime}` });
    return p;
  });
}

export async function updatePeriod(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "timetable.manage");
  const d = parse(periodSchema, input);
  const p = await db.timetablePeriod.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!p) throw notFound("Period");
  if (d.isBreak && !p.isBreak && (await db.timetableEntry.count({ where: { periodId: id } }))) throw conflict("Lessons are already set in this period, so it cannot become a break.");
  await assertNoOverlap(db, ctx.schoolId, d, id);
  await db.$transaction(async (tx) => {
    await tx.timetablePeriod.update({ where: { id }, data: d });
    await writeAudit(tx, actorOf(ctx), { action: "timetable.period_update", entityType: "TimetablePeriod", entityId: id, summary: d.name });
  });
}

export async function deletePeriod(ctx: AuthContext, id: string) {
  requirePermission(ctx, "timetable.manage");
  const p = await db.timetablePeriod.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!p) throw notFound("Period");
  if (await db.timetableEntry.count({ where: { periodId: id } })) throw conflict("Lessons are set in this period. Clear them first.");
  await db.$transaction(async (tx) => {
    await tx.timetablePeriod.delete({ where: { id } });
    await writeAudit(tx, actorOf(ctx), { action: "timetable.period_delete", entityType: "TimetablePeriod", entityId: id, summary: p.name });
  });
}

// ───────────────────────── Lessons ─────────────────────────

const entrySchema = z.object({
  classId: uuid(), streamId: optUuid(), dayOfWeek: z.coerce.number().int().min(1).max(7), periodId: uuid(), subjectId: uuid(), teacherStaffId: optUuid(), room: optText(40),
});

/** Sets the lesson for a class (or stream) in one slot, replacing what was there. Refuses any clash of class, teacher or room. */
export async function setTimetableEntry(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "timetable.manage");
  const d = parse(entrySchema, input);
  const yearId = await currentYearId(db, ctx.schoolId);
  if (!yearId) throw invalid("There is no current academic year. Set one up first.");
  const [cls, period, subject] = await Promise.all([
    db.schoolClass.findFirst({ where: { id: d.classId, schoolId: ctx.schoolId }, include: { streams: { select: { id: true } }, subjects: { select: { subjectId: true } } } }),
    db.timetablePeriod.findFirst({ where: { id: d.periodId, schoolId: ctx.schoolId } }),
    db.subject.findFirst({ where: { id: d.subjectId, schoolId: ctx.schoolId }, select: { id: true, name: true } }),
  ]);
  if (!cls) throw notFound("Class");
  if (!period) throw invalid("Please correct the highlighted fields.", { periodId: "Choose a period" });
  if (period.isBreak) throw invalid("Please correct the highlighted fields.", { periodId: "A break cannot hold a lesson" });
  if (!subject || !cls.subjects.some((s) => s.subjectId === d.subjectId)) throw invalid("Please correct the highlighted fields.", { subjectId: "This subject is not taught in the class" });
  if (d.streamId && !cls.streams.some((s) => s.id === d.streamId)) throw invalid("Please correct the highlighted fields.", { streamId: "That stream does not belong to the class" });
  if (d.teacherStaffId && !(await db.staff.findFirst({ where: { id: d.teacherStaffId, schoolId: ctx.schoolId, user: { status: "ACTIVE" } }, select: { id: true } }))) throw invalid("Please correct the highlighted fields.", { teacherStaffId: "Choose an active staff member" });

  const slot = { academicYearId: yearId, dayOfWeek: d.dayOfWeek, periodId: d.periodId };
  const same = await db.timetableEntry.findFirst({ where: { ...slot, classId: d.classId, streamId: d.streamId ?? null } });
  // A whole-class lesson and a stream lesson cannot share a period; two different streams can.
  const overlapping = await db.timetableEntry.findFirst({ where: { ...slot, classId: d.classId, ...(same ? { id: { not: same.id } } : {}), ...(d.streamId ? { OR: [{ streamId: null }] } : {}) } });
  if (overlapping) throw invalid("Please correct the highlighted fields.", { periodId: d.streamId ? "The whole class already has a lesson in this period" : "A stream of this class already has a lesson in this period. Clear it first or set the lesson per stream." });
  if (d.teacherStaffId) {
    const t = await db.timetableEntry.findFirst({ where: { ...slot, teacherStaffId: d.teacherStaffId, ...(same ? { id: { not: same.id } } : {}) } });
    if (t) {
      const c = await db.schoolClass.findUnique({ where: { id: t.classId }, select: { name: true } });
      throw invalid("Please correct the highlighted fields.", { teacherStaffId: `This teacher already teaches ${c?.name ?? "another class"} in this period` });
    }
  }
  if (d.room) {
    const r = await db.timetableEntry.findFirst({ where: { ...slot, room: { equals: d.room, mode: "insensitive" }, ...(same ? { id: { not: same.id } } : {}) } });
    if (r) throw invalid("Please correct the highlighted fields.", { room: "This room is already used in this period" });
  }
  try {
    return await db.$transaction(async (tx) => {
      const data = { subjectId: d.subjectId, teacherStaffId: d.teacherStaffId ?? null, room: d.room ?? null };
      const row = same ? await tx.timetableEntry.update({ where: { id: same.id }, data }) : await tx.timetableEntry.create({ data: { schoolId: ctx.schoolId, ...slot, classId: d.classId, streamId: d.streamId ?? null, ...data, createdById: ctx.userId } });
      await writeAudit(tx, actorOf(ctx), { action: same ? "timetable.entry_update" : "timetable.entry_create", entityType: "TimetableEntry", entityId: row.id, summary: `${cls.name} ${subject.name}`, changes: { day: d.dayOfWeek, period: period.name, teacherStaffId: d.teacherStaffId ?? null, room: d.room ?? null } });
      return row;
    });
  } catch (e) {
    if (isUnique(e)) throw conflict("Someone changed this slot at the same moment. Reload the timetable and try again."); // the database indexes are the backstop for races
    throw e;
  }
}

export async function clearTimetableEntry(ctx: AuthContext, id: string) {
  requirePermission(ctx, "timetable.manage");
  const e = await db.timetableEntry.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!e) throw notFound("Lesson");
  await db.$transaction(async (tx) => {
    await tx.timetableEntry.delete({ where: { id } });
    await writeAudit(tx, actorOf(ctx), { action: "timetable.entry_clear", entityType: "TimetableEntry", entityId: id, changes: { classId: e.classId, day: e.dayOfWeek, periodId: e.periodId } });
  });
}

// ───────────────────────── Reading ─────────────────────────

export type Lesson = { id: string; classId: string; className: string; streamId: string | null; streamName: string | null; dayOfWeek: number; periodId: string; subjectId: string; subjectName: string; teacherStaffId: string | null; teacherName: string | null; room: string | null };

async function decorate(client: Db | Tx, schoolId: string, rows: { id: string; classId: string; streamId: string | null; dayOfWeek: number; periodId: string; subjectId: string; teacherStaffId: string | null; room: string | null }[]): Promise<Lesson[]> {
  const [classes, streams, subjects, staff] = await Promise.all([
    client.schoolClass.findMany({ where: { schoolId, id: { in: [...new Set(rows.map((r) => r.classId))] } }, select: { id: true, name: true } }),
    client.stream.findMany({ where: { schoolId, id: { in: rows.flatMap((r) => (r.streamId ? [r.streamId] : [])) } }, select: { id: true, name: true } }),
    client.subject.findMany({ where: { schoolId, id: { in: [...new Set(rows.map((r) => r.subjectId))] } }, select: { id: true, name: true } }),
    client.staff.findMany({ where: { schoolId, id: { in: rows.flatMap((r) => (r.teacherStaffId ? [r.teacherStaffId] : [])) } }, select: { id: true, user: { select: { fullName: true } } } }),
  ]);
  return rows.map((r) => ({
    ...r, className: classes.find((c) => c.id === r.classId)?.name ?? "", streamName: streams.find((s) => s.id === r.streamId)?.name ?? null,
    subjectName: subjects.find((s) => s.id === r.subjectId)?.name ?? "", teacherName: staff.find((s) => s.id === r.teacherStaffId)?.user.fullName ?? null,
  }));
}

export async function classTimetable(ctx: AuthContext, input: { classId: string; streamId?: string | null }) {
  requirePermission(ctx, "timetable.read");
  const yearId = await currentYearId(db, ctx.schoolId);
  if (!yearId) return { periods: await listPeriods(ctx), lessons: [] as Lesson[] };
  const rows = await db.timetableEntry.findMany({ where: { schoolId: ctx.schoolId, academicYearId: yearId, classId: input.classId, ...(input.streamId ? { OR: [{ streamId: null }, { streamId: input.streamId }] } : {}) } });
  return { periods: await listPeriods(ctx), lessons: await decorate(db, ctx.schoolId, rows) };
}

export async function teacherTimetable(ctx: AuthContext, staffId: string | null) {
  requirePermission(ctx, "timetable.read");
  const target = staffId ?? ctx.staffId;
  const yearId = await currentYearId(db, ctx.schoolId);
  if (!yearId || !target) return { periods: await listPeriods(ctx), lessons: [] as Lesson[] };
  const rows = await db.timetableEntry.findMany({ where: { schoolId: ctx.schoolId, academicYearId: yearId, teacherStaffId: target } });
  return { periods: await listPeriods(ctx), lessons: await decorate(db, ctx.schoolId, rows) };
}

/** For the family portal: the lessons of the student's own class and stream. The caller has already checked the family link. */
export async function studentTimetable(schoolId: string, studentId: string) {
  const yearId = await currentYearId(db, schoolId);
  const en = yearId ? await db.studentEnrollment.findFirst({ where: { schoolId, studentId, academicYearId: yearId, status: "ACTIVE" }, select: { classId: true, streamId: true } }) : null;
  const periods = await db.timetablePeriod.findMany({ where: { schoolId }, orderBy: { sequence: "asc" } });
  if (!yearId || !en) return { periods, lessons: [] as Lesson[] };
  const rows = await db.timetableEntry.findMany({ where: { schoolId, academicYearId: yearId, classId: en.classId, OR: [{ streamId: null }, { streamId: en.streamId }] } });
  return { periods, lessons: await decorate(db, schoolId, rows) };
}

export async function listTeachers(ctx: AuthContext) {
  requirePermission(ctx, "timetable.read");
  return db.staff.findMany({ where: { schoolId: ctx.schoolId, user: { status: "ACTIVE", type: "STAFF" } }, select: { id: true, user: { select: { fullName: true } } }, orderBy: { user: { fullName: "asc" } } });
}

/** Classes (with their streams and subjects) and teachers, for the timetable pickers. */
export async function timetableOptions(ctx: AuthContext) {
  requirePermission(ctx, "timetable.read");
  const [classes, teachers] = await Promise.all([
    db.schoolClass.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, streams: { select: { id: true, name: true }, orderBy: { name: "asc" } }, subjects: { select: { subject: { select: { id: true, name: true } } } } } }),
    listTeachers(ctx),
  ]);
  return {
    classes: classes.map((c) => ({ id: c.id, name: c.name, streams: c.streams, subjects: c.subjects.map((s) => s.subject).sort((a, b) => a.name.localeCompare(b.name)) })),
    teachers: teachers.map((t) => ({ id: t.id, name: t.user.fullName })),
  };
}

/** Portal: the timetable of a child (or of the student themself). The family link is checked first. */
export async function childTimetable(ctx: AuthContext, studentId: string) {
  await childOrThrow(ctx, studentId);
  return studentTimetable(ctx.schoolId, studentId);
}
