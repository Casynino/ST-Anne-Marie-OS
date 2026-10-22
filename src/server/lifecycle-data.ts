import { db, type Db, type Tx } from "@/lib/db";
import { formatDateOnly } from "@/lib/dates";
import { clearanceState, examCompletion, type ClearanceState, type ExamCompletion, type GradeClass, type RequiredUnit, type YearMark } from "@/lib/lifecycle/rules";
import { loadFinance, type StudentFinance } from "@/server/balances";
import { getFeeSettings } from "@/server/fees";
import type { LifecycleSettings } from "@/server/lifecycle-settings";

type Client = Db | Tx;

/*
 * Facts the year lifecycle is worked out from, loaded in one place so the three departments see the same answers: the school's grades in order,
 * the years before and after, whether a student's examinations of a year are complete, and how a year's fees stand for a student.
 */

export type Grade = GradeClass & { capacity: number | null; levelName: string; isActive: boolean };

export async function loadGrades(client: Client, schoolId: string): Promise<Grade[]> {
  const rows = await client.schoolClass.findMany({ where: { schoolId }, include: { level: { select: { name: true, sortOrder: true } } } });
  return rows.map((c) => ({ id: c.id, name: c.name, levelSort: c.level.sortOrder, sortOrder: c.sortOrder, nextClassId: c.nextClassId, isFinalGrade: c.isFinalGrade, capacity: c.capacity, levelName: c.level.name, isActive: c.isActive }));
}

export async function loadYears(client: Client, schoolId: string) {
  return client.academicYear.findMany({ where: { schoolId }, orderBy: { startsOn: "asc" } });
}
type Year = Awaited<ReturnType<typeof loadYears>>[number];

/** The academic year that follows the given one (by start date), or null when none has been set up yet. */
export function yearAfter(years: readonly Year[], yearId: string): Year | null {
  const at = years.findIndex((y) => y.id === yearId);
  return at >= 0 ? years[at + 1] ?? null : null;
}
export function yearBefore(years: readonly Year[], yearId: string): Year | null {
  const at = years.findIndex((y) => y.id === yearId);
  return at > 0 ? years[at - 1]! : null;
}

// ───────────────────────── Examinations of a year ─────────────────────────

export type EnrolmentRef = { studentId: string; classId: string; streamId: string | null };

/** Whether each student's examinations of the year are complete (finalized results and a result for every examined subject of their class). */
export async function examCompletions(client: Client, schoolId: string, yearId: string, enrolments: readonly EnrolmentRef[]): Promise<Map<string, ExamCompletion>> {
  const out = new Map<string, ExamCompletion>();
  if (enrolments.length === 0) return out;
  const exams = await client.exam.findMany({ where: { schoolId, academicYearId: yearId }, select: { id: true, name: true } });
  const classIds = [...new Set(enrolments.map((e) => e.classId))];
  const examSubjects = exams.length ? await client.examSubject.findMany({ where: { schoolId, examId: { in: exams.map((e) => e.id) }, classId: { in: classIds } }, select: { id: true, examId: true, classId: true, subjectId: true } }) : [];
  const [subjects, submissions, marks] = await Promise.all([
    examSubjects.length ? client.subject.findMany({ where: { schoolId, id: { in: [...new Set(examSubjects.map((x) => x.subjectId))] } }, select: { id: true, name: true } }) : [],
    examSubjects.length ? client.resultSubmission.findMany({ where: { schoolId, examSubjectId: { in: examSubjects.map((x) => x.id) } }, select: { examSubjectId: true, streamId: true, status: true } }) : [],
    examSubjects.length ? client.mark.findMany({ where: { schoolId, examSubjectId: { in: examSubjects.map((x) => x.id) }, studentId: { in: enrolments.map((e) => e.studentId) } }, select: { examSubjectId: true, studentId: true, status: true, lockedPercent: true } }) : [],
  ]);
  const label = (x: (typeof examSubjects)[number]) => `${exams.find((e) => e.id === x.examId)?.name ?? "Exam"} · ${subjects.find((s) => s.id === x.subjectId)?.name ?? "Subject"}`;
  for (const e of enrolments) {
    const required: RequiredUnit[] = examSubjects.filter((x) => x.classId === e.classId).map((x) => {
      const subs = submissions.filter((s) => s.examSubjectId === x.id && (s.streamId === null || s.streamId === e.streamId));
      return { examSubjectId: x.id, label: label(x), unit: subs.some((s) => s.status === "LOCKED") ? "LOCKED" : subs.length ? "OPEN" : "NONE" };
    });
    const mine = new Map<string, YearMark>(marks.filter((m) => m.studentId === e.studentId).map((m) => [m.examSubjectId, { status: m.status, percent: m.status === "SCORED" && m.lockedPercent !== null ? Number(m.lockedPercent.toString()) : null }]));
    out.set(e.studentId, examCompletion(required, mine));
  }
  return out;
}

// ───────────────────────── Fees of a year ─────────────────────────

export type YearMoney = { billed: boolean; charged: number; paid: number; outstanding: number };
export type YearFinance = {
  state: ClearanceState; yearId: string;
  /** The bill the registration needs: the first term of the year. */
  firstTerm: YearMoney;
  /** Everything billed for the year. */
  year: YearMoney;
  /** Debt from earlier years, shown separately and never mixed into the year's own figures. */
  previousOutstanding: number; previous: { yearId: string; yearName: string; outstanding: number }[];
  totalOutstanding: number; exception: boolean;
};

const none: YearMoney = { billed: false, charged: 0, paid: 0, outstanding: 0 };

/**
 * How a year's fees stand for each student, from verified payments only (the one balance calculation): what the first term of the year needs, what
 * the whole year costs, and what is still owed from earlier years, kept apart. `exceptions` are students whose payment arrangement Finance approved.
 */
export async function yearFinances(client: Client, schoolId: string, studentIds: readonly string[], yearId: string, settings: LifecycleSettings, exceptions: ReadonlySet<string> = new Set()): Promise<Map<string, YearFinance>> {
  const out = new Map<string, YearFinance>();
  if (studentIds.length === 0) return out;
  const [years, terms, fee, finance] = await Promise.all([
    loadYears(client, schoolId),
    client.term.findMany({ where: { schoolId, academicYearId: yearId }, orderBy: { sequence: "asc" }, select: { id: true } }),
    getFeeSettings(client, schoolId),
    loadFinance(client, schoolId, [...studentIds]),
  ]);
  const target = years.find((y) => y.id === yearId);
  const firstTermId = terms[0]?.id ?? null;
  const startOf = new Map(years.map((y) => [y.id, formatDateOnly(y.startsOn)]));
  for (const id of studentIds) {
    const f: StudentFinance | undefined = finance.get(id);
    const sum = (list: StudentFinance["invoices"]): YearMoney => list.length === 0 ? none : list.reduce((m, i) => { const b = f!.ledger.invoices.get(i.id); return { billed: true, charged: m.charged + (b?.total ?? i.total), paid: m.paid + (b?.paid ?? 0), outstanding: m.outstanding + (b?.outstanding ?? 0) }; }, { ...none, billed: true });
    const inYear = (f?.invoices ?? []).filter((i) => i.academicYearId === yearId);
    const firstTerm = sum(inYear.filter((i) => (firstTermId ? i.termId === firstTermId : true)));
    const earlier = (f?.invoices ?? []).filter((i) => i.academicYearId !== yearId && target && (startOf.get(i.academicYearId) ?? "") < formatDateOnly(target.startsOn));
    const previous = [...new Set(earlier.map((i) => i.academicYearId))].map((y) => ({ yearId: y, yearName: years.find((x) => x.id === y)?.name ?? "", outstanding: sum(earlier.filter((i) => i.academicYearId === y)).outstanding })).filter((p) => p.outstanding > 0);
    const previousOutstanding = previous.reduce((n, p) => n + p.outstanding, 0);
    const yearMoney = sum(inYear);
    out.set(id, {
      yearId, firstTerm, year: yearMoney, previousOutstanding, previous, totalOutstanding: yearMoney.outstanding + previousOutstanding, exception: exceptions.has(id),
      state: clearanceState({ billed: firstTerm.billed, currentOutstanding: firstTerm.outstanding, previousOutstanding, maxOutstanding: fee.clearanceMaxOutstandingCents, previousCounts: settings.previousDebtCounts, exception: exceptions.has(id) }),
    });
  }
  return out;
}
