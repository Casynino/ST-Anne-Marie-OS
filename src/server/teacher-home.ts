import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { listAssignments } from "@/server/assignments";
import { listBehaviour } from "@/server/behaviour";
import { listLessonPlans, listSchemes, myTeachingUnits } from "@/server/lesson-plans";
import { isoWeekday, schoolTimezone, teachingStudentIds } from "@/server/learning-access";
import { teacherTimetable } from "@/server/timetable";
import { attendanceRate, emptyCounts } from "@/server/attendance-reports";
import { getAttendanceSettings } from "@/server/attendance";
import { getCurrentAcademicContext } from "@/server/academics";
import { listExams } from "@/server/admission-exams";
import { parseDateOnly, todayInTimezone } from "@/lib/dates";

/*
 * What a teacher needs on the first screen: today's lessons, the work waiting for them (registers, mark sheets, homework to mark,
 * plans to finish) and the classes they teach. Everything is scoped to the signed-in teacher by the services it calls.
 */

const can = (ctx: AuthContext, p: string) => ctx.permissions.has(p as never);

export async function teacherHome(ctx: AuthContext) {
  const tz = await schoolTimezone(ctx.schoolId);
  const weekday = isoWeekday(tz);
  const [tt, units, homework, schemes, plans, behaviour, students, applicantExams] = await Promise.all([
    can(ctx, "timetable.read") ? teacherTimetable(ctx, null).catch(() => null) : null,
    can(ctx, "plans.write") || can(ctx, "assignments.manage") ? myTeachingUnits(ctx).catch(() => []) : [],
    can(ctx, "assignments.manage") ? listAssignments(ctx, { state: "OPEN" }).catch(() => []) : [],
    can(ctx, "plans.write") ? listSchemes(ctx, { box: "mine" }).catch(() => []) : [],
    can(ctx, "plans.write") ? listLessonPlans(ctx, { box: "mine" }).catch(() => []) : [],
    can(ctx, "behaviour.record") ? listBehaviour(ctx).catch(() => []) : [],
    teachingStudentIds(ctx),
    // The applicants' examinations assigned to this teacher that are still to be marked or corrected.
    can(ctx, "admission.exam.mark") ? listExams(ctx, { view: "open" }).then((r) => r.rows.filter((x) => x.mine)).catch(() => []) : [],
  ]);
  const periods = tt?.periods ?? [];
  const today = (tt?.lessons ?? [])
    .filter((l) => l.dayOfWeek === weekday)
    .map((l) => ({ ...l, period: periods.find((p) => p.id === l.periodId) }))
    .sort((a, b) => (a.period?.sequence ?? 0) - (b.period?.sequence ?? 0));

  // class + stream cards: merge the teacher's units by class/stream, listing subjects
  const classes = new Map<string, { className: string; streams: Set<string>; subjects: Set<string> }>();
  for (const u of units) {
    const c = classes.get(u.classId) ?? classes.set(u.classId, { className: u.className, streams: new Set(), subjects: new Set() }).get(u.classId)!;
    u.streams.forEach((s) => c.streams.add(s.name));
    c.subjects.add(u.subjectName);
  }
  const toMark = homework.reduce((n, h) => n + Math.max(0, h.handedIn - h.marked), 0);
  const planNeeds = schemes.filter((s) => s.status === "DRAFT" || s.status === "RETURNED").length + plans.filter((p) => p.status === "DRAFT" || p.status === "RETURNED").length;
  const staff = ctx.staffId ? await db.staff.findFirst({ where: { id: ctx.staffId }, select: { jobTitle: true } }) : null;

  // "My students": everyone in the teacher's own classes (the same scope as the student list), with today's attendance and this term's rate.
  const ROSTER_MAX = 120;
  const { year, term } = await getCurrentAcademicContext(ctx.schoolId);
  const todayDate = parseDateOnly(todayInTimezone(tz)) as Date;
  const ids = students.slice(0, 400);
  const [rows, todayMarks, termMarks, attSettings] = ids.length && year ? await Promise.all([
    db.student.findMany({ where: { schoolId: ctx.schoolId, id: { in: ids }, status: "ENROLLED" }, select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true, enrollments: { where: { academicYearId: year.id, status: "ACTIVE" }, select: { class: { select: { name: true, sortOrder: true } }, stream: { select: { name: true } } }, take: 1 } } }),
    db.studentAttendance.findMany({ where: { schoolId: ctx.schoolId, studentId: { in: ids }, date: todayDate, register: { status: "FINALISED" } }, select: { studentId: true, status: true } }),
    db.studentAttendance.groupBy({ by: ["studentId", "status"], where: { schoolId: ctx.schoolId, studentId: { in: ids }, register: { status: "FINALISED" }, ...(term ? { date: { gte: term.startsOn } } : {}) }, _count: { _all: true } }),
    getAttendanceSettings(db, ctx.schoolId),
  ]) : [[], [], [], null] as const;
  const roster = rows
    .map((r) => {
      const counts = emptyCounts();
      for (const g of termMarks) if (g.studentId === r.id) counts[g.status] += g._count._all;
      const e = r.enrollments[0];
      return { id: r.id, name: [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" "), admissionNo: r.admissionNo, className: e ? `${e.class.name}${e.stream ? ` ${e.stream.name}` : ""}` : null, classOrder: e?.class.sortOrder ?? 9999, today: todayMarks.find((m) => m.studentId === r.id)?.status ?? null, ratePct: attSettings ? attendanceRate(counts, attSettings) : null };
    })
    .sort((a, b) => a.classOrder - b.classOrder || (a.className ?? "").localeCompare(b.className ?? "") || a.name.localeCompare(b.name));
  return {
    jobTitle: staff?.jobTitle ?? null,
    studentCount: students.length,
    roster: roster.slice(0, ROSTER_MAX).map(({ classOrder: _o, ...r }) => r),
    rosterTotal: roster.length,
    today,
    week: [1, 2, 3, 4, 5].map((d) => ({ day: d, count: (tt?.lessons ?? []).filter((l) => l.dayOfWeek === d).length })),
    classes: [...classes.entries()].map(([id, c]) => ({ id, className: c.className, streams: [...c.streams].sort(), subjects: [...c.subjects].sort() })),
    homework: { open: homework.length, toMark, rows: homework.slice(0, 6) },
    plans: { schemes: schemes.length, lessons: plans.length, needs: planNeeds, returned: [...schemes, ...plans].filter((p) => p.status === "RETURNED").length },
    behaviour: behaviour.slice(0, 5),
    applicantExams: applicantExams.slice(0, 6),
  };
}
