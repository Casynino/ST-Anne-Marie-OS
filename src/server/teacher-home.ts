import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { listAssignments } from "@/server/assignments";
import { listBehaviour } from "@/server/behaviour";
import { listLessonPlans, listSchemes, myTeachingUnits } from "@/server/lesson-plans";
import { schoolTimezone, teachingStudentIds } from "@/server/learning-access";
import { teacherTimetable } from "@/server/timetable";

/*
 * What a teacher needs on the first screen: today's lessons, the work waiting for them (registers, mark sheets, homework to mark,
 * plans to finish) and the classes they teach. Everything is scoped to the signed-in teacher by the services it calls.
 */

const can = (ctx: AuthContext, p: string) => ctx.permissions.has(p as never);

/** 1 = Monday … 7 = Sunday in the school's time zone. */
function isoWeekday(tz: string, now = new Date()) {
  const w = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now);
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(w) + 1;
}

export async function teacherHome(ctx: AuthContext) {
  const tz = await schoolTimezone(ctx.schoolId);
  const weekday = isoWeekday(tz);
  const [tt, units, homework, schemes, plans, behaviour, students] = await Promise.all([
    can(ctx, "timetable.read") ? teacherTimetable(ctx, null).catch(() => null) : null,
    can(ctx, "plans.write") || can(ctx, "assignments.manage") ? myTeachingUnits(ctx).catch(() => []) : [],
    can(ctx, "assignments.manage") ? listAssignments(ctx, { state: "OPEN" }).catch(() => []) : [],
    can(ctx, "plans.write") ? listSchemes(ctx, { box: "mine" }).catch(() => []) : [],
    can(ctx, "plans.write") ? listLessonPlans(ctx, { box: "mine" }).catch(() => []) : [],
    can(ctx, "behaviour.record") ? listBehaviour(ctx).catch(() => []) : [],
    teachingStudentIds(ctx),
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
  return {
    jobTitle: staff?.jobTitle ?? null,
    studentCount: students.length,
    today,
    classes: [...classes.entries()].map(([id, c]) => ({ id, className: c.className, streams: [...c.streams].sort(), subjects: [...c.subjects].sort() })),
    homework: { open: homework.length, toMark, rows: homework.slice(0, 6) },
    plans: { schemes: schemes.length, lessons: plans.length, needs: planNeeds, returned: [...schemes, ...plans].filter((p) => p.status === "RETURNED").length },
    behaviour: behaviour.slice(0, 5),
  };
}
