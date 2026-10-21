import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import { todayInTimezone } from "@/lib/dates";
import { stageHref } from "@/lib/admissions/links";
import { teachersFor } from "@/lib/admissions/exams";
import * as academics from "@/server/academics";
import * as admissions from "@/server/admissions";
import * as desk from "@/server/admission-desk";
import * as documents from "@/server/documents";
import * as exams from "@/server/admission-exams";
import * as flow from "@/server/admission-flow";
import * as interviews from "@/server/interviews";
import * as offers from "@/server/admission-offers";
import * as policy from "@/server/admission-policy";
import * as stages from "@/server/admission-stages";
import * as students from "@/server/students";
import { awaitingPlacement } from "@/server/admission-queues";
import { LocalDiskStorage } from "@/lib/storage/local";
import { setStorageForTests } from "@/lib/storage";
import { createCurrentYearAcademics, createTestSchool, createTestUser } from "../helpers";

/*
 * Application -> interview -> teacher assignment -> examination -> marking -> results -> decision -> school fee -> registration -> Student ID ->
 * class. Each step is its own record, and each department can do only its own part: the office assigns, the teacher marks, the Academic Office
 * approves, Admissions decides, Finance verifies, Admissions registers and places.
 */

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, rehema: AuthContext, academic: AuthContext, finance: AuthContext, outsider: AuthContext;
let teacherA: AuthContext, teacherB: AuthContext, teacherC: AuthContext, teacherD: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let nurseryClassId: string;
let english: { id: string }, maths: { id: string };
let zone = "Africa/Dar_es_Salaam";
let n = 95000;
const next = () => ++n;
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(200, 0x20)]);
const ymd = (offset: number) => { const t = new Date(`${todayInTimezone(zone)}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + offset); return t.toISOString().slice(0, 10); };
const dayAt = (offset: number) => `${ymd(offset)}T10:00`;

async function setPolicy(o: { fee?: string; approval?: boolean; auto?: boolean; pass?: number } = {}) {
  await policy.updateAdmissionPolicy(admin, {
    requireInterview: "on", requiredDocTypes: ["BIRTH_CERTIFICATE"], admissionFee: o.fee ?? "0", requirePaymentBeforeEnrol: "on", offerValidDays: 14, allowDirectRegistration: "on", interviewMinutes: 30,
    [`assessment_${setup.level.id}`]: "BOTH",
    examSettings: "1", examSubjects: [english.id, maths.id], examMaxMark: 100, ...(o.approval ? { examApproval: "on" } : {}), ...(o.auto ? { examAutoAccept: "on" } : {}), examPassPercent: o.pass ?? 50,
  });
}

async function newApp(classId = setup.cls.id) {
  const a = await admissions.createApplication(rehema, { firstName: `Exam${next()}`, lastName: `Case${n}`, dateOfBirth: "2018-05-04", gender: "MALE", classAppliedId: classId, guardians: [{ fullName: `Parent ${n}`, phone: `0764${String(n).padStart(6, "0")}`, relationship: "MOTHER", isPrimary: "on" }] });
  await documents.uploadDocument(rehema, { applicationId: a.id }, { docType: "BIRTH_CERTIFICATE", fileName: "bc.pdf", bytes: PDF });
  return a;
}
/** An application accepted for review with its interview date set (the interview is in the future). */
async function interviewed(classId = setup.cls.id) {
  const a = await newApp(classId);
  await flow.acceptReview(rehema, a.id, { papersChecked: true, scheduledAt: dayAt(5 + (n % 20)) });
  const iv = await db.interview.findFirstOrThrow({ where: { applicationId: a.id, status: "SCHEDULED" } });
  return { a, iv };
}
const pastInterview = (id: string) => db.interview.update({ where: { id }, data: { scheduledAt: new Date(Date.now() - 3_600_000) } });
const taskOf = (interviewId: string, subjectId: string) => db.applicationExam.findFirstOrThrow({ where: { interviewId, subjectId, status: { not: "CANCELLED" } } });
async function assignBoth(iv: { id: string }) {
  await exams.assignExam(academic, iv.id, { subjectId: english.id, teacherId: teacherA.userId });
  await exams.assignExam(academic, iv.id, { subjectId: maths.id, teacherId: teacherB.userId });
}
async function submitBoth(iv: { id: string }) {
  await exams.saveExamMarks(teacherA, (await taskOf(iv.id, english.id)).id, { mark: "85", submit: "true" });
  await exams.saveExamMarks(teacherB, (await taskOf(iv.id, maths.id)).id, { mark: "55", submit: "true" });
}

beforeAll(async () => {
  school = await createTestSchool();
  zone = (await db.school.findUniqueOrThrow({ where: { id: school.id }, select: { timezone: true } })).timezone;
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  rehema = (await createTestUser(school.id, ["registrar"])).ctx;
  academic = (await createTestUser(school.id, ["academic_office"], { fullName: "Academic Officer" })).ctx;
  finance = (await createTestUser(school.id, ["accountant"])).ctx;
  outsider = (await createTestUser(school.id, ["accountant"], { fullName: "Not A Teacher" })).ctx;
  teacherA = (await createTestUser(school.id, ["class_teacher"], { fullName: "Teacher A" })).ctx;
  teacherB = (await createTestUser(school.id, ["subject_teacher"], { fullName: "Teacher B" })).ctx;
  teacherC = (await createTestUser(school.id, ["class_teacher"], { fullName: "Teacher C" })).ctx;
  teacherD = (await createTestUser(school.id, ["class_teacher"], { fullName: "Teacher D" })).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: [] });
  const nursery = await academics.createLevel(admin, { name: "Nursery", sortOrder: 2 });
  nurseryClassId = (await academics.createClass(admin, { levelId: nursery.id, name: "Nursery A", sortOrder: 2 })).id;
  english = await academics.createSubject(admin, { code: "ENG", name: "English" });
  maths = await academics.createSubject(admin, { code: "MAT", name: "Mathematics" });
  // the school has recorded who teaches what: English by A (and later C), Mathematics by B
  const staffOf = async (c: AuthContext) => (await db.staff.findUniqueOrThrow({ where: { userId: c.userId } })).id;
  for (const [subject, who] of [[english, teacherA], [maths, teacherB]] as const) {
    await db.subjectTeacher.create({ data: { schoolId: school.id, academicYearId: setup.year.id, classId: setup.cls.id, subjectId: subject.id, staffId: await staffOf(who) } });
  }
  setStorageForTests(new LocalDiskStorage(await mkdtemp(path.join(tmpdir(), "sam-exams-"))));
  await setPolicy();
});
afterAll(() => setStorageForTests(undefined));

describe("opening an applicant from the Interviews list shows the interview workspace, not the application", () => {
  it("opens the interview of that applicant, with its date, subjects and progress; the same by direct address; clear answers otherwise", async () => {
    const { a, iv } = await interviewed();
    const row = await desk.deskRow(rehema, a.id);
    expect(row.state).toBe("INTERVIEW_SCHEDULED");
    expect(row.interviewId).toBe(iv.id);
    expect(stageHref(row)).toBe(`/admissions/interviews/${iv.id}`); // the list's View link
    expect(stageHref(row)).not.toBe(`/admissions/${a.id}`);

    const ws = await stages.interviewWorkspace(rehema, iv.id);
    if (ws.mode !== "INTERVIEW") throw new Error("expected the interview");
    expect(ws.applicationId).toBe(a.id);
    expect(ws.interview.id).toBe(iv.id);
    expect(ws.interview.scheduledAt.getTime()).toBe(iv.scheduledAt.getTime());
    expect(ws.applicant.applicationNo).toBe(a.applicationNo);
    expect(ws.exam.progress.state).toBe("NOT_ASSIGNED");
    expect(ws.exam.progress.missingSubjectIds.sort()).toEqual([english.id, maths.id].sort());
    expect(ws.setup?.subjects.map((s) => s.id)).toEqual(expect.arrayContaining([english.id, maths.id]));
    expect(ws.setup?.teachers.map((t) => t.id)).toEqual(expect.arrayContaining([teacherA.userId, teacherB.userId]));
    expect(ws.setup?.teachers.map((t) => t.id)).not.toContain(outsider.userId); // only people who may mark are offered

    // refreshing, or opening the address directly, gives the same record; the application id finds the same interview
    const again = await stages.interviewWorkspace(rehema, iv.id);
    expect(again.mode === "INTERVIEW" && again.interview.id).toBe(iv.id);
    const byApplication = await stages.interviewWorkspace(rehema, a.id);
    expect(byApplication.mode === "INTERVIEW" && byApplication.interview.id).toBe(iv.id);

    // an applicant with no interview gets a message and the permitted actions, never a redirect
    const none = await newApp();
    const w2 = await stages.interviewWorkspace(rehema, none.id);
    expect(w2.mode).toBe("NONE");
    // a record that does not exist, or belongs to another school, is "not found"
    expect(await code(stages.interviewWorkspace(rehema, "0199aaaa-0000-7000-8000-000000000000"))).toBe("NOT_FOUND");
    expect(await code(stages.interviewWorkspace(rehema, "not-an-id"))).toBe("NOT_FOUND");
    const otherSchool = await createTestSchool("Other");
    const otherRegistrar = (await createTestUser(otherSchool.id, ["registrar"])).ctx;
    expect(await code(stages.interviewWorkspace(otherRegistrar, iv.id))).toBe("NOT_FOUND");
    // people with no admissions role cannot open it at all
    expect(await code(stages.interviewWorkspace(teacherA, iv.id))).toBe("FORBIDDEN");
  });
});

describe("assigning teachers to the subjects of an interview", () => {
  it("the Academic Office assigns the right teachers; wrong, duplicate and unauthorised requests are refused; changes keep their history", async () => {
    const { a, iv } = await interviewed();
    const eng = await exams.assignExam(academic, iv.id, { subjectId: english.id, teacherId: teacherA.userId, instructions: "Reading and writing, 45 minutes" });
    const mat = await exams.assignExam(academic, iv.id, { subjectId: maths.id, teacherId: teacherB.userId, dueOn: ymd(30) });
    expect(eng.already).toBe(false);
    const live = await db.applicationExam.findMany({ where: { interviewId: iv.id, status: { not: "CANCELLED" } } });
    expect(live).toHaveLength(2);
    expect(live.every((e) => e.applicationId === a.id && e.interviewId === iv.id)).toBe(true);
    expect(live.find((e) => e.subjectId === english.id)?.assignedToId).toBe(teacherA.userId);
    expect(live.find((e) => e.subjectId === maths.id)?.assignedToId).toBe(teacherB.userId);
    expect(Number(live[0]!.maxMark)).toBe(100);

    // asking again changes nothing (no duplicate task)
    expect(await exams.assignExam(academic, iv.id, { subjectId: english.id, teacherId: teacherA.userId })).toEqual({ id: eng.id, already: true });
    expect(await db.applicationExam.count({ where: { interviewId: iv.id, subjectId: english.id, status: { not: "CANCELLED" } } })).toBe(1);

    // refused: a teacher who does not teach the subject, someone who may not mark, a teacher assigning, a teacher who is not staff of this school
    expect(await code(exams.assignExam(academic, iv.id, { subjectId: maths.id, teacherId: teacherA.userId }))).toBe("VALIDATION"); // A does not teach Mathematics
    expect(await code(exams.assignExam(academic, iv.id, { subjectId: maths.id, teacherId: teacherC.userId }))).toBe("VALIDATION"); // C does not teach Mathematics
    expect(await code(exams.assignExam(academic, iv.id, { subjectId: english.id, teacherId: outsider.userId }))).toBe("VALIDATION");
    expect(await code(exams.assignExam(teacherA, iv.id, { subjectId: english.id, teacherId: teacherA.userId }))).toBe("FORBIDDEN");
    expect(await code(exams.assignExam(academic, iv.id, { subjectId: english.id, teacherId: "00000000-0000-4000-8000-000000000000" }))).toBe("VALIDATION");

    // changing the teacher keeps who changed it; the first assignment stays in the history
    await db.subjectTeacher.create({ data: { schoolId: school.id, academicYearId: setup.year.id, classId: setup.cls.id, subjectId: english.id, staffId: (await db.staff.findUniqueOrThrow({ where: { userId: teacherC.userId } })).id } });
    expect((await exams.assignExam(academic, iv.id, { subjectId: english.id, teacherId: teacherC.userId })).already).toBe(false);
    expect((await taskOf(iv.id, english.id)).assignedToId).toBe(teacherC.userId);
    const history = await db.applicationExamEvent.findMany({ where: { examId: eng.id }, orderBy: { createdAt: "asc" } });
    expect(history.map((h) => h.kind)).toEqual(["ASSIGN", "REASSIGN"]);
    expect(history.every((h) => h.byId === academic.userId)).toBe(true);
    await expect(db.applicationExamEvent.update({ where: { id: history[0]!.id }, data: { kind: "SAVE" } })).rejects.toThrow(); // append-only
    await exams.assignExam(academic, iv.id, { subjectId: english.id, teacherId: teacherA.userId }); // back to A
    expect(mat.id).toBeTruthy();
  });

  it("offers and accepts only the teachers of the class the applicant applied for; falls back to teachers of the subject in other classes, then to anyone who may mark", async () => {
    const { iv } = await interviewed();
    const levelId = setup.level.id;
    const other = await academics.createClass(admin, { levelId, name: "Standard II", sortOrder: 9 });
    const kiswahili = await academics.createSubject(admin, { code: "KIS", name: "Kiswahili" });
    const history = await academics.createSubject(admin, { code: "HIS", name: "History" });
    const staffOf = async (c: AuthContext) => (await db.staff.findUniqueOrThrow({ where: { userId: c.userId } })).id;
    // D teaches English only in ANOTHER class; Kiswahili is taught only in the other class (by D); nobody is recorded for History
    await db.subjectTeacher.create({ data: { schoolId: school.id, academicYearId: setup.year.id, classId: other.id, subjectId: english.id, staffId: await staffOf(teacherD) } });
    await db.subjectTeacher.create({ data: { schoolId: school.id, academicYearId: setup.year.id, classId: other.id, subjectId: kiswahili.id, staffId: await staffOf(teacherD) } });

    const ws = await stages.interviewWorkspace(rehema, iv.id);
    if (ws.mode !== "INTERVIEW" || !ws.setup) throw new Error("expected the workspace with its setup");
    const records = ws.setup.teachers;
    expect(ws.setup.appliedClass).toBe("Standard I");
    // English in Standard I: only the teachers recorded for that class (A), not D (who teaches it elsewhere) and not everybody
    expect(teachersFor(english.id, records)).toMatchObject({ tier: "CLASS" });
    expect(teachersFor(english.id, records).ids).toContain(teacherA.userId);
    expect(teachersFor(english.id, records).ids).not.toContain(teacherD.userId);
    expect(teachersFor(english.id, records).ids).not.toContain(teacherB.userId);
    // Kiswahili: nobody in Standard I, so the teachers of it in other classes (D)
    expect(teachersFor(kiswahili.id, records)).toMatchObject({ tier: "SUBJECT", ids: [teacherD.userId] });
    // History: nobody recorded, so every teacher who may mark
    expect(teachersFor(history.id, records).tier).toBe("ANY");
    expect(teachersFor(history.id, records).ids).toEqual(expect.arrayContaining([teacherA.userId, teacherB.userId, teacherD.userId]));

    // the server applies the same rule
    const refused = await exams.assignExam(academic, iv.id, { subjectId: english.id, teacherId: teacherD.userId }).then(() => null, (e: AppError) => e);
    expect(refused?.code).toBe("VALIDATION");
    expect(JSON.stringify(refused?.fieldErrors)).toMatch(/does not teach English in Standard I/);
    expect(await code(exams.assignExam(academic, iv.id, { subjectId: kiswahili.id, teacherId: teacherA.userId }))).toBe("VALIDATION");
    expect((await exams.assignExam(academic, iv.id, { subjectId: kiswahili.id, teacherId: teacherD.userId })).already).toBe(false);
    expect((await exams.assignExam(academic, iv.id, { subjectId: history.id, teacherId: teacherC.userId })).already).toBe(false);
    // changing a teacher is one action on the existing assignment (nothing is assigned twice)
    expect(await db.applicationExam.count({ where: { interviewId: iv.id, subjectId: english.id, status: { not: "CANCELLED" } } })).toBe(0);
    await exams.assignExam(academic, iv.id, { subjectId: english.id, teacherId: teacherA.userId });
    expect(await db.applicationExam.count({ where: { interviewId: iv.id, subjectId: english.id, status: { not: "CANCELLED" } } })).toBe(1);
  });
});

describe("marking, results and the admission decision (no approval step)", () => {
  it("one of two subjects unmarked keeps the results incomplete and blocks the decision; the teacher marks only their own task; marks are checked; submitted results are fixed", async () => {
    await setPolicy({ fee: "0" });
    const { a, iv } = await interviewed();
    await assignBoth(iv);
    const eng = await taskOf(iv.id, english.id), mat = await taskOf(iv.id, maths.id);

    // not before the examination has taken place
    expect(await code(exams.saveExamMarks(teacherA, eng.id, { mark: "80", submit: "true" }))).toBe("CONFLICT");
    await pastInterview(iv.id);

    // another teacher, and the Admissions Office, cannot enter or change these marks
    expect(await code(exams.saveExamMarks(teacherB, eng.id, { mark: "70", submit: "true" }))).toBe("FORBIDDEN");
    expect(await code(exams.saveExamMarks(rehema, eng.id, { mark: "70", submit: "true" }))).toBe("FORBIDDEN");
    expect(await code(exams.saveExamMarks(academic, eng.id, { mark: "70", submit: "true" }))).toBe("FORBIDDEN");
    expect((await taskOf(iv.id, english.id)).mark).toBeNull();

    // a mark is checked against the maximum of that examination
    expect(await code(exams.saveExamMarks(teacherA, eng.id, { mark: "120", submit: "true" }))).toBe("VALIDATION");
    expect(await code(exams.saveExamMarks(teacherA, eng.id, { mark: "abc" }))).toBe("VALIDATION");
    expect(await code(exams.saveExamMarks(teacherA, eng.id, { mark: "", submit: "true" }))).toBe("VALIDATION");
    expect((await taskOf(iv.id, english.id)).status).toBe("ASSIGNED");

    // a saved draft is private to the teacher until it is submitted
    expect(await exams.saveExamMarks(teacherA, eng.id, { mark: "60", comment: "Needs checking" })).toMatchObject({ status: "DRAFT" });
    expect((await exams.getExam(teacherA, eng.id)).mark).toBe(60);
    expect((await exams.getExam(rehema, eng.id)).mark).toBeNull();
    expect((await exams.examSummaryOf(db, school.id, a.id)).progress.state).toBe("INCOMPLETE");

    // English submitted, Mathematics not: still incomplete, and the decision is refused with the reason
    expect(await exams.saveExamMarks(teacherA, eng.id, { mark: "85", comment: "Good", submit: "true" })).toMatchObject({ status: "SUBMITTED", complete: false });
    const row = await desk.deskRow(rehema, a.id);
    expect(row.exam.state).toBe("INCOMPLETE");
    expect(row.ivStage).toBe("EXAMS");
    expect(row.exam.outstanding).toEqual([{ subject: "Mathematics", teacher: "Teacher B", why: "MARKING" }]);
    const refused = await flow.recordQuickResult(rehema, a.id, { outcome: "PASSED" }).then(() => null, (e: AppError) => e);
    expect(refused?.code).toBe("CONFLICT");
    expect(refused?.message).toMatch(/Mathematics/);
    expect(await code(offers.acceptApplication(rehema, a.id, {}))).toBe("CONFLICT");
    expect(await code(interviews.recordInterviewResult(rehema, iv.id, { status: "COMPLETED", outcome: "PASSED" }))).toBe("CONFLICT");
    expect((await db.interview.findUniqueOrThrow({ where: { id: iv.id } })).status).toBe("SCHEDULED"); // nothing changed

    // once submitted, the teacher cannot change the result
    expect(await code(exams.saveExamMarks(teacherA, eng.id, { mark: "95", submit: "true" }))).toBe("CONFLICT");
    expect(Number((await taskOf(iv.id, english.id)).mark)).toBe(85);

    // Mathematics submitted: complete, ready for the decision, and Admissions is told
    expect(await exams.saveExamMarks(teacherB, mat.id, { mark: "55", submit: "true" })).toMatchObject({ status: "SUBMITTED", complete: true });
    const ready = await desk.deskRow(rehema, a.id);
    expect(ready.exam.state).toBe("COMPLETE");
    expect(ready.ivStage).toBe("READY");
    expect(await db.workflowTask.count({ where: { relatedId: a.id, kind: "DECISION_REVIEW", sourceEvent: "admission_exam.complete" } })).toBe(1);

    // the decision is Admissions' own step and does not touch the marks
    const before = await db.applicationExam.findMany({ where: { interviewId: iv.id }, orderBy: { subjectId: "asc" }, select: { id: true, mark: true, outcome: true, comment: true, status: true, assignedToId: true } });
    expect(await flow.recordQuickResult(rehema, a.id, { outcome: "PASSED", note: "Welcome" })).toMatchObject({ passed: true, landing: "placement" });
    const after = await db.applicationExam.findMany({ where: { interviewId: iv.id }, orderBy: { subjectId: "asc" }, select: { id: true, mark: true, outcome: true, comment: true, status: true, assignedToId: true } });
    expect(after).toEqual(before);
    expect((await db.application.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("ENROLLED");
    // the history records each save and submission, with the marks before and after
    const log = await db.applicationExamEvent.findMany({ where: { examId: eng.id }, orderBy: { createdAt: "asc" } });
    expect(log.map((l) => l.kind)).toEqual(["ASSIGN", "SAVE", "SUBMIT"]);
  });

  it("a school that asks for non-numeric outcomes accepts only the ones it set", async () => {
    await policy.updateAdmissionPolicy(admin, { requireInterview: "on", requiredDocTypes: ["BIRTH_CERTIFICATE"], admissionFee: "0", offerValidDays: 14, allowDirectRegistration: "on", interviewMinutes: 30, [`assessment_${setup.level.id}`]: "BOTH", examSettings: "1", examSubjects: [english.id, maths.id], examMaxMark: 100, examOutcomes: "Pass, Absent" });
    const { iv } = await interviewed();
    await assignBoth(iv);
    await pastInterview(iv.id);
    const eng = await taskOf(iv.id, english.id);
    expect(await code(exams.saveExamMarks(teacherA, eng.id, { outcome: "Maybe", submit: "true" }))).toBe("VALIDATION");
    expect(await code(exams.saveExamMarks(teacherA, eng.id, { mark: "50", outcome: "Pass", submit: "true" }))).toBe("VALIDATION");
    expect(await exams.saveExamMarks(teacherA, eng.id, { outcome: "Pass", submit: "true" })).toMatchObject({ status: "SUBMITTED" });
    await setPolicy(); // back to marks only
  });
});

describe("results approved by the Academic Office", () => {
  it("submitted results stay pending until approved; a result is corrected only by returning it; the reviewer must be someone else; nothing changes after the decision", async () => {
    await setPolicy({ fee: "0", approval: true });
    const { a, iv } = await interviewed();
    await assignBoth(iv);
    await pastInterview(iv.id);
    await submitBoth(iv);
    const eng = await taskOf(iv.id, english.id), mat = await taskOf(iv.id, maths.id);

    // submitted but not approved: not final, and Admissions cannot decide
    let row = await desk.deskRow(rehema, a.id);
    expect(row.exam.state).toBe("AWAITING_REVIEW");
    expect(row.ivStage).toBe("REVIEW");
    expect(await db.workflowTask.count({ where: { relatedId: a.id, kind: "EXAM_REVIEW", status: "PENDING" } })).toBe(2); // the Academic Office has two to review
    expect(await code(flow.recordQuickResult(rehema, a.id, { outcome: "PASSED" }))).toBe("CONFLICT");

    // only people who review may approve or return; Admissions and the teacher may not
    expect(await code(exams.reviewExam(rehema, eng.id, { decision: "APPROVE" }))).toBe("FORBIDDEN");
    expect(await code(exams.reviewExam(teacherA, eng.id, { decision: "APPROVE" }))).toBe("FORBIDDEN");
    expect(await code(exams.reviewExam(academic, mat.id, { decision: "RETURN" }))).toBe("VALIDATION"); // say what to correct
    expect(await exams.reviewExam(academic, eng.id, { decision: "APPROVE" })).toEqual({ status: "APPROVED", already: false });
    expect(await exams.reviewExam(academic, eng.id, { decision: "APPROVE" })).toEqual({ status: "APPROVED", already: true }); // again: no change
    row = await desk.deskRow(rehema, a.id);
    expect(row.exam.state).toBe("AWAITING_REVIEW"); // Mathematics is still waiting

    // returned for correction: the teacher fixes and submits again; the old mark stays in the history
    expect(await exams.reviewExam(academic, mat.id, { decision: "RETURN", note: "Check question 4" })).toMatchObject({ status: "RETURNED" });
    expect((await desk.deskRow(rehema, a.id)).exam.state).toBe("INCOMPLETE");
    expect((await exams.getExam(teacherB, mat.id)).returnNote).toBe("Check question 4");
    expect(await exams.saveExamMarks(teacherB, mat.id, { mark: "58", submit: "true" })).toMatchObject({ status: "SUBMITTED" });
    expect(await exams.reviewExam(academic, mat.id, { decision: "APPROVE" })).toMatchObject({ status: "APPROVED" });
    const log = await db.applicationExamEvent.findMany({ where: { examId: mat.id }, orderBy: { createdAt: "asc" } });
    expect(log.map((l) => l.kind)).toEqual(["ASSIGN", "SUBMIT", "RETURN", "SUBMIT", "APPROVE"]);
    expect((log[2]!.detail as { mark: number }).mark).toBe(55);
    expect(await db.workflowTask.count({ where: { relatedId: a.id, kind: "EXAM_REVIEW", status: "PENDING" } })).toBe(0);

    // every result approved: eligible for the decision, which is still Admissions' own step
    row = await desk.deskRow(rehema, a.id);
    expect(row.exam.state).toBe("COMPLETE");
    expect(row.ivStage).toBe("READY");
    expect(await flow.recordQuickResult(rehema, a.id, { outcome: "PASSED" })).toMatchObject({ passed: true });
    // after the decision the results are fixed
    expect(await code(exams.reviewExam(academic, eng.id, { decision: "RETURN", note: "Too late" }))).toBe("CONFLICT");
    await setPolicy();
  });
});

describe("accepted, school fee, registration, Student ID and class", () => {
  it("an accepted applicant waits for Finance to verify the school fee, is then registered once with one permanent ID, and is in a class roster only after placement", async () => {
    await setPolicy({ fee: "50000" });
    const { a, iv } = await interviewed();
    await assignBoth(iv);
    await pastInterview(iv.id);
    await submitBoth(iv);

    // the decision: accepted, but not enrolled and not in any roster
    const r = await flow.recordQuickResult(rehema, a.id, { outcome: "PASSED" });
    expect(r).toMatchObject({ passed: true, landing: "payment" });
    let app = await db.application.findUniqueOrThrow({ where: { id: a.id } });
    expect(app.status).toBe("ACCEPTED");
    expect(app.studentId).toBeNull();
    let row = await desk.deskRow(rehema, a.id);
    expect(row.state).toBe("ACCEPTED");
    expect(row.after).toBe("payment");
    expect(stageHref(row)).toBe(`/admissions/accepted/${a.id}`);
    expect((await stages.acceptedList(rehema, "payment")).map((x) => x.id)).toContain(a.id);
    expect((await stages.acceptedList(rehema, "registration")).map((x) => x.id)).not.toContain(a.id);
    const detail = await stages.acceptedDetail(rehema, a.id);
    expect(detail).toMatchObject({ feeCents: 5_000_000, verifiedCents: 0, balanceCents: 5_000_000, accountStatus: "AWAITING_PAYMENT", after: "payment" });
    expect(detail.items.find((i) => i.key === "payment")?.ok).toBe(false);
    expect(await code(flow.enrolNow(rehema, a.id))).toBe("CONFLICT"); // registration waits for Finance

    // Finance owns the payment: Admissions cannot record or verify it, and an unverified payment does not clear the applicant
    expect(await code(offers.recordAdmissionPayment(rehema, a.id, { amount: "50000", method: "BANK", reference: `SLIP-${n}` }))).toBe("FORBIDDEN");
    const { payment } = await offers.recordAdmissionPayment(finance, a.id, { amount: "50000", method: "BANK", reference: `SLIP-${n}` });
    expect(await code(offers.verifyAdmissionPayment(rehema, payment.id))).toBe("FORBIDDEN");
    expect((await stages.acceptedList(rehema, "payment")).find((x) => x.id === a.id)).toMatchObject({ accountStatus: "VERIFICATION_PENDING", pendingCents: 5_000_000 });
    expect(await code(flow.enrolNow(rehema, a.id))).toBe("CONFLICT");

    // verified: Admissions is told and the applicant moves to Registration
    await offers.verifyAdmissionPayment(finance, payment.id);
    row = await desk.deskRow(rehema, a.id);
    expect(row.after).toBe("registration");
    expect((await stages.acceptedList(rehema, "registration")).map((x) => x.id)).toContain(a.id);
    expect((await stages.acceptedList(rehema, "payment")).map((x) => x.id)).not.toContain(a.id);
    expect(await db.workflowTask.count({ where: { relatedId: a.id, kind: "ENROL_APPLICANT" } })).toBe(1);
    expect((await stages.acceptedDetail(rehema, a.id)).remaining).toEqual([]);

    // registration: one official student with one permanent Student ID, from the application, nothing typed again
    await flow.enrolNow(rehema, a.id);
    app = await db.application.findUniqueOrThrow({ where: { id: a.id } });
    expect(app.status).toBe("ENROLLED");
    const student = await db.student.findUniqueOrThrow({ where: { id: app.studentId! } });
    expect(student).toMatchObject({ firstName: app.firstName, lastName: app.lastName });
    expect(student.admissionNo).toBeTruthy();
    expect(await db.student.count({ where: { schoolId: school.id, admissionNo: student.admissionNo } })).toBe(1);
    expect(await code(flow.enrolNow(rehema, a.id))).toBe("CONFLICT"); // no second student
    expect(await db.student.count({ where: { schoolId: school.id, firstName: app.firstName, lastName: app.lastName } })).toBe(1);
    expect(await code(stages.acceptedDetail(rehema, a.id))).toBe("NOT_FOUND"); // it has moved on: never back to this stage
    expect(stageHref(await desk.deskRow(rehema, a.id))).toBe(`/admissions/${a.id}`);

    // registered but not in a class: not on any roster, waiting in Class placement
    expect(await db.studentEnrollment.count({ where: { studentId: student.id } })).toBe(0);
    expect((await awaitingPlacement(rehema)).map((x) => x.id)).toContain(student.id);
    await students.enrollStudent(rehema, student.id, { classId: setup.cls.id });
    const roster = await db.studentEnrollment.findMany({ where: { studentId: student.id } });
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({ classId: setup.cls.id, academicYearId: setup.year.id, status: "ACTIVE" });
    expect((await db.student.findUniqueOrThrow({ where: { id: student.id } })).admissionNo).toBe(student.admissionNo); // the ID did not change
    expect((await awaitingPlacement(rehema)).map((x) => x.id)).not.toContain(student.id);
    await setPolicy();
  });
});

describe("records and levels that need no examination keep working", () => {
  it("an applicant to a level with no entrance examination is decided without any examination task, and its interview opens in the workspace", async () => {
    await setPolicy({ fee: "0" });
    const { a, iv } = await interviewed(nurseryClassId);
    const ws = await stages.interviewWorkspace(rehema, iv.id);
    expect(ws.mode === "INTERVIEW" && ws.exam.progress.state).toBe("NONE");
    expect((await desk.deskRow(rehema, a.id)).ivStage).toBe("SCHEDULED");
    await pastInterview(iv.id);
    expect((await desk.deskRow(rehema, a.id)).ivStage).toBe("READY");
    expect(await flow.recordQuickResult(rehema, a.id, { outcome: "PASSED" })).toMatchObject({ passed: true });
    expect(await db.applicationExam.count({ where: { applicationId: a.id } })).toBe(0);
  });
});

describe("changing an interview carries the assignments with it", () => {
  it("a new date moves the teachers to the new interview; cancelling withdraws what has not been marked", async () => {
    await setPolicy();
    const { iv } = await interviewed();
    await exams.assignExam(academic, iv.id, { subjectId: english.id, teacherId: teacherA.userId });
    const first = await taskOf(iv.id, english.id);
    const moved = await interviews.rescheduleInterview(rehema, iv.id, { scheduledAt: dayAt(40), reason: "Hall was not free" });
    expect((await db.applicationExam.findUniqueOrThrow({ where: { id: first.id } })).interviewId).toBe(moved.id);
    const ws = await stages.interviewWorkspace(rehema, moved.id);
    expect(ws.mode === "INTERVIEW" && ws.exam.lines.map((l) => l.subject)).toEqual(["English"]);
    await interviews.cancelInterview(rehema, moved.id, { reason: "Family withdrew" });
    expect((await db.applicationExam.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("CANCELLED");
    expect((await db.applicationExamEvent.findMany({ where: { examId: first.id }, orderBy: { createdAt: "asc" } })).map((e) => e.kind)).toEqual(["ASSIGN", "CANCEL"]);
  });
});

describe("who sees which examinations", () => {
  it("a teacher sees and opens only their own tasks; the offices see all; the sidebar count follows the work", async () => {
    await setPolicy();
    const { iv } = await interviewed();
    await assignBoth(iv);
    const eng = await taskOf(iv.id, english.id), mat = await taskOf(iv.id, maths.id);
    const mine = (await exams.listExams(teacherA)).rows;
    expect(mine.every((r) => r.mine)).toBe(true);
    expect(mine.map((r) => r.id)).toContain(eng.id);
    expect(mine.map((r) => r.id)).not.toContain(mat.id);
    expect(await code(exams.getExam(teacherB, eng.id))).toBe("NOT_FOUND");
    expect((await exams.getExam(teacherB, mat.id)).id).toBe(mat.id);
    const all = (await exams.listExams(academic)).rows.map((r) => r.id);
    expect(all).toEqual(expect.arrayContaining([eng.id, mat.id]));
    expect((await exams.listExams(rehema)).rows.map((r) => r.id)).toEqual(expect.arrayContaining([eng.id, mat.id]));
    expect(await code(exams.listExams(finance))).toBe("FORBIDDEN");
    expect(await exams.countExamWork(teacherA)).toBe(0); // the interview is still ahead
    await pastInterview(iv.id);
    expect(await exams.countExamWork(teacherA)).toBeGreaterThan(0);
    // withdrawing is the office's job, and only before a result is in
    expect(await code(exams.removeExam(teacherA, eng.id, "no"))).toBe("FORBIDDEN");
    await exams.saveExamMarks(teacherA, eng.id, { mark: "70", submit: "true" });
    expect(await code(exams.removeExam(academic, eng.id, "changed my mind"))).toBe("CONFLICT");
    await exams.removeExam(academic, mat.id, "Teacher is away");
    await exams.removeExam(academic, mat.id, "Teacher is away"); // again: no change
    expect((await taskOf(iv.id, english.id)).id).toBe(eng.id);
  });
});

describe("registering an accepted applicant", () => {
  /** An applicant who passed, with the school fee verified by Finance: waiting in Registration. */
  async function readyToRegister(classId: string) {
    await setPolicy({ fee: "50000" });
    const { a, iv } = await interviewed(classId);
    await pastInterview(iv.id);
    expect(await flow.recordQuickResult(rehema, a.id, { outcome: "PASSED" })).toMatchObject({ landing: "payment" });
    const { payment } = await offers.recordAdmissionPayment(finance, a.id, { amount: "50000", method: "CASH", reference: `REG-${a.id.slice(-8)}` });
    await offers.verifyAdmissionPayment(finance, payment.id);
    return a;
  }

  it("shows what the family wrote, preselects the class applied for, gives the Student ID and the class at once; a full class is refused; the class can wait; the page never goes missing afterwards", async () => {
    const levelId = (await db.schoolClass.findUniqueOrThrow({ where: { id: nurseryClassId } })).levelId;
    const tiny = await academics.createClass(admin, { levelId, name: "Tiny Nursery", sortOrder: 5, capacity: 1 });

    const first = await readyToRegister(tiny.id);
    const detail = await stages.acceptedDetail(rehema, first.id);
    expect(detail.application).toMatchObject({ firstName: first.firstName, lastName: first.lastName, className: "Tiny Nursery" }); // the form's data, nothing retyped
    expect(detail.application.guardians[0]?.fullName).toMatch(/^Parent /);
    expect(detail.placement).toMatchObject({ preferred: tiny.id, appliedClass: "Tiny Nursery", appliedFull: null });
    await admissions.enrolApplication(rehema, first.id, { classId: tiny.id });
    const done = await stages.registeredSummary(rehema, first.id);
    expect(done).toMatchObject({ className: "Tiny Nursery" });
    expect(done?.admissionNo).toBeTruthy();
    expect(await db.studentEnrollment.count({ where: { studentId: done!.studentId, classId: tiny.id, status: "ACTIVE" } })).toBe(1);
    expect(await code(stages.acceptedDetail(rehema, first.id))).toBe("NOT_FOUND"); // the page then shows the registered view, not a missing page
    expect(await stages.registeredSummary(rehema, "0199aaaa-0000-7000-8000-000000000000")).toBeNull();

    // the class is now full: nothing preselected, the choice says so, registering into it is refused and creates nothing
    const second = await readyToRegister(tiny.id);
    const d2 = await stages.acceptedDetail(rehema, second.id);
    expect(d2.placement).toMatchObject({ preferred: "", appliedFull: { count: 1, capacity: 1 } });
    expect(d2.placement.options.find((o) => o.value === tiny.id)).toMatchObject({ full: true });
    const refused = await admissions.enrolApplication(rehema, second.id, { classId: tiny.id }).then(() => null, (e: AppError) => e);
    expect(refused?.code).toBe("CONFLICT");
    expect(refused?.message).toMatch(/full/);
    expect((await db.application.findUniqueOrThrow({ where: { id: second.id } })).studentId).toBeNull();
    await admissions.enrolApplication(rehema, second.id, { classId: nurseryClassId }); // another class works

    // or the class is left for later: the student has the ID and waits in Class placement
    const third = await readyToRegister(tiny.id);
    await admissions.enrolApplication(rehema, third.id, {});
    const later = await stages.registeredSummary(rehema, third.id);
    expect(later?.className).toBeNull();
    expect(later?.admissionNo).toBeTruthy();
    expect((await awaitingPlacement(rehema)).map((x) => x.id)).toContain(later!.studentId);
    await setPolicy();
  });
});

describe("accepting by itself on a pass", () => {
  const submit = async (iv: { id: string }, eng: string, mat: string) => {
    await exams.saveExamMarks(teacherA, (await taskOf(iv.id, english.id)).id, { mark: eng, submit: "true" });
    await exams.saveExamMarks(teacherB, (await taskOf(iv.id, maths.id)).id, { mark: mat, submit: "true" });
  };

  it("accepts when every result is in and the average reaches the pass mark; a lower average, or the setting off, leaves the decision to the office; the marks are never touched", async () => {
    await setPolicy({ fee: "50000", auto: true, pass: 60 });
    // 85 and 55 average 70: accepted by itself, and waits for the school fee
    const pass = await interviewed();
    await assignBoth(pass.iv);
    await pastInterview(pass.iv.id);
    await exams.saveExamMarks(teacherA, (await taskOf(pass.iv.id, english.id)).id, { mark: "85", submit: "true" });
    expect((await db.application.findUniqueOrThrow({ where: { id: pass.a.id } })).status).toBe("INTERVIEW"); // one subject still to come: nothing yet
    await exams.saveExamMarks(teacherB, (await taskOf(pass.iv.id, maths.id)).id, { mark: "55", submit: "true" });
    expect((await db.application.findUniqueOrThrow({ where: { id: pass.a.id } })).status).toBe("ACCEPTED");
    expect(await db.interview.findUniqueOrThrow({ where: { id: pass.iv.id } })).toMatchObject({ status: "COMPLETED", outcome: "PASSED" });
    expect((await stages.acceptedList(rehema, "payment")).map((x) => x.id)).toContain(pass.a.id);
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "admission.auto_accept", entityId: pass.a.id } })).toBe(1);
    expect(await db.workflowTask.count({ where: { relatedId: pass.a.id, kind: "DECISION_REVIEW", status: "PENDING" } })).toBe(0);
    expect(Number((await taskOf(pass.iv.id, english.id)).mark)).toBe(85); // the teachers' marks are untouched

    // 40 and 30 average 35: below the pass mark, so the office decides (nothing is rejected by itself)
    const low = await interviewed();
    await assignBoth(low.iv);
    await pastInterview(low.iv.id);
    await submit(low.iv, "40", "30");
    const row = await desk.deskRow(rehema, low.a.id);
    expect(row.state).toBe("INTERVIEW_SCHEDULED");
    expect(row.ivStage).toBe("READY");
    expect(row.examAverage).toBe(35);
    expect((await exams.examSummaryOf(db, school.id, low.a.id))).toMatchObject({ average: 35, passMark: 60, passed: false });
    expect(await flow.recordQuickResult(rehema, low.a.id, { outcome: "NOT_PASSED" })).toMatchObject({ passed: false }); // the office can still decide by hand

    // with the setting off a pass waits for the office
    await setPolicy({ fee: "50000", pass: 60 });
    const off = await interviewed();
    await assignBoth(off.iv);
    await pastInterview(off.iv.id);
    await submit(off.iv, "90", "90");
    expect((await db.application.findUniqueOrThrow({ where: { id: off.a.id } })).status).toBe("INTERVIEW");
    expect((await desk.deskRow(rehema, off.a.id)).ivStage).toBe("READY");
  });

  it("with approval on, it accepts only after the last approval", async () => {
    await setPolicy({ fee: "50000", auto: true, pass: 50, approval: true });
    const { a, iv } = await interviewed();
    await assignBoth(iv);
    await pastInterview(iv.id);
    await submit(iv, "80", "70");
    expect((await db.application.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("INTERVIEW"); // submitted is not final yet
    await exams.reviewExam(academic, (await taskOf(iv.id, english.id)).id, { decision: "APPROVE" });
    expect((await db.application.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("INTERVIEW");
    await exams.reviewExam(academic, (await taskOf(iv.id, maths.id)).id, { decision: "APPROVE" });
    expect((await db.application.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("ACCEPTED");
    await setPolicy();
  });
});
