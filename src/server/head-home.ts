import { db } from "@/lib/db";
import { requireAnyPermission, type AuthContext } from "@/lib/auth/context";
import { parseDateOnly, todayInTimezone } from "@/lib/dates";
import { getCurrentAcademicContext } from "@/server/academics";

/*
 * The head teacher's view of the teaching staff: for every teacher with a class or subject this year, what is done and what is waiting
 * (today's register of their class, mark sheets, homework to mark, lesson plans), so the head can see who needs a reminder or a review.
 * Read-only, limited to this school, and only for people who oversee teaching (assignments, plan review or results approval).
 */

export type TeacherRow = {
  staffId: string;
  name: string;
  jobTitle: string | null;
  lastLoginAt: Date | null;
  /** Classes (and streams) the teacher is class teacher of. */
  classes: string[];
  /** "Subject · Class" the teacher teaches. */
  subjects: string[];
  /** Today's registers of the teacher's own classes: null when they are not a class teacher. */
  register: { total: number; finalised: number; draft: number } | null;
  /** Mark sheets of the current term for the teacher's subjects. */
  sheets: { open: number; submitted: number; overdue: number; done: number };
  homework: { open: number; toMark: number };
  plans: { drafts: number; awaiting: number; returned: number };
};

export type HeadHome = {
  year: { id: string; name: string } | null;
  term: { id: string; name: string } | null;
  teachers: TeacherRow[];
  totals: { teachers: number; registersFinalised: number; registersTotal: number; sheetsAwaiting: number; sheetsOverdue: number; sheetsUnassigned: number; plansAwaiting: number; homeworkToMark: number; neverSignedIn: number };
};

const label = (cls: string, stream?: string | null) => (stream ? `${cls} ${stream}` : cls);

export async function headHome(ctx: AuthContext): Promise<HeadHome> {
  requireAnyPermission(ctx, ["assignments.oversee", "plans.review", "results.approve"]);
  const [school, { year, term }] = await Promise.all([
    db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { timezone: true } }),
    getCurrentAcademicContext(ctx.schoolId),
  ]);
  const empty: HeadHome = { year: null, term: null, teachers: [], totals: { teachers: 0, registersFinalised: 0, registersTotal: 0, sheetsAwaiting: 0, sheetsOverdue: 0, sheetsUnassigned: 0, plansAwaiting: 0, homeworkToMark: 0, neverSignedIn: 0 } };
  if (!year) return empty;
  const todayStr = todayInTimezone(school.timezone);
  const today = parseDateOnly(todayStr) as Date;
  const schoolId = ctx.schoolId;

  const [classRows, subjectRows] = await Promise.all([
    db.classTeacher.findMany({ where: { schoolId, academicYearId: year.id }, include: { class: { select: { name: true } }, stream: { select: { name: true } } } }),
    db.subjectTeacher.findMany({ where: { schoolId, academicYearId: year.id }, include: { class: { select: { name: true } }, stream: { select: { name: true } }, subject: { select: { name: true } } } }),
  ]);
  const staffIds = [...new Set([...classRows.map((r) => r.staffId), ...subjectRows.map((r) => r.staffId)])];
  const [staff, registers, exams, assignments, planGroups, schemeGroups] = await Promise.all([
    db.staff.findMany({ where: { schoolId, id: { in: staffIds }, user: { status: "ACTIVE" } }, include: { user: { select: { fullName: true, lastLoginAt: true } } } }),
    db.attendanceRegister.findMany({ where: { schoolId, date: today }, select: { classId: true, streamId: true, status: true } }),
    term ? db.exam.findMany({ where: { schoolId, termId: term.id }, select: { id: true, submissionDeadline: true } }) : [],
    db.assignment.findMany({ where: { schoolId, academicYearId: year.id, publishedAt: { not: null }, closedAt: null }, select: { id: true, teacherStaffId: true } }),
    db.lessonPlan.groupBy({ by: ["teacherStaffId", "status"], where: { schoolId, academicYearId: year.id }, _count: { _all: true } }),
    db.schemeOfWork.groupBy({ by: ["teacherStaffId", "status"], where: { schoolId, academicYearId: year.id }, _count: { _all: true } }),
  ]);

  const examById = new Map(exams.map((e) => [e.id, e]));
  const [subs, toMarkGroups] = await Promise.all([
    exams.length ? db.resultSubmission.findMany({ where: { schoolId, examSubject: { examId: { in: exams.map((e) => e.id) } } }, select: { status: true, streamId: true, examSubject: { select: { examId: true, classId: true, subjectId: true } } } }) : [],
    assignments.length ? db.assignmentSubmission.groupBy({ by: ["assignmentId"], where: { schoolId, assignmentId: { in: assignments.map((a) => a.id) }, state: "SUBMITTED" }, _count: { _all: true } }) : [],
  ]);
  const toMarkByAssignment = new Map(toMarkGroups.map((g) => [g.assignmentId, g._count._all]));

  // A mark sheet belongs to every subject teacher whose class, subject and stream (or whole class) match it.
  const teachersOf = (sub: (typeof subs)[number]) => subjectRows.filter((r) => r.classId === sub.examSubject.classId && r.subjectId === sub.examSubject.subjectId && (r.streamId === null || r.streamId === sub.streamId)).map((r) => r.staffId);
  const sheetsBy = new Map<string, { open: number; submitted: number; overdue: number; done: number }>();
  const bump = (id: string) => sheetsBy.get(id) ?? sheetsBy.set(id, { open: 0, submitted: 0, overdue: 0, done: 0 }).get(id)!;
  let unassigned = 0, awaiting = 0, overdueAll = 0;
  for (const s of subs) {
    const owners = teachersOf(s);
    const open = s.status === "DRAFT" || s.status === "RETURNED";
    const deadline = examById.get(s.examSubject.examId)?.submissionDeadline;
    const late = open && !!deadline && deadline < today;
    if (s.status === "SUBMITTED") awaiting++;
    if (late) overdueAll++;
    if (owners.length === 0) { unassigned++; continue; }
    for (const id of owners) {
      const row = bump(id);
      if (open) row.open++; else if (s.status === "SUBMITTED") row.submitted++; else row.done++;
      if (late) row.overdue++;
    }
  }

  const count = (rows: { teacherStaffId: string; status: string; _count: { _all: number } }[], id: string, status: string) => rows.find((r) => r.teacherStaffId === id && r.status === status)?._count._all ?? 0;
  let plansAwaiting = 0;
  for (const g of [...planGroups, ...schemeGroups]) if (g.status === "SUBMITTED") plansAwaiting += g._count._all;

  const teachers: TeacherRow[] = staff.map((st) => {
    const mineClasses = classRows.filter((r) => r.staffId === st.id);
    const regs = mineClasses.map((r) => {
      const today_ = registers.filter((g) => g.classId === r.classId && (r.streamId === null || g.streamId === r.streamId));
      return today_.length > 0 && today_.every((g) => g.status === "FINALISED") ? "FINALISED" : today_.length > 0 ? "DRAFT" : "NONE";
    });
    const myAssignments = assignments.filter((a) => a.teacherStaffId === st.id);
    return {
      staffId: st.id,
      name: st.user.fullName,
      jobTitle: st.jobTitle,
      lastLoginAt: st.user.lastLoginAt,
      classes: mineClasses.map((r) => label(r.class.name, r.stream?.name)),
      subjects: [...new Set(subjectRows.filter((r) => r.staffId === st.id).map((r) => `${r.subject.name} · ${label(r.class.name, r.stream?.name)}`))],
      register: mineClasses.length ? { total: regs.length, finalised: regs.filter((x) => x === "FINALISED").length, draft: regs.filter((x) => x === "DRAFT").length } : null,
      sheets: sheetsBy.get(st.id) ?? { open: 0, submitted: 0, overdue: 0, done: 0 },
      homework: { open: myAssignments.length, toMark: myAssignments.reduce((n, a) => n + (toMarkByAssignment.get(a.id) ?? 0), 0) },
      plans: { drafts: count(planGroups, st.id, "DRAFT") + count(schemeGroups, st.id, "DRAFT"), awaiting: count(planGroups, st.id, "SUBMITTED") + count(schemeGroups, st.id, "SUBMITTED"), returned: count(planGroups, st.id, "RETURNED") + count(schemeGroups, st.id, "RETURNED") },
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  return {
    year: { id: year.id, name: year.name },
    term: term ? { id: term.id, name: term.name } : null,
    teachers,
    totals: {
      teachers: teachers.length,
      registersFinalised: teachers.reduce((n, t) => n + (t.register?.finalised ?? 0), 0),
      registersTotal: teachers.reduce((n, t) => n + (t.register?.total ?? 0), 0),
      sheetsAwaiting: awaiting,
      sheetsOverdue: overdueAll,
      sheetsUnassigned: unassigned,
      plansAwaiting,
      homeworkToMark: teachers.reduce((n, t) => n + t.homework.toMark, 0),
      neverSignedIn: teachers.filter((t) => !t.lastLoginAt).length,
    },
  };
}

