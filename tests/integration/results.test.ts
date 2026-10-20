import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import * as academics from "@/server/academics";
import * as students from "@/server/students";
import * as grading from "@/server/grading";
import * as exams from "@/server/exams";
import * as marks from "@/server/marks";
import * as results from "@/server/results";
import type { AuthContext } from "@/lib/auth/context";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, head: AuthContext, mathTeacher: AuthContext, engTeacher: AuthContext, classTeacherA: AuthContext, registrar: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let streamA: { id: string }, streamB: { id: string };
let math: { id: string }, eng: { id: string };
let kidsA: { id: string }[] = [];
let kidB: { id: string };
let exam: { id: string };
let scaleId: string;
let n = 9000;

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const BANDS = "A | 80 | 100 | 1\nB | 60 | 79 | 2\nC | 40 | 59 | 3\nD | 0 | 39 | 4";

async function unit(subjectId: string, streamId: string) {
  const subs = await marks.listSubmissions(admin, { examId: exam.id });
  const u = subs.find((s) => s.subjectId === subjectId && s.className === setup.cls.name && (s.streamName === (streamId === streamA.id ? "A" : "B")));
  if (!u) throw new Error("unit not found");
  return u.id;
}
const entries = (rows: [number, string | number | null, string?][]) => rows.map(([i, score, status]) => ({ studentId: kidsA[i]!.id, score, status }));

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  head = (await createTestUser(school.id, ["head_teacher"])).ctx;
  mathTeacher = (await createTestUser(school.id, ["subject_teacher"])).ctx;
  engTeacher = (await createTestUser(school.id, ["subject_teacher"])).ctx;
  classTeacherA = (await createTestUser(school.id, ["class_teacher"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: ["A", "B"] });
  streamA = setup.streams[0]!; streamB = setup.streams[1]!;
  math = await academics.createSubject(admin, { code: "MATH", name: "Mathematics" });
  eng = await academics.createSubject(admin, { code: "ENG", name: "English" });
  await academics.setClassSubjects(admin, setup.cls.id, [math.id, eng.id]);
  const base = { academicYearId: setup.year.id, classId: setup.cls.id };
  await academics.addSubjectTeacher(admin, { ...base, streamId: streamA.id, subjectId: math.id, staffId: mathTeacher.staffId });
  await academics.addSubjectTeacher(admin, { ...base, streamId: streamA.id, subjectId: eng.id, staffId: engTeacher.staffId });
  await academics.setClassTeacher(admin, { ...base, streamId: streamA.id, staffId: classTeacherA.staffId });
  for (let i = 0; i < 4; i++) kidsA.push(await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: streamA.id })));
  kidB = await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: streamB.id }));
});

describe("grading scales", () => {
  it("only grading.manage can configure; invalid bands are refused with a clear message", async () => {
    expect(await code(grading.createScale(head, { name: "X", bands: BANDS }))).toBe("FORBIDDEN");
    const overlap = await grading.createScale(admin, { name: "Bad", bands: "A | 70 | 100 | 1\nB | 60 | 75 | 2\nC | 0 | 59 | 3" }).catch((e) => e as AppError);
    expect(overlap).toBeInstanceOf(AppError);
    expect((overlap as AppError).fieldErrors?.bands).toBeTruthy();
    const noTop = await grading.createScale(admin, { name: "Bad2", bands: "A | 80 | 90 | 1\nB | 0 | 79 | 2" }).catch((e) => e as AppError);
    expect((noTop as AppError).fieldErrors?.bands).toBeTruthy();
  });
  it("creates a default scale with divisions and rejects duplicates", async () => {
    const s = await grading.createScale(admin, { name: "Term scale", bands: BANDS, divisions: "I | 2 | 3\nII | 4 | 5\nIII | 6 | 8", divisionBestN: "2", isDefault: "on", passMark: "40" });
    scaleId = s.id;
    const resolved = await grading.resolveScale(db, school.id, {});
    expect(resolved?.id).toBe(scaleId);
    expect(resolved?.bands).toHaveLength(4);
    expect(await code(grading.createScale(admin, { name: "Term scale", bands: BANDS }))).toBe("VALIDATION");
    expect(await code(grading.createScale(admin, { name: "No best-N", bands: BANDS, divisions: "I | 2 | 3" }))).toBe("VALIDATION");
  });
});

describe("examinations", () => {
  it("head teacher creates an exam; teachers cannot; names are unique per term", async () => {
    const input = { termId: setup.term.id, name: "Midterm test", category: "MIDTERM", maxMarks: "100", weight: "40" };
    expect(await code(exams.createExam(mathTeacher, input))).toBe("FORBIDDEN");
    exam = await exams.createExam(head, input);
    expect(await code(exams.createExam(head, input))).toBe("VALIDATION");
    expect(await code(exams.createExam(head, { ...input, name: "Bad", maxMarks: "0" }))).toBe("VALIDATION");
    expect(await code(exams.createExam(head, { ...input, name: "Bad2", weight: "150" }))).toBe("VALIDATION");
  });
  it("adds the class subjects and creates one submission unit per stream", async () => {
    const r = await exams.addExamSubjects(head, exam.id, { classIds: [setup.cls.id] });
    expect(r.added).toBe(2);
    expect((await marks.listSubmissions(admin, { examId: exam.id }))).toHaveLength(4); // 2 subjects x 2 streams
    expect((await exams.addExamSubjects(head, exam.id, { classIds: [setup.cls.id] })).added).toBe(0); // idempotent
  });
});

describe("entering marks", () => {
  it("scopes teachers to the subject and stream they teach", async () => {
    const mathA = await unit(math.id, streamA.id);
    const engA = await unit(eng.id, streamA.id);
    const mathB = await unit(math.id, streamB.id);
    expect((await marks.getMarkSheet(mathTeacher, mathA)).can.edit).toBe(true);
    expect(await code(marks.getMarkSheet(mathTeacher, engA))).toBe("NOT_FOUND"); // other subject
    expect(await code(marks.getMarkSheet(mathTeacher, mathB))).toBe("NOT_FOUND"); // other stream
    expect(await code(marks.saveMarks(mathTeacher, engA, { entries: entries([[0, 50]]) }))).toBe("NOT_FOUND");
    // The class teacher of stream A may enter any subject of that stream, but not stream B.
    expect((await marks.getMarkSheet(classTeacherA, engA)).can.edit).toBe(true);
    expect(await code(marks.getMarkSheet(classTeacherA, mathB))).toBe("NOT_FOUND");
    // Teachers listing see only their own units.
    expect((await marks.listSubmissions(mathTeacher, { examId: exam.id })).map((s) => s.subjectId)).toEqual([math.id]);
    expect(await marks.listSubmissions(registrar, { examId: exam.id }).catch((e) => (e as AppError).code)).toBe("FORBIDDEN");
  });

  it("rejects invalid marks without saving anything, and never turns empty into zero", async () => {
    const id = await unit(math.id, streamA.id);
    const bad = await marks.saveMarks(mathTeacher, id, { entries: entries([[0, 80], [1, 101], [2, -5], [3, "abc"]]) }).catch((e) => e as AppError);
    expect(bad).toBeInstanceOf(AppError);
    expect(Object.keys((bad as AppError).fieldErrors ?? {})).toEqual([`marks.${kidsA[1]!.id}`, `marks.${kidsA[2]!.id}`, `marks.${kidsA[3]!.id}`]);
    expect(await db.mark.count({ where: { schoolId: school.id } })).toBe(0);

    expect(await code(marks.saveMarks(mathTeacher, id, { entries: [{ studentId: kidB.id, score: 50 }] }))).toBe("VALIDATION"); // not on this list
    expect(await code(marks.saveMarks(mathTeacher, id, { entries: entries([[0, 50, "ABSENT"]]) }))).toBe("VALIDATION"); // absent with a score

    const ok = await marks.saveMarks(mathTeacher, id, { entries: entries([[0, 90], [1, 70], [2, ""], [3, null, "ABSENT"]]) });
    expect(ok).toMatchObject({ saved: 3, cleared: 0 });
    const sheet = await marks.getMarkSheet(mathTeacher, id);
    expect(sheet.rows.find((r) => r.studentId === kidsA[2]!.id)!.mark).toBeNull(); // not entered, not zero
    expect(sheet.rows.find((r) => r.studentId === kidsA[3]!.id)!.mark).toMatchObject({ status: "ABSENT", score: null });
    expect(sheet.rows.find((r) => r.studentId === kidsA[0]!.id)!.mark).toMatchObject({ score: 90, percent: 90, grade: "A" });
    expect(sheet.entered).toBe(3);
  });

  it("refuses to submit until every student has a mark, and detects concurrent edits", async () => {
    const id = await unit(math.id, streamA.id);
    expect(await code(marks.submitMarks(mathTeacher, id))).toBe("VALIDATION"); // student 2 has no mark
    const v = (await marks.getMarkSheet(mathTeacher, id)).submission.version;
    await marks.saveMarks(mathTeacher, id, { expectedVersion: v, entries: entries([[2, 55]]) });
    expect(await code(marks.saveMarks(mathTeacher, id, { expectedVersion: v, entries: entries([[2, 56]]) }))).toBe("CONFLICT"); // stale
  });
});

describe("approval workflow", () => {
  it("submit → approve → lock, with permission and state checks", async () => {
    const id = await unit(math.id, streamA.id);
    await marks.submitMarks(mathTeacher, id);
    expect(await code(marks.submitMarks(mathTeacher, id))).toBe("CONFLICT");
    expect(await code(marks.saveMarks(mathTeacher, id, { entries: entries([[0, 10]]) }))).toBe("CONFLICT"); // submitted = read-only
    expect(await code(marks.approveMarks(mathTeacher, id))).toBe("FORBIDDEN");
    expect(await code(marks.lockMarks(head, id))).toBe("CONFLICT"); // not approved yet
    await marks.approveMarks(head, id);
    expect(await code(marks.approveMarks(head, id))).toBe("CONFLICT");
    await marks.lockMarks(head, id);
    const sheet = await marks.getMarkSheet(head, id);
    expect(sheet.submission.status).toBe("LOCKED");
    expect(sheet.rows.find((r) => r.studentId === kidsA[0]!.id)!.mark).toMatchObject({ percent: 90, grade: "A", points: 1 });
    expect(await code(marks.saveMarks(mathTeacher, id, { entries: entries([[0, 10]]) }))).toBe("CONFLICT");
    const audit = await db.auditLog.findMany({ where: { schoolId: school.id, entityId: id } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["marks.save", "marks.submit", "marks.approve", "marks.lock"]));
  });

  it("a locked grade is not changed by editing the grading scale", async () => {
    const id = await unit(math.id, streamA.id);
    await grading.updateScale(admin, scaleId, { name: "Term scale", bands: "A | 95 | 100 | 1\nB | 70 | 94 | 2\nC | 40 | 69 | 3\nD | 0 | 39 | 4", divisions: "I | 2 | 3\nII | 4 | 5\nIII | 6 | 8", divisionBestN: "2", isDefault: "on" });
    const sheet = await marks.getMarkSheet(head, id);
    expect(sheet.rows.find((r) => r.studentId === kidsA[0]!.id)!.mark).toMatchObject({ percent: 90, grade: "A" }); // snapshot kept (new scale would give B)
    // restore for the rest of the tests
    await grading.updateScale(admin, scaleId, { name: "Term scale", bands: BANDS, divisions: "I | 2 | 3\nII | 4 | 5\nIII | 6 | 8", divisionBestN: "2", isDefault: "on" });
  });

  it("unlock needs a reason, reopens editing, keeps a change history, and re-locks", async () => {
    const id = await unit(math.id, streamA.id);
    expect(await code(marks.unlockMarks(mathTeacher, id, { reason: "typo" }))).toBe("FORBIDDEN");
    expect(await code(marks.unlockMarks(head, id, { reason: "" }))).toBe("VALIDATION");
    await marks.unlockMarks(head, id, { reason: "Student 1 was mis-entered" });
    expect((await marks.getMarkSheet(mathTeacher, id)).can.edit).toBe(true);
    await marks.saveMarks(mathTeacher, id, { entries: entries([[1, 75]]) });
    const hist = await marks.markHistory(head, id);
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ from: "70", to: "75", reason: "Student 1 was mis-entered" });
    await marks.submitMarks(mathTeacher, id);
    await marks.approveMarks(head, id);
    await marks.lockMarks(head, id);
    expect((await marks.getMarkSheet(head, id)).rows.find((r) => r.studentId === kidsA[1]!.id)!.mark).toMatchObject({ percent: 75, grade: "B" });
  });

  it("an approver can return submitted marks with a reason", async () => {
    const id = await unit(eng.id, streamA.id);
    await marks.saveMarks(engTeacher, id, { entries: entries([[0, 60], [1, 85], [2, 45], [3, 30]]) });
    await marks.submitMarks(engTeacher, id);
    expect(await code(marks.returnMarks(head, id, {}))).toBe("VALIDATION");
    await marks.returnMarks(head, id, { reason: "Please re-check student 3" });
    const sheet = await marks.getMarkSheet(engTeacher, id);
    expect(sheet.submission).toMatchObject({ status: "RETURNED", returnReason: "Please re-check student 3" });
    expect(sheet.can.edit).toBe(true);
    await marks.submitMarks(engTeacher, id);
    const r = await marks.bulkTransition(head, "approve", [id]);
    expect(r.done).toEqual([id]);
    expect((await marks.bulkTransition(head, "lock", [id, id])).done).toEqual([id]);
  });
});

describe("class results", () => {
  it("computes weighted results, positions and divisions from locked marks only", async () => {
    const r = await results.computeClassResults(db, school.id, { termId: setup.term.id, classId: setup.cls.id, streamId: streamA.id });
    expect(r.coverage).toMatchObject({ total: 4, locked: 2, complete: false });
    const by = new Map(r.rows.map((x) => [x.studentId, x]));
    // Student 0: Math 90 (A=1), English 60 (B=2) → average 75, points 3 → Division I
    expect(by.get(kidsA[0]!.id)).toMatchObject({ average: 75, total: 150, position: 2, division: "I" });
    // Student 1: Math 75, English 85 → average 80 (best)
    expect(by.get(kidsA[1]!.id)).toMatchObject({ average: 80, position: 1, division: "I" });
    // Student 3: Math absent (excluded), English 30 → average 30, one subject only → INC (needs best 2)
    expect(by.get(kidsA[3]!.id)).toMatchObject({ average: 30, subjectCount: 1, division: "INC" });
    expect(r.rows.map((x) => x.student.name)).toHaveLength(4);
  });

  it("class results are visible to approvers and the class teacher only", async () => {
    const q = { termId: setup.term.id, classId: setup.cls.id, streamId: streamA.id };
    expect((await results.getClassResults(head, q)).rows).toHaveLength(4);
    expect((await results.getClassResults(classTeacherA, q)).rows).toHaveLength(4);
    expect(await code(results.getClassResults(mathTeacher, q))).toBe("FORBIDDEN"); // subject teacher: own subject only
    expect(await code(results.getClassResults(classTeacherA, { ...q, streamId: streamB.id }))).toBe("FORBIDDEN");
    expect(await code(results.getClassResults(registrar, q))).toBe("FORBIDDEN");
  });
});

describe("tenant isolation", () => {
  it("another school cannot see or change these records", async () => {
    const other = await createTestSchool("Other");
    const otherAdmin = (await createTestUser(other.id, ["super_admin"])).ctx;
    const otherHead = (await createTestUser(other.id, ["head_teacher"])).ctx;
    const id = await unit(math.id, streamA.id);
    expect(await code(marks.getMarkSheet(otherAdmin, id))).toBe("NOT_FOUND");
    expect(await code(marks.approveMarks(otherHead, id))).toBe("NOT_FOUND");
    expect(await code(exams.getExam(otherHead, exam.id))).toBe("NOT_FOUND");
    expect(await code(exams.deleteExam(otherHead, exam.id))).toBe("NOT_FOUND");
    expect(await code(grading.updateScale(otherAdmin, scaleId, { name: "Hijack", bands: BANDS }))).toBe("NOT_FOUND");
  });
  it("an exam with marks cannot be deleted", async () => {
    expect(await code(exams.deleteExam(head, exam.id))).toBe("CONFLICT");
  });
});
