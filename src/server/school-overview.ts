import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { formatDateOnly, parseDateOnly, todayInTimezone } from "@/lib/dates";
import { centsOf } from "@/lib/finance/money";
import { listAssignments } from "@/server/assignments";
import { calendarFor } from "@/server/calendar";
import { studentScope } from "@/server/students";
import { personName, schoolTimezone } from "@/server/learning-access";

/*
 * School data for the administrator's overview (read-only, each function gated by the permission of the matching screen and
 * returning null when the viewer may not see it). Numbers come from the same tables as the detail screens.
 */

const can = (ctx: AuthContext, ...p: string[]) => p.some((x) => ctx.permissions.has(x as never));
const DAY = 86_400_000;

async function todayDate(ctx: AuthContext) {
  const tz = await schoolTimezone(ctx.schoolId);
  return parseDateOnly(todayInTimezone(tz)) as Date;
}
const lastDays = (today: Date, n: number) => Array.from({ length: n }, (_, i) => formatDateOnly(new Date(today.getTime() - (n - 1 - i) * DAY)));

/** Enrolled students per class of the current year, split by gender. */
export async function studentsByClassGender(ctx: AuthContext) {
  if (!can(ctx, "student.read", "student.read_assigned")) return null;
  const year = await db.academicYear.findFirst({ where: { schoolId: ctx.schoolId, isCurrent: true }, select: { id: true } });
  if (!year) return null;
  const scope = await studentScope(ctx);
  const rows = await db.studentEnrollment.findMany({ where: { schoolId: ctx.schoolId, academicYearId: year.id, status: "ACTIVE", student: scope }, select: { classId: true, student: { select: { gender: true } } } });
  const classes = await db.schoolClass.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(rows.map((r) => r.classId))] } }, select: { id: true, name: true, sortOrder: true, level: { select: { sortOrder: true } } } });
  return classes
    .sort((a, b) => a.level.sortOrder - b.level.sortOrder || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((c) => {
      const mine = rows.filter((r) => r.classId === c.id);
      return { classId: c.id, name: c.name, female: mine.filter((r) => r.student.gender === "FEMALE").length, male: mine.filter((r) => r.student.gender === "MALE").length };
    });
}

/** Finalised attendance per day for the last 14 days, as present / late / excused / absent counts. */
export async function attendanceDaily(ctx: AuthContext, days = 14) {
  if (!can(ctx, "attendance.read")) return null;
  const today = await todayDate(ctx);
  const from = new Date(today.getTime() - (days - 1) * DAY);
  const rows = await db.studentAttendance.groupBy({ by: ["date", "status"], where: { schoolId: ctx.schoolId, date: { gte: from, lte: today }, register: { status: "FINALISED" } }, _count: { _all: true } });
  return lastDays(today, days).map((date) => ({ date, parts: Object.fromEntries(rows.filter((r) => formatDateOnly(r.date) === date).map((r) => [r.status, r._count._all])) as Record<string, number> }));
}

/** Students marked absent today in finalised registers. */
export async function absentToday(ctx: AuthContext, limit = 8) {
  if (!can(ctx, "attendance.read")) return null;
  const today = await todayDate(ctx);
  const where = { schoolId: ctx.schoolId, date: today, status: "ABSENT" as const, register: { status: "FINALISED" as const } };
  const [total, rows] = await Promise.all([db.studentAttendance.count({ where }), db.studentAttendance.findMany({ where, take: limit, orderBy: { markedAt: "desc" }, select: { studentId: true, classId: true, streamId: true, note: true } })]);
  const [students, classes, streams] = await Promise.all([
    db.student.findMany({ where: { schoolId: ctx.schoolId, id: { in: rows.map((r) => r.studentId) } }, select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true } }),
    db.schoolClass.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true } }),
    db.stream.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true } }),
  ]);
  return {
    total,
    rows: rows.map((r) => {
      const s = students.find((x) => x.id === r.studentId);
      return { studentId: r.studentId, name: s ? personName(s) : "—", admissionNo: s?.admissionNo ?? "", className: `${classes.find((c) => c.id === r.classId)?.name ?? ""}${r.streamId ? ` ${streams.find((x) => x.id === r.streamId)?.name ?? ""}` : ""}`.trim(), note: r.note };
    }),
  };
}

export async function recentPayments(ctx: AuthContext, limit = 8) {
  if (!can(ctx, "finance.reports")) return null;
  const rows = await db.payment.findMany({ where: { schoolId: ctx.schoolId, status: "POSTED" }, orderBy: [{ receivedOn: "desc" }, { createdAt: "desc" }], take: limit, include: { receipt: { select: { number: true } } } });
  const students = await db.student.findMany({ where: { schoolId: ctx.schoolId, id: { in: rows.map((r) => r.studentId) } }, select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true } });
  return rows.map((r) => {
    const s = students.find((x) => x.id === r.studentId);
    return { id: r.id, studentId: r.studentId, name: s ? personName(s) : "—", admissionNo: s?.admissionNo ?? "", cents: centsOf(r.amount), method: r.method, receivedOn: r.receivedOn, receipt: r.receipt?.number ?? null };
  });
}

/** Money received in the last 30 days by method (cents). */
export async function collectionByMethod(ctx: AuthContext, days = 30) {
  if (!can(ctx, "finance.reports")) return null;
  const today = await todayDate(ctx);
  const from = new Date(today.getTime() - (days - 1) * DAY);
  const rows = await db.payment.groupBy({ by: ["method"], where: { schoolId: ctx.schoolId, status: "POSTED", receivedOn: { gte: from, lte: today } }, _sum: { amount: true } });
  return rows.map((r) => ({ method: r.method, cents: centsOf(r._sum.amount) })).filter((r) => r.cents > 0).sort((a, b) => b.cents - a.cents);
}

/** Open homework across the school (what is due soon and how much has come in). Teachers see their own classes only. */
export async function homeworkOverview(ctx: AuthContext) {
  if (!can(ctx, "assignments.oversee", "assignments.manage")) return null;
  const rows = await listAssignments(ctx, { state: "OPEN" });
  const now = Date.now();
  const open = rows.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const expected = open.reduce((n, r) => n + r.roster, 0);
  const handed = open.reduce((n, r) => n + r.handedIn, 0);
  return { open: open.length, overdue: open.filter((r) => r.dueAt.getTime() < now).length, ratePct: expected > 0 ? Math.round((handed / expected) * 100) : null, rows: open.slice(0, 6) };
}

/** Behaviour records per day for the last 14 days (positive / concern / incident). */
export async function behaviourDaily(ctx: AuthContext, days = 14) {
  if (!can(ctx, "behaviour.read_all")) return null;
  const today = await todayDate(ctx);
  const from = new Date(today.getTime() - (days - 1) * DAY);
  const rows = await db.behaviourRecord.groupBy({ by: ["occurredOn", "type"], where: { schoolId: ctx.schoolId, voidedAt: null, occurredOn: { gte: from, lte: today } }, _count: { _all: true } });
  const out = lastDays(today, days).map((date) => ({ date, parts: Object.fromEntries(rows.filter((r) => formatDateOnly(r.occurredOn) === date).map((r) => [r.type, r._count._all])) as Record<string, number> }));
  return { days: out, total: rows.reduce((n, r) => n + r._count._all, 0) };
}

export async function upcomingEvents(ctx: AuthContext, limit = 6) {
  const today = await todayDate(ctx);
  const items = await calendarFor(ctx, today, new Date(today.getTime() + 90 * DAY));
  return items.slice(0, limit);
}

/** Active staff accounts per role. */
export async function staffByRole(ctx: AuthContext) {
  if (!can(ctx, "user.read")) return null;
  const users = await db.user.findMany({ where: { schoolId: ctx.schoolId, type: "STAFF", status: "ACTIVE" }, select: { roles: { select: { role: { select: { name: true } } } } } });
  const count = new Map<string, number>();
  for (const u of users) { const r = u.roles.map((x) => x.role.name).sort()[0] ?? "—"; count.set(r, (count.get(r) ?? 0) + 1); }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
}

/** Applications received per day for the last `days` days (school time zone). */
export async function applicationsDaily(ctx: AuthContext, days = 30) {
  if (!can(ctx, "admission.read")) return null;
  const tz = await schoolTimezone(ctx.schoolId);
  const today = parseDateOnly(todayInTimezone(tz)) as Date;
  const from = new Date(today.getTime() - (days - 1) * DAY - DAY);
  const rows = await db.$queryRaw<{ d: string; n: bigint }[]>`
    SELECT to_char(((a."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS d, count(*) AS n
    FROM applications a WHERE a."schoolId" = ${ctx.schoolId}::uuid AND a."createdAt" >= ${from} GROUP BY 1`;
  return lastDays(today, days).map((date) => ({ date, count: Number(rows.find((r) => r.d === date)?.n ?? 0) }));
}

/** How full each class is, for classes that have a capacity set (current year, active enrolments). */
export async function classFill(ctx: AuthContext) {
  if (!can(ctx, "student.read")) return null;
  const year = await db.academicYear.findFirst({ where: { schoolId: ctx.schoolId, isCurrent: true }, select: { id: true } });
  if (!year) return null;
  const [classes, counts] = await Promise.all([
    db.schoolClass.findMany({ where: { schoolId: ctx.schoolId, capacity: { not: null } }, select: { id: true, name: true, capacity: true, sortOrder: true, level: { select: { sortOrder: true } } } }),
    db.studentEnrollment.groupBy({ by: ["classId"], where: { schoolId: ctx.schoolId, academicYearId: year.id, status: "ACTIVE" }, _count: { _all: true } }),
  ]);
  if (classes.length === 0) return null;
  return classes
    .sort((a, b) => a.level.sortOrder - b.level.sortOrder || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((c) => ({ name: c.name, count: counts.find((x) => x.classId === c.id)?._count._all ?? 0, capacity: c.capacity as number }));
}

/** Fees billed and received per class for the current term. */
export { classCollectionReport } from "@/server/finance-reports";
