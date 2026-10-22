import { z } from "zod";
import { db, type Db, type Tx } from "@/lib/db";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { formatDateOnly, parseDateOnly, todayInTimezone } from "@/lib/dates";
import type { ReportSnapshot } from "@/lib/results/report-types";
import { actorOf, writeAudit } from "@/server/audit";
import { getCurrentAcademicContext } from "@/server/academics";
import { registerOverview } from "@/server/attendance";
import { attendanceRate } from "@/server/attendance-reports";
import { getAttendanceSettings } from "@/server/attendance";
import { headHome } from "@/server/head-home";
import { listSubmissions } from "@/server/marks";
import { awaitingPlacement } from "@/server/admission-queues";
import { taskCounts } from "@/server/workflow";
import { parse } from "@/lib/validation";

/*
 * The Academic Office desk: everything the office needs to run the academic side, worked out from the real records on each load.
 * Nothing is stored here except the school's own thresholds. A figure that cannot be computed (no year, no report cards yet) is left out,
 * never replaced by a made-up number.
 */

export type AcademicSettings = {
  /** Average (percent) under which a student is flagged for support. null = use the pass mark of the grading scale on the report card. */
  lowAverage: number | null;
  /** This many absences in the window below flag a student. */
  repeatedAbsences: number;
  repeatedAbsenceDays: number;
  /** A class this full (percent of its capacity) is shown as nearly full. */
  capacityWarnPct: number;
};
export const DEFAULT_ACADEMIC_SETTINGS: AcademicSettings = { lowAverage: null, repeatedAbsences: 3, repeatedAbsenceDays: 14, capacityWarnPct: 90 };

export async function getAcademicSettings(client: Db | Tx, schoolId: string): Promise<AcademicSettings> {
  const row = await client.schoolSetting.findUnique({ where: { schoolId_key: { schoolId, key: "academic" } } });
  const s = (row?.value ?? {}) as Partial<AcademicSettings>;
  const d = DEFAULT_ACADEMIC_SETTINGS;
  return {
    lowAverage: typeof s.lowAverage === "number" && s.lowAverage >= 0 && s.lowAverage <= 100 ? s.lowAverage : null,
    repeatedAbsences: Number.isInteger(s.repeatedAbsences) && (s.repeatedAbsences as number) >= 1 ? (s.repeatedAbsences as number) : d.repeatedAbsences,
    repeatedAbsenceDays: Number.isInteger(s.repeatedAbsenceDays) && (s.repeatedAbsenceDays as number) >= 1 ? (s.repeatedAbsenceDays as number) : d.repeatedAbsenceDays,
    capacityWarnPct: Number.isInteger(s.capacityWarnPct) && (s.capacityWarnPct as number) >= 1 ? (s.capacityWarnPct as number) : d.capacityWarnPct,
  };
}

const settingsSchema = z.object({
  lowAverage: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.number().min(0).max(100).nullable()),
  repeatedAbsences: z.coerce.number().int().min(1).max(60),
  repeatedAbsenceDays: z.coerce.number().int().min(1).max(120),
  capacityWarnPct: z.coerce.number().int().min(1).max(100),
});

export async function updateAcademicSettings(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "academic.manage");
  const d = parse(settingsSchema, input);
  const before = await getAcademicSettings(db, ctx.schoolId);
  await db.$transaction(async (tx) => {
    await tx.schoolSetting.upsert({ where: { schoolId_key: { schoolId: ctx.schoolId, key: "academic" } }, create: { schoolId: ctx.schoolId, key: "academic", value: d, updatedById: ctx.userId }, update: { value: d, updatedById: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "settings.academic_update", entityType: "SchoolSetting", entityId: "academic", changes: { before, after: d } });
  });
}

export type DeskAlert = { key: string; count: number; href: string };

export type AcademicDesk = {
  today: string;
  year: { id: string; name: string } | null;
  term: { id: string; name: string; startsOn: string; endsOn: string } | null;
  settings: AcademicSettings;
  students: { enrolled: number; byClass: { classId: string; name: string; count: number; capacity: number | null }[]; awaitingPlacement: number; transfersThisTerm: number; pendingTransfers: number; openConcerns: number; unassignedStaffNote: number };
  attendance: {
    rate: number | null; finalised: number; total: number; counts: { PRESENT: number; ABSENT: number; LATE: number; EXCUSED: number };
    byClass: { classId: string; className: string; streamName: string | null; students: number; status: "NOT_STARTED" | "DRAFT" | "FINALISED"; present: number; absent: number; late: number }[];
    missing: { classId: string; className: string; streamName: string | null; students: number; teachers: string[] }[];
    repeated: { studentId: string; name: string; admissionNo: string; absences: number; className: string | null }[];
    trend: { date: string; rate: number }[];
  } | null;
  performance: {
    reportCards: number; classAverages: { classId: string; className: string; average: number; students: number }[]; subjectAverages: { name: string; average: number; students: number }[];
    threshold: number | null; below: { studentId: string; name: string; className: string; average: number }[];
    units: { total: number; byStatus: Record<string, number>; overdue: number; toApprove: number; missingMarks: number; incompleteClasses: number };
    cards: { generated: number; published: number; readyToPrepare: number };
  } | null;
  teachers: { total: number; withOutstanding: { staffId: string; name: string; registerDraft: number; sheetsOpen: number; sheetsOverdue: number; planAwaiting: number }[] } | null;
  calendar: { exams: { id: string; name: string; on: string | null; deadline: string | null }[]; sittings: { id: string; examName: string; className: string; subject: string; on: string; startsAt: string | null; venue: string | null }[]; interviews: { id: string; applicationId: string; name: string; at: Date }[]; events: { id: string; title: string; on: string }[] };
  alerts: DeskAlert[];
  tasks: { open: number; overdue: number; mine: number } | null;
};

const dayMs = 86_400_000;

export async function academicDesk(ctx: AuthContext): Promise<AcademicDesk> {
  requirePermission(ctx, "academic.office");
  const schoolId = ctx.schoolId;
  const school = await db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timezone: true } });
  const todayStr = todayInTimezone(school.timezone);
  const today = parseDateOnly(todayStr) as Date;
  const [{ year, term }, settings] = await Promise.all([getCurrentAcademicContext(schoolId), getAcademicSettings(db, schoolId)]);
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);

  // ── Students and classes
  const [classes, enrolCounts, awaiting, pendingTransfers, appliedTransfers, openConcerns] = await Promise.all([
    db.schoolClass.findMany({ where: { schoolId, isActive: true }, orderBy: [{ level: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }], include: { streams: true, _count: { select: { subjects: true } } } }),
    year ? db.studentEnrollment.groupBy({ by: ["classId"], where: { schoolId, academicYearId: year.id, status: "ACTIVE" }, _count: { _all: true } }) : [],
    awaitingPlacement(ctx).catch(() => []),
    db.classTransfer.count({ where: { schoolId, status: { in: ["REQUESTED", "APPROVED"] } } }),
    term ? db.classTransfer.count({ where: { schoolId, status: "APPLIED", appliedAt: { gte: term.startsOn, lt: new Date(term.endsOn.getTime() + dayMs) } } }) : 0,
    db.academicConcern.count({ where: { schoolId, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
  ]);
  const byClass = classes.map((c) => ({ classId: c.id, name: c.name, count: enrolCounts.find((e) => e.classId === c.id)?._count._all ?? 0, capacity: c.capacity }));
  const enrolled = byClass.reduce((n, c) => n + c.count, 0);

  // ── Class set-up gaps: classes with students but no subjects, no class teacher, or subjects nobody teaches
  const [classTeachers, subjectTeachers, classSubjects] = await Promise.all([
    year ? db.classTeacher.findMany({ where: { schoolId, academicYearId: year.id }, select: { classId: true, streamId: true, staff: { select: { user: { select: { fullName: true } } } } } }) : [],
    year ? db.subjectTeacher.findMany({ where: { schoolId, academicYearId: year.id }, select: { classId: true, subjectId: true } }) : [],
    db.classSubject.findMany({ where: { schoolId }, select: { classId: true, subjectId: true } }),
  ]);
  let configGaps = 0;
  for (const c of byClass.filter((x) => x.count > 0)) {
    const subs = classSubjects.filter((s) => s.classId === c.classId);
    const hasTeacher = classTeachers.some((t) => t.classId === c.classId);
    const untaught = subs.filter((s) => !subjectTeachers.some((t) => t.classId === c.classId && t.subjectId === s.subjectId)).length;
    if (subs.length === 0 || !hasTeacher || untaught > 0) configGaps++;
  }

  // ── Attendance today
  let attendance: AcademicDesk["attendance"] = null;
  if (can("attendance.read") && year) {
    try {
      const ov = await registerOverview(ctx, todayStr);
      const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
      let finalised = 0, total = 0;
      const rows: NonNullable<AcademicDesk["attendance"]>["byClass"] = [];
      const missing: NonNullable<AcademicDesk["attendance"]>["missing"] = [];
      for (const r of ov.rows) {
        const st = r.cells.every((c) => c.status === "FINALISED") && r.cells.length > 0 ? "FINALISED" : r.cells.some((c) => c.status !== "NOT_STARTED") ? "DRAFT" : "NOT_STARTED";
        const sum = r.cells.reduce((a, c) => ({ present: a.present + c.counts.PRESENT, absent: a.absent + c.counts.ABSENT, late: a.late + c.counts.LATE }), { present: 0, absent: 0, late: 0 });
        for (const cell of r.cells) { total++; if (cell.status === "FINALISED") { finalised++; for (const k of Object.keys(counts) as (keyof typeof counts)[]) counts[k] += cell.counts[k]; } }
        rows.push({ classId: r.classId, className: r.className, streamName: r.streamName, students: r.studentCount, status: st, ...sum });
        if (r.studentCount > 0 && st !== "FINALISED") {
          const teachers = classTeachers.filter((t) => t.classId === r.classId && (t.streamId === null || t.streamId === r.streamId)).map((t) => t.staff.user.fullName);
          missing.push({ classId: r.classId, className: r.className, streamName: r.streamName, students: r.studentCount, teachers });
        }
      }
      const windowFrom = new Date(today.getTime() - (settings.repeatedAbsenceDays - 1) * dayMs);
      const absentGroups = await db.studentAttendance.groupBy({ by: ["studentId"], where: { schoolId, status: "ABSENT", date: { gte: windowFrom, lte: today }, register: { status: "FINALISED" } }, _count: { _all: true }, having: { studentId: { _count: { gte: settings.repeatedAbsences } } }, orderBy: { _count: { studentId: "desc" } }, take: 10 });
      const studs = await db.student.findMany({ where: { schoolId, id: { in: absentGroups.map((g) => g.studentId) }, status: "ENROLLED" }, select: { id: true, admissionNo: true, firstName: true, lastName: true, enrollments: { where: { status: "ACTIVE", ...(year ? { academicYearId: year.id } : {}) }, take: 1, select: { class: { select: { name: true } } } } } });
      const repeated = absentGroups.flatMap((g) => { const s = studs.find((x) => x.id === g.studentId); return s ? [{ studentId: s.id, name: `${s.firstName} ${s.lastName}`, admissionNo: s.admissionNo, absences: g._count._all, className: s.enrollments[0]?.class.name ?? null }] : []; });
      const aset = await getAttendanceSettings(db, schoolId);
      const trendFrom = new Date(today.getTime() - 13 * dayMs);
      const tr = await db.studentAttendance.groupBy({ by: ["date", "status"], where: { schoolId, date: { gte: trendFrom, lte: today }, register: { status: "FINALISED" } }, _count: { _all: true } });
      const byDate = new Map<string, { PRESENT: number; ABSENT: number; LATE: number; EXCUSED: number }>();
      for (const x of tr) { const k = formatDateOnly(x.date); const c = byDate.get(k) ?? { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 }; c[x.status] += x._count._all; byDate.set(k, c); }
      const trend = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([date, c]) => { const rate = attendanceRate(c, aset); return rate === null ? [] : [{ date, rate }]; });
      attendance = { rate: attendanceRate(counts, ov.settings), finalised, total, counts, byClass: rows, missing, repeated, trend };
    } catch {
      attendance = null; // no academic year covers today
    }
  }

  // ── Results and report cards (current term)
  let performance: AcademicDesk["performance"] = null;
  if (term && (can("results.read") || can("results.approve"))) {
    const [units, cards] = await Promise.all([
      listSubmissions(ctx, { termId: term.id }).catch(() => []),
      db.reportCard.findMany({ where: { schoolId, termId: term.id, status: { not: "WITHDRAWN" } }, select: { id: true, studentId: true, classId: true, status: true, snapshot: true } }),
    ]);
    const byStatus: Record<string, number> = {};
    for (const u of units) byStatus[u.status] = (byStatus[u.status] ?? 0) + 1;
    const open = units.filter((u) => u.status === "DRAFT" || u.status === "RETURNED");
    const classOf = new Map(classes.map((c) => [c.id, c.name]));
    const perClass = new Map<string, number[]>();
    const perSubject = new Map<string, number[]>();
    let threshold: number | null = settings.lowAverage;
    const below: NonNullable<AcademicDesk["performance"]>["below"] = [];
    for (const c of cards) {
      const snap = c.snapshot as unknown as ReportSnapshot;
      const avg = snap.summary?.average;
      if (typeof avg !== "number") continue;
      perClass.set(c.classId, [...(perClass.get(c.classId) ?? []), avg]);
      for (const s of snap.subjects ?? []) if (typeof s.percent === "number") perSubject.set(s.name, [...(perSubject.get(s.name) ?? []), s.percent]);
      const limit = settings.lowAverage ?? snap.scale?.passMark ?? null;
      if (threshold === null && limit !== null) threshold = limit;
      if (limit !== null && avg < limit) below.push({ studentId: c.studentId, name: snap.student.name, className: classOf.get(c.classId) ?? snap.class.name, average: Math.round(avg * 10) / 10 });
    }
    const mean = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
    const lockedClasses = new Set<string>();
    const classUnits = new Map<string, string[]>();
    for (const u of units) classUnits.set(u.classId, [...(classUnits.get(u.classId) ?? []), u.status]);
    for (const [classId, sts] of classUnits) if (sts.every((s) => s === "LOCKED")) lockedClasses.add(classId);
    const classesWithCards = new Set(cards.map((c) => c.classId));
    performance = {
      reportCards: cards.length,
      classAverages: [...perClass.entries()].map(([classId, xs]) => ({ classId, className: classOf.get(classId) ?? "", average: mean(xs), students: xs.length })).sort((a, b) => b.average - a.average),
      subjectAverages: [...perSubject.entries()].map(([name, xs]) => ({ name, average: mean(xs), students: xs.length })).sort((a, b) => b.average - a.average),
      threshold, below: below.sort((a, b) => a.average - b.average).slice(0, 10),
      units: { total: units.length, byStatus, overdue: units.filter((u) => u.overdue).length, toApprove: byStatus.SUBMITTED ?? 0, missingMarks: open.reduce((n, u) => n + Math.max(0, u.roster - u.entered), 0), incompleteClasses: new Set(units.filter((u) => u.status !== "LOCKED" && u.status !== "APPROVED").map((u) => u.classId)).size },
      cards: { generated: cards.filter((c) => c.status === "GENERATED").length, published: cards.filter((c) => c.status === "PUBLISHED").length, readyToPrepare: [...lockedClasses].filter((c) => !classesWithCards.has(c)).length },
    };
  }

  // ── Teachers (the same view the Head Teacher has)
  let teachers: AcademicDesk["teachers"] = null;
  try {
    const h = await headHome(ctx);
    teachers = { total: h.totals.teachers, withOutstanding: h.teachers.filter((x) => (x.register?.draft ?? 0) + (x.register ? x.register.total - x.register.finalised : 0) > 0 || x.sheets.open > 0 || x.sheets.overdue > 0 || x.plans.awaiting > 0).slice(0, 8).map((x) => ({ staffId: x.staffId, name: x.name, registerDraft: x.register ? x.register.total - x.register.finalised : 0, sheetsOpen: x.sheets.open, sheetsOverdue: x.sheets.overdue, planAwaiting: x.plans.awaiting })) };
  } catch { teachers = null; }

  // ── Calendar: examinations, sittings, interviews, events (next three weeks)
  const horizon = new Date(today.getTime() + 21 * dayMs);
  const [exams, sittings, interviews, events] = await Promise.all([
    db.exam.findMany({ where: { schoolId, OR: [{ examDate: { gte: today, lte: horizon } }, { submissionDeadline: { gte: today, lte: horizon } }] }, orderBy: { examDate: "asc" }, take: 8, select: { id: true, name: true, examDate: true, submissionDeadline: true } }),
    db.examSubject.findMany({ where: { schoolId, sittingOn: { gte: today, lte: horizon } }, orderBy: [{ sittingOn: "asc" }, { startsAt: "asc" }], take: 12, include: { exam: { select: { name: true } } } }),
    can("admission.read") ? db.interview.findMany({ where: { schoolId, status: "SCHEDULED", scheduledAt: { gte: new Date(), lte: horizon } }, orderBy: { scheduledAt: "asc" }, take: 6, include: { application: { select: { id: true, firstName: true, lastName: true } } } }) : [],
    db.schoolEvent.findMany({ where: { schoolId, startsOn: { gte: today, lte: horizon } }, orderBy: { startsOn: "asc" }, take: 6, select: { id: true, title: true, startsOn: true } }),
  ]);
  const subjectNames = new Map((await db.subject.findMany({ where: { schoolId, id: { in: sittings.map((s) => s.subjectId) } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
  const calendar: AcademicDesk["calendar"] = {
    exams: exams.map((e) => ({ id: e.id, name: e.name, on: e.examDate ? formatDateOnly(e.examDate) : null, deadline: e.submissionDeadline ? formatDateOnly(e.submissionDeadline) : null })),
    sittings: sittings.map((s) => ({ id: s.id, examName: s.exam.name, className: classes.find((c) => c.id === s.classId)?.name ?? "", subject: subjectNames.get(s.subjectId) ?? "", on: formatDateOnly(s.sittingOn as Date), startsAt: s.startsAt, venue: s.venue })),
    interviews: interviews.map((i) => ({ id: i.id, applicationId: i.application.id, name: `${i.application.firstName} ${i.application.lastName}`, at: i.scheduledAt })),
    events: events.map((e) => ({ id: e.id, title: e.title, on: formatDateOnly(e.startsOn) })),
  };

  // ── Alerts: each is a count of real records with a link to them
  const alerts: DeskAlert[] = [];
  const push = (key: string, count: number, href: string) => { if (count > 0) alerts.push({ key, count, href }); };
  push("awaitingPlacement", awaiting.length, "/admissions/placement");
  push("configGaps", configGaps, "/academic-setup");
  push("attendanceMissing", attendance?.missing.length ?? 0, "/attendance");
  push("marksOverdue", performance?.units.overdue ?? 0, "/marks");
  push("resultsToApprove", performance?.units.toApprove ?? 0, "/marks?view=queue");
  push("cardsToPrepare", performance?.cards.readyToPrepare ?? 0, "/report-cards");
  push("cardsToPublish", performance?.cards.generated ?? 0, "/report-cards");
  push("repeatedAbsences", attendance?.repeated.length ?? 0, "/academic-office#absences");
  push("capacityWarnings", byClass.filter((c) => c.capacity !== null && c.count * 100 >= c.capacity * settings.capacityWarnPct).length, "/academic-setup");
  push("pendingTransfers", pendingTransfers, "/academic-office/transfers");
  push("openConcerns", openConcerns, "/academic-office/concerns");
  // End of year: shown once the next year has been set up or the year is about to end, so it never nags in the middle of a year.
  if (can("progression.read") && year) {
    const next = await db.academicYear.findFirst({ where: { schoolId, startsOn: { gt: year.endsOn } }, select: { id: true } });
    if (next || (year.endsOn.getTime() - today.getTime()) / dayMs <= 60) {
      push("progressionTodo", await db.studentEnrollment.count({ where: { schoolId, academicYearId: year.id, status: "ACTIVE", student: { status: "ENROLLED", progressions: { none: { fromAcademicYearId: year.id, status: { not: "SUPERSEDED" } } } } } }), "/academic-office/progression?show=none");
    }
    if (can("progression.head_approve")) push("headProgression", await db.studentProgression.count({ where: { schoolId, fromAcademicYearId: year.id, status: "AWAITING_HEAD" } }), "/academic-office/progression?show=awaiting_head");
  }

  const tc = can("tasks.academic") || can("tasks.admin") ? (await taskCounts(ctx)).find((c) => c.department === "ACADEMIC") : undefined;
  return {
    today: todayStr, year: year ? { id: year.id, name: year.name } : null, term: term ? { id: term.id, name: term.name, startsOn: formatDateOnly(term.startsOn), endsOn: formatDateOnly(term.endsOn) } : null, settings,
    students: { enrolled, byClass, awaitingPlacement: awaiting.length, transfersThisTerm: appliedTransfers, pendingTransfers, openConcerns, unassignedStaffNote: configGaps },
    attendance, performance, teachers, calendar, alerts, tasks: tc ? { open: tc.open, overdue: tc.overdue, mine: tc.mine } : null,
  };
}
