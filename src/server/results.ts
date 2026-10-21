import type { SubmissionStatus } from "@/generated/prisma/enums";
import { db, type Db, type Tx } from "@/lib/db";
import { forbidden, invalid, notFound } from "@/lib/errors";
import { requireAnyPermission, type AuthContext } from "@/lib/auth/context";
import { computeTermResults, percentOf, subjectSummary, type MarkEntry, type StudentResult } from "@/lib/results/engine";
import { getResultsSettings, resolveScale } from "@/server/grading";
import { z } from "zod";
import { optUuid, parse, uuid } from "@/lib/validation";

/*
 * Term results for a class. OFFICIAL basis counts only LOCKED submissions; PROVISIONAL also counts APPROVED ones.
 * Anything not yet in a counted status is simply absent from the calculation and reported in `coverage`, never treated as zero.
 */

export type Basis = "OFFICIAL" | "PROVISIONAL";
const COUNTED: Record<Basis, SubmissionStatus[]> = { OFFICIAL: ["LOCKED"], PROVISIONAL: ["APPROVED", "LOCKED"] };

export type ExamMark = { examId: string; examName: string; status: "SCORED" | "ABSENT" | "EXEMPT"; score: number | null; maxMarks: number; percent: number | null };

export async function computeClassResults(client: Db | Tx, schoolId: string, opts: { termId: string; classId: string; streamId?: string | null; basis?: Basis }) {
  const basis = opts.basis ?? "OFFICIAL";
  const term = await client.term.findFirst({ where: { id: opts.termId, schoolId }, include: { academicYear: { select: { id: true, name: true } } } });
  if (!term) throw notFound("Term");
  const cls = await client.schoolClass.findFirst({ where: { id: opts.classId, schoolId }, include: { streams: { select: { id: true, name: true } }, level: { select: { id: true, name: true } } } });
  if (!cls) throw notFound("Class");
  if (opts.streamId && !cls.streams.some((s) => s.id === opts.streamId)) throw invalid("That stream does not belong to the selected class.", { streamId: "Invalid stream" });

  const [settings, scale, exams] = await Promise.all([
    getResultsSettings(client, schoolId),
    resolveScale(client, schoolId, { levelId: cls.levelId }),
    client.exam.findMany({ where: { schoolId, termId: opts.termId }, orderBy: [{ examDate: "asc" }, { createdAt: "asc" }] }),
  ]);
  const examSubjects = await client.examSubject.findMany({ where: { schoolId, classId: opts.classId, examId: { in: exams.map((e) => e.id) } } });
  const submissions = await client.resultSubmission.findMany({ where: { schoolId, examSubjectId: { in: examSubjects.map((e) => e.id) } } });

  // Class list: enrolled in the class (and stream) at any point in the term. Latest enrolment decides the stream.
  const enrol = await client.studentEnrollment.findMany({
    where: {
      schoolId, academicYearId: term.academicYearId, classId: opts.classId, ...(opts.streamId ? { streamId: opts.streamId } : {}),
      startedOn: { lte: term.endsOn }, OR: [{ endedOn: null }, { endedOn: { gte: term.startsOn } }],
    },
    orderBy: { startedOn: "asc" },
    select: { streamId: true, student: { select: { id: true, admissionNo: true, firstName: true, middleName: true, lastName: true, status: true } } },
  });
  const studentMap = new Map<string, { id: string; admissionNo: string; name: string; status: string; streamId: string | null }>();
  for (const e of enrol) studentMap.set(e.student.id, { id: e.student.id, admissionNo: e.student.admissionNo, name: [e.student.firstName, e.student.middleName, e.student.lastName].filter(Boolean).join(" "), status: e.student.status, streamId: e.streamId });
  const students = [...studentMap.values()];

  // A mark counts only when its unit (exam subject + the student's stream) is in a counted status.
  const countedStatuses = new Set<string>(COUNTED[basis]);
  const unitStatus = new Map<string, SubmissionStatus>();
  for (const s of submissions) unitStatus.set(`${s.examSubjectId}:${s.streamId ?? ""}`, s.status);
  const statusFor = (examSubjectId: string, streamId: string | null) => unitStatus.get(`${examSubjectId}:${streamId ?? ""}`) ?? unitStatus.get(`${examSubjectId}:`) ?? null;

  const marks = await client.mark.findMany({ where: { schoolId, examSubjectId: { in: examSubjects.map((e) => e.id) }, studentId: { in: students.map((s) => s.id) } } });
  const esById = new Map(examSubjects.map((e) => [e.id, e]));
  const examById = new Map(exams.map((e) => [e.id, e]));
  const stuById = new Map(students.map((s) => [s.id, s]));

  const entries: MarkEntry[] = [];
  const perExam = new Map<string, ExamMark[]>(); // `${studentId}:${subjectId}` -> exam marks (counted ones)
  for (const m of marks) {
    const es = esById.get(m.examSubjectId)!;
    const st = stuById.get(m.studentId)!;
    const status = statusFor(es.id, st.streamId);
    if (!status || !countedStatuses.has(status)) continue;
    const ex = examById.get(es.examId)!;
    const score = m.score === null ? null : Number(m.score);
    const max = Number(es.maxMarks);
    entries.push({ studentId: m.studentId, subjectId: es.subjectId, examId: ex.id, status: m.status, score, maxMarks: max, weight: Number(ex.weight) });
    const key = `${m.studentId}:${es.subjectId}`;
    (perExam.get(key) ?? perExam.set(key, []).get(key)!).push({ examId: ex.id, examName: ex.name, status: m.status, score, maxMarks: max, percent: m.status === "SCORED" && score !== null ? percentOf(score, max) : null });
  }

  const subjectIds = [...new Set(examSubjects.map((e) => e.subjectId))];
  const subjectRows = await client.subject.findMany({ where: { schoolId, id: { in: subjectIds } }, orderBy: { name: "asc" }, select: { id: true, name: true, nameSw: true, code: true } });

  const results: StudentResult[] = scale
    ? computeTermResults({
        students: students.map((s) => ({ id: s.id, streamId: s.streamId })),
        subjectIds: subjectRows.map((s) => s.id), entries, bands: scale.bands, divisionRules: scale.divisions, divisionBestN: scale.divisionBestN, policy: settings,
      })
    : [];

  const counted = submissions.filter((s) => countedStatuses.has(s.status)).length;
  const coverage = {
    total: submissions.length, counted,
    locked: submissions.filter((s) => s.status === "LOCKED").length,
    approved: submissions.filter((s) => s.status === "APPROVED").length,
    pending: submissions.filter((s) => s.status === "DRAFT" || s.status === "SUBMITTED" || s.status === "RETURNED").length,
    complete: submissions.length > 0 && counted === submissions.length,
  };

  const streamName = new Map(cls.streams.map((s) => [s.id, s.name]));
  const rows = results
    .map((r) => ({ ...r, student: stuById.get(r.studentId)!, streamName: r.streamId ? (streamName.get(r.streamId) ?? null) : null }))
    .sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || a.student.name.localeCompare(b.student.name));

  return {
    basis, term: { id: term.id, name: term.name, year: term.academicYear.name }, class: { id: cls.id, name: cls.name, level: cls.level.name }, streams: cls.streams,
    stream: opts.streamId ? (streamName.get(opts.streamId) ?? null) : null,
    scale: scale ? { id: scale.id, name: scale.name, bands: scale.bands, divisionBestN: scale.divisionBestN, passMark: scale.passMark, divisions: scale.divisions } : null,
    policy: settings, subjects: subjectRows, exams: exams.map((e) => ({ id: e.id, name: e.name, weight: Number(e.weight), category: e.category })),
    coverage, rows, examMarks: perExam,
    summaries: Object.fromEntries(subjectRows.map((s) => [s.id, subjectSummary(results, s.id, settings.decimals)])),
  };
}

const querySchema = z.object({ termId: uuid(), classId: uuid(), streamId: optUuid(), basis: z.enum(["OFFICIAL", "PROVISIONAL"]).default("OFFICIAL") });

/**
 * Class results for people entitled to see a whole class: results.read (everyone) or the class teacher of that
 * class/stream (results.read_assigned). Subject teachers see their own subject through the mark sheet, not other subjects.
 */
export async function getClassResults(ctx: AuthContext, input: unknown) {
  requireAnyPermission(ctx, ["results.read", "results.read_assigned"]);
  const q = parse(querySchema, input);
  if (!ctx.permissions.has("results.read")) {
    const term = await db.term.findFirst({ where: { id: q.termId, schoolId: ctx.schoolId }, select: { academicYearId: true } });
    if (!term) throw notFound("Term");
    const mine = ctx.staffId ? await db.classTeacher.findMany({ where: { staffId: ctx.staffId, schoolId: ctx.schoolId, academicYearId: term.academicYearId, classId: q.classId }, select: { streamId: true } }) : [];
    const ok = mine.some((c) => c.streamId === null || c.streamId === (q.streamId ?? null));
    if (!ok) throw forbidden("Class results are available to the class teacher of this class.");
  }
  return computeClassResults(db, ctx.schoolId, q);
}

export function formatMarkPercent(n: number | null, decimals = 1): string {
  return n === null ? "—" : n.toFixed(decimals);
}
