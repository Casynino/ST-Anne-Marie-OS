import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { formatDateOnly, parseDateOnly, todayInTimezone } from "@/lib/dates";
import { studentCounts, studentScope } from "@/server/students";
import { getCurrentAcademicContext } from "@/server/academics";
import { attendanceRate, emptyCounts } from "@/server/attendance-reports";
import { getAttendanceSettings, registerOverview, countPendingConflicts } from "@/server/attendance";
import { countNewEnquiries } from "@/server/enquiries";
import { getBrandLogo } from "@/server/website";
import { arrearsReport, financeOverview } from "@/server/finance-reports";
import { listSubmissions } from "@/server/marks";
import { countStaffAttention } from "@/server/messaging";
import { backupHealth } from "@/server/backups";
import { countUnmatchedEvents } from "@/server/payment-events";
import { centsOf } from "@/lib/finance/money";

/*
 * Dashboard data. Every number comes from the same services and rules the detail screens use (attendance rate
 * policy, student visibility scope, admissions statuses), limited to what the signed-in user may see.
 * Nothing is estimated or invented: when there is nothing to compare or show, the value is null and the page
 * says so honestly.
 */

export type Kpi = { key: string; value: number | string | null; hint?: string; href: string };
export type Bar = { label: string; value: number; tone?: "brand" | "sun" | "indigo" | "warn" | "bad" | "muted" };
export type TrendPoint = { date: string; rate: number };
export type Attention = { area: "attendance" | "admissions" | "finance" | "results" | "messages" | "system"; key: "conflicts" | "failedNotifications" | "newEnquiries" | "newApplications" | "registersOpen" | "unmatchedPayments" | "refundsPending" | "resultsToApprove" | "marksOverdue" | "messagesWaiting" | "backupStale"; count: number; href: string };
export type CollectionsPoint = { date: string; cents: number };
export type FinancePanel = {
  term: { id: string; name: string };
  billed: number; collected: number; outstanding: number; overdue: number; credit: number; expenses: number; ratePct: number | null;
  trend: CollectionsPoint[];
  topArrears: { studentId: string; name: string; admissionNo: string; className: string | null; overdue: number; outstanding: number }[];
};
export type ExamsPanel = {
  term: { id: string; name: string };
  total: number;
  byStatus: Record<"DRAFT" | "SUBMITTED" | "APPROVED" | "LOCKED" | "RETURNED", number>;
  overall: boolean; // true when the counts cover every unit (approvers); false when they are only the user's own
  toApprove: number; toLock: number; overdue: number;
  mine: { id: string; examName: string; className: string; streamName: string | null; subjectName: string; status: string; entered: number; roster: number; overdue: boolean }[];
};
export type MyRegister = { sessionId: string; classId: string; className: string; streamId: string | null; streamName: string | null; status: "NOT_STARTED" | "DRAFT" | "FINALISED"; students: number };

const APPLICATION_ORDER = ["APPLIED", "INTERVIEW", "ACCEPTED", "ENROLLED", "REJECTED", "WITHDRAWN"] as const;

async function todaysAttendance(ctx: AuthContext, today: string) {
  if (!["attendance.read", "attendance.read_assigned", "attendance.take", "attendance.take_any"].some((p) => ctx.permissions.has(p as never))) return null;
  try {
    const ov = await registerOverview(ctx, today);
    const counts = emptyCounts();
    let finalised = 0, total = 0;
    for (const row of ov.rows) for (const cell of row.cells) {
      total++;
      if (cell.status === "FINALISED") { finalised++; for (const k of Object.keys(counts) as (keyof typeof counts)[]) counts[k] += cell.counts[k]; }
    }
    return { rate: attendanceRate(counts, ov.settings), finalised, total, rows: ov.rows, settings: ov.settings };
  } catch {
    return null; // no academic year covers today
  }
}

/** Finalised-register attendance per day for the last `days` calendar days (school-wide readers only). */
async function attendanceTrend(ctx: AuthContext, today: Date, days: number): Promise<TrendPoint[] | null> {
  if (!ctx.permissions.has("attendance.read")) return null;
  const settings = await getAttendanceSettings(db, ctx.schoolId);
  const from = new Date(today.getTime() - (days - 1) * 86_400_000);
  const rows = await db.studentAttendance.groupBy({
    by: ["date", "status"],
    where: { schoolId: ctx.schoolId, date: { gte: from, lte: today }, register: { status: "FINALISED" } },
    _count: { _all: true },
  });
  const byDate = new Map<string, ReturnType<typeof emptyCounts>>();
  for (const r of rows) {
    const k = formatDateOnly(r.date);
    const c = byDate.get(k) ?? emptyCounts();
    c[r.status] += r._count._all;
    byDate.set(k, c);
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([date, c]) => {
    const rate = attendanceRate(c, settings);
    return rate === null ? [] : [{ date, rate }];
  });
}

/** Posted payments per day for the last `days` days (reversed payments never count). */
async function collectionsTrend(ctx: AuthContext, today: Date, days: number): Promise<CollectionsPoint[]> {
  const from = new Date(today.getTime() - (days - 1) * 86_400_000);
  const rows = await db.payment.groupBy({ by: ["receivedOn"], where: { schoolId: ctx.schoolId, status: "POSTED", receivedOn: { gte: from, lte: today } }, _sum: { amount: true } });
  const byDay = new Map(rows.map((r) => [formatDateOnly(r.receivedOn), centsOf(r._sum.amount)]));
  return Array.from({ length: days }, (_, i) => { const d = formatDateOnly(new Date(from.getTime() + i * 86_400_000)); return { date: d, cents: byDay.get(d) ?? 0 }; });
}

async function financePanel(ctx: AuthContext, today: Date): Promise<FinancePanel | null> {
  if (!ctx.permissions.has("finance.reports")) return null;
  const o = await financeOverview(ctx);
  if (!o) return null;
  const [trend, arrears] = await Promise.all([collectionsTrend(ctx, today, 30), arrearsReport(ctx, { termId: o.term.id })]);
  return {
    term: o.term, billed: o.billed, collected: o.collected, outstanding: o.outstanding, overdue: o.overdue, credit: o.credit, expenses: o.expenses, ratePct: o.collectionRatePct, trend,
    topArrears: arrears.rows.slice(0, 5).map((r) => ({ studentId: r.studentId, name: r.name, admissionNo: r.admissionNo, className: r.className, overdue: r.overdue, outstanding: r.outstanding })),
  };
}

async function examsPanel(ctx: AuthContext, term: { id: string; name: string } | null): Promise<ExamsPanel | null> {
  if (!term || !["marks.enter", "marks.enter_any", "results.read", "results.read_assigned", "results.approve"].some((p) => ctx.permissions.has(p as never))) return null;
  const units = await listSubmissions(ctx, { termId: term.id });
  const byStatus = { DRAFT: 0, SUBMITTED: 0, APPROVED: 0, LOCKED: 0, RETURNED: 0 };
  for (const u of units) byStatus[u.status as keyof typeof byStatus]++;
  const mine = (ctx.permissions.has("marks.enter") || ctx.permissions.has("marks.enter_any")) ? units.filter((u) => u.canEnter && (u.status === "DRAFT" || u.status === "RETURNED")).slice(0, 8) : [];
  const overall = ctx.permissions.has("results.read") || ctx.permissions.has("marks.enter_any");
  return {
    term, total: units.length, byStatus, overall,
    toApprove: ctx.permissions.has("results.approve") ? byStatus.SUBMITTED : 0, toLock: ctx.permissions.has("results.lock") ? byStatus.APPROVED : 0, overdue: units.filter((u) => u.overdue && u.canEnter).length,
    mine: mine.map((u) => ({ id: u.id, examName: u.examName, className: u.className, streamName: u.streamName, subjectName: u.subjectName, status: u.status, entered: u.entered, roster: u.roster, overdue: u.overdue })),
  };
}

export async function getDashboard(ctx: AuthContext) {
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { timezone: true } });
  const todayStr = todayInTimezone(school.timezone);
  const today = parseDateOnly(todayStr) as Date;
  const { year, term } = await getCurrentAcademicContext(ctx.schoolId);
  const can = (p: string) => ctx.permissions.has(p as never);
  const canStudents = can("student.read") || can("student.read_assigned");

  const [students, attendance, trend, classCounts, pipeline, recentApplications, activity, staff, enquiries, conflicts, failed, byGender, finance, exams, unmatched, refundsPending, messagesWaiting, backups] = await Promise.all([
    canStudents ? studentCounts(ctx) : null,
    todaysAttendance(ctx, todayStr),
    attendanceTrend(ctx, today, 14),
    // Enrollment by class: ACTIVE enrolments of the current year, limited to the user's student scope.
    canStudents && year
      ? studentScope(ctx).then(async (scope) => {
          const rows = await db.studentEnrollment.groupBy({ by: ["classId"], where: { schoolId: ctx.schoolId, academicYearId: year.id, status: "ACTIVE", student: scope }, _count: { _all: true } });
          const classes = await db.schoolClass.findMany({ where: { schoolId: ctx.schoolId, id: { in: rows.map((r) => r.classId) } }, select: { id: true, name: true, sortOrder: true, level: { select: { sortOrder: true } } } });
          return rows
            .map((r) => ({ c: classes.find((x) => x.id === r.classId), n: r._count._all }))
            .filter((x): x is { c: NonNullable<typeof x.c>; n: number } => !!x.c)
            .sort((a, b) => a.c.level.sortOrder - b.c.level.sortOrder || a.c.sortOrder - b.c.sortOrder || a.c.name.localeCompare(b.c.name))
            .map((x) => ({ label: x.c.name, value: x.n }));
        })
      : null,
    can("admission.read") ? db.application.groupBy({ by: ["status"], where: { schoolId: ctx.schoolId }, _count: { _all: true } }) : null,
    can("admission.read")
      ? db.application.findMany({ where: { schoolId: ctx.schoolId }, orderBy: { createdAt: "desc" }, take: 6, select: { id: true, applicationNo: true, firstName: true, lastName: true, status: true, source: true, createdAt: true, classAppliedId: true } })
      : null,
    can("audit.read") ? db.auditLog.findMany({ where: { schoolId: ctx.schoolId }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, action: true, actorName: true, summary: true, entityType: true, entityId: true, createdAt: true } }) : null,
    can("user.read") ? db.user.count({ where: { schoolId: ctx.schoolId, type: "STAFF", status: "ACTIVE" } }) : null,
    countNewEnquiries(ctx),
    can("attendance.correct") ? countPendingConflicts(ctx) : null,
    can("attendance.read") || can("user.read") ? db.notificationEvent.count({ where: { schoolId: ctx.schoolId, status: "FAILED" } }) : null,
    canStudents ? studentScope(ctx).then((scope) => db.student.groupBy({ by: ["gender"], where: { AND: [scope, { status: "ENROLLED" }] }, _count: { _all: true } })) : null,
    financePanel(ctx, today),
    examsPanel(ctx, term),
    can("finance.reconcile") ? countUnmatchedEvents(ctx) : null,
    can("refund.approve") ? db.refund.count({ where: { schoolId: ctx.schoolId, status: "REQUESTED", requestedById: { not: ctx.userId } } }) : null,
    countStaffAttention(ctx),
    can("backup.read") ? backupHealth() : null,
  ]);

  const counts = Object.fromEntries((pipeline ?? []).map((p) => [p.status, p._count._all])) as Record<string, number>;
  const inPipeline = (counts.APPLIED ?? 0) + (counts.INTERVIEW ?? 0) + (counts.ACCEPTED ?? 0);

  const kpis: Kpi[] = [];
  if (students) kpis.push({ key: "enrolled", value: students.enrolled, href: "/students" });
  if (pipeline) kpis.push({ key: "pipeline", value: inPipeline, hint: `${counts.APPLIED ?? 0}`, href: "/admissions" });
  if (attendance) {
    kpis.push({ key: "attendanceToday", value: attendance.rate === null ? null : `${attendance.rate}%`, hint: `${attendance.finalised}/${attendance.total}`, href: "/attendance" });
  }
  if (finance) {
    kpis.push({ key: "collected", value: finance.collected, hint: finance.ratePct === null ? undefined : `${finance.ratePct}`, href: "/finance" });
    kpis.push({ key: "outstanding", value: finance.outstanding, hint: `${finance.overdue}`, href: "/finance/reports" });
  }
  if (exams && exams.overall) kpis.push({ key: "resultsLocked", value: exams.total === 0 ? null : `${Math.round((exams.byStatus.LOCKED / exams.total) * 100)}%`, hint: `${exams.byStatus.LOCKED}/${exams.total}`, href: "/marks?view=all" });
  if (staff !== null) kpis.push({ key: "staff", value: staff, href: "/users" });
  if (enquiries !== null) kpis.push({ key: "enquiries", value: enquiries, href: "/enquiries" });

  const attention: Attention[] = [];
  if (conflicts) attention.push({ area: "attendance", key: "conflicts", count: conflicts, href: "/attendance/conflicts" });
  if (failed) attention.push({ area: "attendance", key: "failedNotifications", count: failed, href: "/attendance/alerts" });
  if (enquiries) attention.push({ area: "admissions", key: "newEnquiries", count: enquiries, href: "/enquiries" });
  if (counts.APPLIED) attention.push({ area: "admissions", key: "newApplications", count: counts.APPLIED, href: "/admissions?status=APPLIED" });
  if (unmatched) attention.push({ area: "finance", key: "unmatchedPayments", count: unmatched, href: "/finance/reconciliation" });
  if (refundsPending) attention.push({ area: "finance", key: "refundsPending", count: refundsPending, href: "/finance/refunds" });
  if (exams?.toApprove) attention.push({ area: "results", key: "resultsToApprove", count: exams.toApprove, href: "/marks?view=queue" });
  if (exams?.overdue) attention.push({ area: "results", key: "marksOverdue", count: exams.overdue, href: "/marks" });
  if (messagesWaiting) attention.push({ area: "messages", key: "messagesWaiting", count: messagesWaiting, href: "/communication/messages" });
  if (backups && backups.level !== "ok") attention.push({ area: "system", key: "backupStale", count: 1, href: "/settings/backups" });
  const open = attendance ? attendance.total - attendance.finalised : 0;
  if (attendance && open > 0 && attendance.total > 0) attention.push({ area: "attendance", key: "registersOpen", count: open, href: "/attendance" });

  const myRegisters: MyRegister[] = attendance && can("attendance.take") ? attendance.rows.filter((r) => r.canTake && r.cells[0]).map((r) => ({ sessionId: r.cells[0]!.sessionId, classId: r.classId, className: r.className, streamId: r.streamId, streamName: r.streamName, status: r.cells[0]?.status ?? "NOT_STARTED", students: r.studentCount })) : [];

  const classNames = recentApplications?.length ? await db.schoolClass.findMany({ where: { schoolId: ctx.schoolId, id: { in: recentApplications.flatMap((a) => (a.classAppliedId ? [a.classAppliedId] : [])) } }, select: { id: true, name: true } }) : [];

  return {
    today: todayStr,
    year, term, logo: await getBrandLogo(ctx.schoolId),
    kpis,
    attention,
    enrollmentByClass: classCounts as Bar[] | null,
    gender: byGender ? Object.fromEntries(byGender.map((g) => [g.gender, g._count._all])) as Record<string, number> : null,
    pipeline: pipeline ? (APPLICATION_ORDER.map((s): Bar => ({ label: s, value: counts[s] ?? 0, tone: s === "REJECTED" ? "bad" : s === "WITHDRAWN" ? "muted" : s === "ENROLLED" ? "brand" : s === "ACCEPTED" ? "sun" : "indigo" })) as Bar[]) : null,
    attendanceTrend: trend,
    attendanceByClass: attendance
      ? attendance.rows.filter((r) => r.cells[0]).map((r) => {
          const c = r.cells[0]!;
          return { className: r.className, streamName: r.streamName, students: r.studentCount, status: c.status, counts: c.counts, rate: c.status === "FINALISED" ? attendanceRate(c.counts, attendance.settings) : null };
        })
      : null,
    finance, exams,
    recentApplications: recentApplications?.map((a) => ({ ...a, className: classNames.find((c) => c.id === a.classAppliedId)?.name ?? null })) ?? null,
    activity: activity ?? null,
    myRegisters,
    needsSetup: !year && can("academic.manage"),
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;
