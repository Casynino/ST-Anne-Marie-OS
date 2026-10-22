import { db } from "@/lib/db";
import type { AttendanceStatus } from "@/generated/prisma/client";
import type { AuthContext } from "@/lib/auth/context";
import { formatDateOnly, parseDateOnly } from "@/lib/dates";
import { studentScope } from "@/server/students";
import { getAttendanceSettings, registerOverview } from "@/server/attendance";
import { attendanceRate, emptyCounts, rangeScope, scopeWhere } from "@/server/attendance-reports";

/*
 * The attendance desk: everything the Attendance page shows besides the registers themselves. It reads the same finalised records, scopes and
 * rate policy as the reports, so a number here is the number on the report. Nothing is estimated: a day without a finalised register
 * is a day without data, and a teacher's "registers finalised" is counted against the days on which any register was finalised in the
 * user's scope.
 */

const DAY = 86_400_000;
const DAYS = 14;

export type DeskTeacher = { staffId: string; name: string; classes: string[]; finalisedDays: number; ratePct: number | null };

export async function attendanceDesk(ctx: AuthContext, dateInput: string) {
  const date = parseDateOnly(dateInput);
  if (!date) throw new Error("bad date");
  const overview = await registerOverview(ctx, dateInput);
  const settings = await getAttendanceSettings(db, ctx.schoolId);
  const from = new Date(date.getTime() - (DAYS - 1) * DAY);
  const year = await db.academicYear.findFirst({ where: { schoolId: ctx.schoolId, startsOn: { lte: date }, endsOn: { gte: date } }, select: { id: true } });
  const scope = await rangeScope(ctx, date);
  const where = { schoolId: ctx.schoolId, date: { gte: from, lte: date }, register: { status: "FINALISED" as const }, ...scopeWhere(scope) };

  const [byDay, byClass, absent, registers, classes, classTeachers, studentsScope] = await Promise.all([
    db.studentAttendance.groupBy({ by: ["date", "status"], where, _count: { _all: true } }),
    db.studentAttendance.groupBy({ by: ["classId", "status"], where, _count: { _all: true } }),
    db.studentAttendance.groupBy({ by: ["studentId"], where: { ...where, status: "ABSENT" }, _count: { _all: true }, orderBy: { _count: { studentId: "desc" } }, take: 8 }),
    db.attendanceRegister.findMany({ where: { schoolId: ctx.schoolId, date: { gte: from, lte: date }, status: "FINALISED" }, select: { classId: true, streamId: true, date: true } }),
    db.schoolClass.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true, sortOrder: true, level: { select: { sortOrder: true } } } }),
    year ? db.classTeacher.findMany({ where: { schoolId: ctx.schoolId, academicYearId: year.id }, select: { classId: true, streamId: true, staffId: true, staff: { select: { user: { select: { fullName: true } } } } } }) : [],
    studentScope(ctx),
  ]);

  // Day by day: counts per status and the rate under the school's policy.
  const days = Array.from({ length: DAYS }, (_, i) => formatDateOnly(new Date(from.getTime() + i * DAY)));
  const daily = days.map((d) => {
    const counts = emptyCounts();
    for (const r of byDay) if (formatDateOnly(r.date) === d) counts[r.status as AttendanceStatus] += r._count._all;
    return { date: d, counts, rate: attendanceRate(counts, settings) };
  });

  // Class by class over the same fortnight.
  const nameOf = new Map(classes.map((c) => [c.id, c]));
  const classRates = [...new Set(byClass.map((r) => r.classId))].map((id) => {
    const counts = emptyCounts();
    for (const r of byClass) if (r.classId === id) counts[r.status as AttendanceStatus] += r._count._all;
    return { classId: id, name: nameOf.get(id)?.name ?? "—", order: (nameOf.get(id)?.level.sortOrder ?? 0) * 1000 + (nameOf.get(id)?.sortOrder ?? 0), ratePct: attendanceRate(counts, settings), recorded: counts.PRESENT + counts.ABSENT + counts.LATE + counts.EXCUSED };
  }).sort((a, b) => a.order - b.order);

  // Students absent most often in the fortnight (within the user's own student scope).
  const ids = absent.map((a) => a.studentId);
  const people = ids.length ? await db.student.findMany({ where: { AND: [studentsScope, { id: { in: ids }, status: "ENROLLED" }] }, select: { id: true, admissionNo: true, firstName: true, middleName: true, lastName: true, enrollments: { where: { academicYearId: year?.id ?? "00000000-0000-0000-0000-000000000000", status: "ACTIVE" }, select: { class: { select: { name: true } }, stream: { select: { name: true } } }, take: 1 } } }) : [];
  const topAbsent = absent.flatMap((a) => {
    const p = people.find((x) => x.id === a.studentId);
    if (!p) return [];
    const e = p.enrollments[0];
    return [{ studentId: p.id, name: [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" "), admissionNo: p.admissionNo, className: e ? `${e.class.name}${e.stream ? ` ${e.stream.name}` : ""}` : null, absences: a._count._all }];
  });

  // Teachers: on how many school days did their class's register get finalised? (school days = days with any finalised register in scope)
  const schoolDays = new Set(registers.map((r) => formatDateOnly(r.date))).size;
  const byTeacher = new Map<string, DeskTeacher>();
  if (scope === "ALL") {
    for (const ct of classTeachers) {
      const key = ct.staffId;
      const t = byTeacher.get(key) ?? { staffId: ct.staffId, name: ct.staff.user.fullName, classes: [], finalisedDays: 0, ratePct: null };
      const cls = nameOf.get(ct.classId)?.name ?? "—";
      t.classes.push(cls);
      const mine = registers.filter((r) => r.classId === ct.classId && (ct.streamId === null || r.streamId === ct.streamId));
      t.finalisedDays = Math.max(t.finalisedDays, new Set(mine.map((r) => formatDateOnly(r.date))).size);
      byTeacher.set(key, t);
    }
    for (const t of byTeacher.values()) {
      const rates = classRates.filter((c) => t.classes.includes(c.name) && c.ratePct !== null).map((c) => c.ratePct as number);
      t.ratePct = rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10 : null;
      t.classes = [...new Set(t.classes)];
    }
  }
  const teachers = [...byTeacher.values()].sort((a, b) => b.finalisedDays - a.finalisedDays || a.name.localeCompare(b.name));
  const teacherOf = (classId: string, streamId: string | null) => [...new Set(classTeachers.filter((c) => c.classId === classId && (c.streamId === null || c.streamId === streamId)).map((c) => c.staff.user.fullName))];

  return { overview, settings, daily, classRates, topAbsent, teachers, schoolDays, teacherOf, allScope: scope === "ALL", days: DAYS };
}
