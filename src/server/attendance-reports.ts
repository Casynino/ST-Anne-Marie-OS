import { z } from "zod";
import type { AttendanceStatus, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { forbidden, invalid, notFound } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import { formatDateOnly, parseDateOnly, todayInTimezone } from "@/lib/dates";
import { dateOnly, optUuid, parse, uuid } from "@/lib/validation";
import { getAttendanceSettings, inScope, readScope, type AttendanceSettings, type ClassScope } from "@/server/attendance";

export type Counts = Record<AttendanceStatus, number>;
export const emptyCounts = (): Counts => ({ PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 });
export const totalOf = (c: Counts) => c.PRESENT + c.ABSENT + c.LATE + c.EXCUSED;

/**
 * Attendance rate (%) over RECORDED sessions only (finalised registers). Whether late / excused count as
 * attending is school policy (settings). Returns null when nothing was recorded — never 0% or 100%.
 */
export function attendanceRate(c: Counts, s: Pick<AttendanceSettings, "lateCountsAsPresent" | "excusedCountsAsPresent">): number | null {
  const total = totalOf(c);
  if (!total) return null;
  const present = c.PRESENT + (s.lateCountsAsPresent ? c.LATE : 0) + (s.excusedCountsAsPresent ? c.EXCUSED : 0);
  return Math.round((present / total) * 1000) / 10;
}

const isLow = (rate: number | null, s: AttendanceSettings) => rate !== null && rate < s.lowThresholdPct;

const rangeSchema = z
  .object({ from: dateOnly(), to: dateOnly() })
  .refine((v) => v.from <= v.to, { path: ["to"], message: "End date must not be before the start date" })
  .refine((v) => v.to.getTime() - v.from.getTime() <= 366 * 86_400_000, { path: ["to"], message: "Choose a range of at most one year" });

async function rangeScope(ctx: AuthContext, to: Date): Promise<ClassScope> {
  const year = await db.academicYear.findFirst({ where: { schoolId: ctx.schoolId, startsOn: { lte: to }, endsOn: { gte: to } }, select: { id: true } });
  // Outside any academic year there is nothing to scope; only school-wide readers get an (empty) report.
  return readScope(ctx, year?.id ?? "00000000-0000-0000-0000-000000000000");
}

function scopeWhere(scope: ClassScope): Prisma.StudentAttendanceWhereInput {
  if (scope === "ALL") return {};
  if (!scope.length) return { id: "00000000-0000-0000-0000-000000000000" };
  return { OR: scope.map((s) => (s.streamId ? { classId: s.classId, streamId: s.streamId } : { classId: s.classId })) };
}

const finalised: Prisma.StudentAttendanceWhereInput = { register: { status: "FINALISED" } };

// ───────────────────────── Class report ─────────────────────────

const classSchema = z.object({ classId: uuid(), streamId: optUuid() });

export async function classReport(ctx: AuthContext, input: unknown) {
  const { classId, streamId } = parse(classSchema, input);
  const { from, to } = parse(rangeSchema, input);
  const scope = await rangeScope(ctx, to);
  if (!inScope(scope, classId, streamId)) throw forbidden();
  const [settings, cls] = await Promise.all([getAttendanceSettings(db, ctx.schoolId), db.schoolClass.findFirst({ where: { id: classId, schoolId: ctx.schoolId }, select: { name: true } })]);
  if (!cls) throw notFound("Class");
  const where: Prisma.StudentAttendanceWhereInput = { schoolId: ctx.schoolId, classId, ...(streamId ? { streamId } : {}), date: { gte: from, lte: to }, ...finalised };
  const [grouped, registers] = await Promise.all([
    db.studentAttendance.groupBy({ by: ["studentId", "status"], where, _count: { _all: true } }),
    db.attendanceRegister.findMany({ where: { schoolId: ctx.schoolId, classId, ...(streamId ? { streamId } : {}), date: { gte: from, lte: to }, status: "FINALISED" }, select: { date: true } }),
  ]);
  const byStudent = new Map<string, Counts>();
  for (const g of grouped) {
    const c = byStudent.get(g.studentId) ?? emptyCounts();
    c[g.status] += g._count._all;
    byStudent.set(g.studentId, c);
  }
  const students = await db.student.findMany({
    where: { schoolId: ctx.schoolId, id: { in: [...byStudent.keys()] } },
    select: { id: true, admissionNo: true, firstName: true, middleName: true, lastName: true },
  });
  const rows = students
    .map((s) => {
      const counts = byStudent.get(s.id) ?? emptyCounts();
      const rate = attendanceRate(counts, settings);
      return { studentId: s.id, admissionNo: s.admissionNo, name: [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" "), counts, rate, low: isLow(rate, settings) };
    })
    .sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || a.name.localeCompare(b.name));
  const totals = emptyCounts();
  for (const r of rows) for (const k of Object.keys(totals) as AttendanceStatus[]) totals[k] += r.counts[k];
  return {
    className: cls.name,
    from: formatDateOnly(from),
    to: formatDateOnly(to),
    daysRecorded: new Set(registers.map((r) => formatDateOnly(r.date))).size,
    totals,
    rate: attendanceRate(totals, settings),
    lowCount: rows.filter((r) => r.low).length,
    thresholdPct: settings.lowThresholdPct,
    rows,
  };
}

// ───────────────────────── Student report ─────────────────────────

export async function studentReport(ctx: AuthContext, studentId: string, input: unknown) {
  const { from, to } = parse(rangeSchema, input);
  const scope = await rangeScope(ctx, to);
  const [settings, student] = await Promise.all([
    getAttendanceSettings(db, ctx.schoolId),
    db.student.findFirst({ where: { id: studentId, schoolId: ctx.schoolId }, select: { id: true, admissionNo: true, firstName: true, middleName: true, lastName: true } }),
  ]);
  if (!student) throw notFound("Student");
  const records = await db.studentAttendance.findMany({
    where: { schoolId: ctx.schoolId, studentId, date: { gte: from, lte: to }, ...finalised, ...scopeWhere(scope) },
    orderBy: [{ date: "desc" }, { session: { sortOrder: "asc" } }],
    include: { session: { select: { name: true } }, corrections: { orderBy: { createdAt: "desc" }, take: 1, select: { reason: true, createdAt: true } } },
  });
  if (scope !== "ALL" && !records.length) {
    // A teacher asking about a student outside their classes learns nothing.
    const anyInScope = await db.studentAttendance.count({ where: { schoolId: ctx.schoolId, studentId, ...scopeWhere(scope) } });
    if (!anyInScope) throw notFound("Student");
  }
  const counts = emptyCounts();
  for (const r of records) counts[r.status]++;
  const rate = attendanceRate(counts, settings);
  return {
    student: { id: student.id, admissionNo: student.admissionNo, name: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ") },
    from: formatDateOnly(from),
    to: formatDateOnly(to),
    counts,
    rate,
    low: isLow(rate, settings),
    thresholdPct: settings.lowThresholdPct,
    records: records.map((r) => ({ date: formatDateOnly(r.date), session: r.session.name, status: r.status, note: r.note, corrected: r.corrections[0] ? r.corrections[0].reason : null })),
  };
}

// ───────────────────────── Term & school reports ─────────────────────────

type ClassSummary = { classId: string; className: string; streamId: string | null; streamName: string | null; students: number; counts: Counts; rate: number | null; lowCount: number };

async function summariseClasses(ctx: AuthContext, from: Date, to: Date, scope: ClassScope, settings: AttendanceSettings): Promise<ClassSummary[]> {
  const grouped = await db.studentAttendance.groupBy({
    by: ["classId", "streamId", "studentId", "status"],
    where: { schoolId: ctx.schoolId, date: { gte: from, lte: to }, ...finalised, ...scopeWhere(scope) },
    _count: { _all: true },
  });
  const perStudent = new Map<string, { classId: string; streamId: string | null; counts: Counts }>();
  for (const g of grouped) {
    const key = `${g.classId}|${g.streamId ?? ""}|${g.studentId}`;
    const e = perStudent.get(key) ?? { classId: g.classId, streamId: g.streamId, counts: emptyCounts() };
    e.counts[g.status] += g._count._all;
    perStudent.set(key, e);
  }
  const perGroup = new Map<string, ClassSummary>();
  for (const e of perStudent.values()) {
    const key = `${e.classId}|${e.streamId ?? ""}`;
    const g = perGroup.get(key) ?? { classId: e.classId, className: "", streamId: e.streamId, streamName: null, students: 0, counts: emptyCounts(), rate: null, lowCount: 0 };
    g.students++;
    (Object.keys(g.counts) as AttendanceStatus[]).forEach((k) => (g.counts[k] += e.counts[k]));
    if (isLow(attendanceRate(e.counts, settings), settings)) g.lowCount++;
    perGroup.set(key, g);
  }
  const [classes, streams] = await Promise.all([
    db.schoolClass.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true, sortOrder: true, level: { select: { sortOrder: true } } } }),
    db.stream.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true } }),
  ]);
  const order = new Map(classes.map((c) => [c.id, c.level.sortOrder * 1000 + c.sortOrder]));
  return [...perGroup.values()]
    .map((g) => ({ ...g, className: classes.find((c) => c.id === g.classId)?.name ?? "", streamName: streams.find((s) => s.id === g.streamId)?.name ?? null, rate: attendanceRate(g.counts, settings) }))
    .sort((a, b) => (order.get(a.classId) ?? 0) - (order.get(b.classId) ?? 0) || (a.streamName ?? "").localeCompare(b.streamName ?? ""));
}

async function summaryReport(ctx: AuthContext, from: Date, to: Date) {
  const [scope, settings] = await Promise.all([rangeScope(ctx, to), getAttendanceSettings(db, ctx.schoolId)]);
  const classes = await summariseClasses(ctx, from, to, scope, settings);
  const totals = emptyCounts();
  for (const c of classes) (Object.keys(totals) as AttendanceStatus[]).forEach((k) => (totals[k] += c.counts[k]));
  return { from: formatDateOnly(from), to: formatDateOnly(to), classes, totals, rate: attendanceRate(totals, settings), lowCount: classes.reduce((n, c) => n + c.lowCount, 0), thresholdPct: settings.lowThresholdPct };
}

/** A term's attendance, capped at today so a term in progress is not diluted by future dates. */
export async function termReport(ctx: AuthContext, termId: string) {
  const term = await db.term.findFirst({ where: { id: termId, schoolId: ctx.schoolId }, include: { academicYear: { select: { name: true } } } });
  if (!term) throw notFound("Term");
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { timezone: true } });
  const today = parseDateOnly(todayInTimezone(school.timezone)) as Date;
  const to = term.endsOn < today ? term.endsOn : today;
  if (to < term.startsOn) throw invalid("This term has not started yet.");
  return { termName: `${term.academicYear.name} · ${term.name}`, ...(await summaryReport(ctx, term.startsOn, to)) };
}

export async function schoolReport(ctx: AuthContext, input: unknown) {
  const { from, to } = parse(rangeSchema, input);
  return summaryReport(ctx, from, to);
}
