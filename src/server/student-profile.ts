import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import type { ReportSnapshot } from "@/lib/results/report-types";
import { formatDateOnly, todayInTimezone } from "@/lib/dates";
import { loadStudentFinance } from "@/server/balances";
import { listBehaviour } from "@/server/behaviour";
import { studentReport } from "@/server/attendance-reports";
import { teaches, teachingRows } from "@/server/marks";
import { getSchoolBasics } from "@/server/settings";

/*
 * What a staff member sees about HOW a student is doing, gathered for the student's page. Each part is gated by the permission of the screen that
 * holds the same facts (report cards, attendance reports, fees, homework, behaviour) and returns null when the person may not see it, so the page
 * only draws what they are allowed. The student's own visibility (a teacher only sees students they teach) is checked by the page before this runs.
 * Marks come from the report cards (generated or published), exactly as printed; nothing is recomputed here.
 */

const DAY = 86_400_000;

export type TermResult = {
  id: string; term: string; status: string; average: number | null; grade: string | null; division: string | null; position: number | null; classSize: number;
  exams: { id: string; name: string }[];
  subjects: { id: string; name: string; percent: number; grade: string | null; classMean: number | null; position: number | null; classCount: number; change: number | null; exams: { examId: string; percent: number | null; status: string }[] }[];
};

export async function studentInsights(ctx: AuthContext, studentId: string) {
  const has = (p: string) => ctx.permissions.has(p as never);
  const school = await getSchoolBasics(ctx.schoolId);
  const today = todayInTimezone(school.timezone);
  const todayDate = new Date(`${today}T00:00:00Z`);

  // ── Marks (report cards)
  const canAll = has("reportcard.read") || has("results.read");
  const canMine = !canAll && has("results.read_assigned");
  let performance: { terms: TermResult[]; scope: "ALL" | "MINE" } | null = null;
  if (canAll || canMine) {
    const cards = await db.reportCard.findMany({ where: { schoolId: ctx.schoolId, studentId, status: { in: ["GENERATED", "PUBLISHED"] } }, orderBy: { generatedAt: "asc" }, take: 12 });
    const year = await db.academicYear.findFirst({ where: { schoolId: ctx.schoolId, isCurrent: true }, select: { id: true } });
    const rows = canMine && year ? await teachingRows(db, ctx, year.id) : [];
    const terms: TermResult[] = [];
    for (const c of cards) {
      const s = c.snapshot as unknown as ReportSnapshot;
      const before = terms.at(-1);
      const subjects = s.subjects
        .filter((x) => canAll || teaches(rows, { classId: c.classId, streamId: c.streamId, subjectId: x.subjectId }))
        .map((x) => {
          const prev = before?.subjects.find((p) => p.id === x.subjectId);
          return { id: x.subjectId, name: x.name, percent: x.percent, grade: x.grade, classMean: x.classMean, position: x.position, classCount: x.classCount, change: prev ? Math.round((x.percent - prev.percent) * 10) / 10 : null, exams: x.exams.map((e) => ({ examId: e.examId, percent: e.percent, status: e.status })) };
        });
      if (!canAll && subjects.length === 0) continue;
      terms.push({ id: c.id, term: `${s.term.name} · ${s.term.year}`, status: c.status, average: canAll ? s.summary.average : null, grade: canAll ? s.summary.grade : null, division: canAll ? s.summary.division : null, position: canAll ? s.summary.position : null, classSize: s.summary.classSize, exams: s.exams.map((e) => ({ id: e.id, name: e.name })), subjects });
    }
    performance = { terms, scope: canAll ? "ALL" : "MINE" };
  }

  // ── Attendance: the last six months of finalised registers, in the person's own scope
  let attendance: Awaited<ReturnType<typeof studentReport>> | null = null;
  if (["attendance.read", "attendance.read_assigned", "attendance.take", "attendance.take_any"].some(has)) {
    attendance = await studentReport(ctx, studentId, { from: formatDateOnly(new Date(todayDate.getTime() - 180 * DAY)), to: today }).catch(() => null);
  }

  // ── Fees (people who may read finance)
  const fees = has("fees.read") ? (await loadStudentFinance(db, ctx.schoolId, studentId, today).catch(() => null))?.ledger ?? null : null;

  // ── Homework (the staff who set it, or the school's overseers)
  let homework: { handedIn: number; late: number; marked: number; averagePct: number | null; recent: { id: string; title: string; subject: string; late: boolean; scorePct: number | null; at: Date }[] } | null = null;
  if (has("assignments.oversee") || has("assignments.manage")) {
    const subs = await db.assignmentSubmission.findMany({
      where: { schoolId: ctx.schoolId, studentId, ...(has("assignments.oversee") ? {} : { assignment: { teacherStaffId: ctx.staffId ?? "00000000-0000-0000-0000-000000000000" } }) },
      orderBy: { submittedAt: "desc" }, take: 40, include: { assignment: { select: { id: true, title: true, subjectId: true, maxScore: true } } },
    });
    const subjects = await db.subject.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(subs.map((s) => s.assignment.subjectId))] } }, select: { id: true, name: true } });
    const pct = (s: (typeof subs)[number]) => (s.score !== null && s.assignment.maxScore && Number(s.assignment.maxScore) > 0 ? (Number(s.score) / Number(s.assignment.maxScore)) * 100 : null);
    const scored = subs.map(pct).filter((x): x is number => x !== null);
    homework = {
      handedIn: subs.length, late: subs.filter((s) => s.late).length, marked: scored.length,
      averagePct: scored.length ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10 : null,
      recent: subs.slice(0, 6).map((s) => ({ id: s.id, title: s.assignment.title, subject: subjects.find((x) => x.id === s.assignment.subjectId)?.name ?? "", late: s.late, scorePct: pct(s) === null ? null : Math.round((pct(s) as number) * 10) / 10, at: s.submittedAt })),
    };
  }

  // ── Behaviour records the person may read
  const behaviour = has("behaviour.record") || has("behaviour.read_all") ? await listBehaviour(ctx, { studentId }).then((r) => r.slice(0, 8)).catch(() => null) : null;

  return { performance, attendance, fees, homework, behaviour, today };
}
