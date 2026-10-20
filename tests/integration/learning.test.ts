import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildAuthContext, type AuthContext } from "@/lib/auth/context";
import { setStorageForTests } from "@/lib/storage";
import { LocalDiskStorage } from "@/lib/storage/local";
import * as academics from "@/server/academics";
import * as students from "@/server/students";
import * as portal from "@/server/portal";
import * as tt from "@/server/timetable";
import * as plans from "@/server/lesson-plans";
import * as asg from "@/server/assignments";
import * as pf from "@/server/portfolio";
import * as bh from "@/server/behaviour";
import { readLearningFile } from "@/server/learning-files";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, head: AuthContext, tA: AuthContext, tB: AuthContext, tNone: AuthContext, registrar: AuthContext, accountant: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let streamA: { id: string }, streamB: { id: string };
let math: { id: string }, eng: { id: string }, sci: { id: string };
let kidsA: { id: string }[] = [];
let kidB: { id: string };
let parentA: AuthContext, parentB: AuthContext, studentA: AuthContext, studentB: AuthContext;
let storage: LocalDiskStorage;
let n = 200000 + Math.floor(Math.random() * 7_000_000); // phones and emails are unique across the persistent test database

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const TEXTFILE = Buffer.from("this is plain text, not an allowed file type");

async function portalCtx(userId: string) { return buildAuthContext(userId); }

beforeAll(async () => {
  storage = new LocalDiskStorage(await mkdtemp(path.join(tmpdir(), "sam-learning-")));
  setStorageForTests(storage);
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  head = (await createTestUser(school.id, ["head_teacher"])).ctx;
  tA = (await createTestUser(school.id, ["class_teacher"])).ctx;
  tB = (await createTestUser(school.id, ["subject_teacher"])).ctx;
  tNone = (await createTestUser(school.id, ["class_teacher"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  accountant = (await createTestUser(school.id, ["accountant"])).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: ["A", "B"] });
  streamA = setup.streams[0]!; streamB = setup.streams[1]!;
  math = await academics.createSubject(admin, { code: "MATH", name: "Mathematics" });
  eng = await academics.createSubject(admin, { code: "ENG", name: "English" });
  sci = await academics.createSubject(admin, { code: "SCI", name: "Science" });
  await academics.setClassSubjects(admin, setup.cls.id, [math.id, eng.id]);
  await academics.setClassTeacher(admin, { academicYearId: setup.year.id, classId: setup.cls.id, streamId: streamA.id, staffId: tA.staffId });
  await academics.addSubjectTeacher(admin, { academicYearId: setup.year.id, classId: setup.cls.id, streamId: streamB.id, subjectId: math.id, staffId: tB.staffId });
  for (let i = 0; i < 3; i++) kidsA.push(await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: streamA.id })));
  kidB = await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: streamB.id }));
  const guardianOf = async (studentId: string) => (await db.studentGuardian.findFirstOrThrow({ where: { studentId }, select: { guardianId: true } })).guardianId;
  for (const [kid, who] of [[kidsA[0]!, "A"], [kidB, "B"]] as const) {
    const g = await guardianOf(kid.id);
    await portal.createGuardianAccount(registrar, g);
    const gu = await db.guardian.findUniqueOrThrow({ where: { id: g } });
    await portal.createStudentAccount(registrar, kid.id, { email: `s${++n}@test.example` });
    const st = await db.student.findUniqueOrThrow({ where: { id: kid.id } });
    if (who === "A") { parentA = await portalCtx(gu.userId!); studentA = await portalCtx(st.userId!); } else { parentB = await portalCtx(gu.userId!); studentB = await portalCtx(st.userId!); }
  }
});

afterAll(() => setStorageForTests(undefined));

// ───────────────────────── Timetable ─────────────────────────

describe("timetable", () => {
  let p1: { id: string }, p2: { id: string }, brk: { id: string };

  it("only timetable.manage can set up periods; breaks cannot hold lessons", async () => {
    expect(await code(tt.createPeriod(tA, { name: "P1", startTime: "08:00", endTime: "08:40" }))).toBe("FORBIDDEN");
    expect(await code(tt.createPeriod(admin, { name: "Bad", startTime: "09:00", endTime: "08:00" }))).toBe("VALIDATION");
    p1 = await tt.createPeriod(admin, { name: "P1", startTime: "08:00", endTime: "08:40" });
    p2 = await tt.createPeriod(admin, { name: "P2", startTime: "08:40", endTime: "09:20" });
    brk = await tt.createPeriod(admin, { name: "Break", startTime: "09:20", endTime: "09:40", isBreak: "on" });
    expect((await tt.listPeriods(tA)).map((p) => p.name)).toEqual(["P1", "P2", "Break"]);
    expect(await code(tt.setTimetableEntry(admin, { classId: setup.cls.id, dayOfWeek: 1, periodId: brk.id, subjectId: math.id }))).toBe("VALIDATION");
  });

  it("refuses clashes of class, stream, teacher and room, and subjects the class does not take", async () => {
    const slot = { classId: setup.cls.id, dayOfWeek: 1, periodId: p1.id };
    await tt.setTimetableEntry(admin, { ...slot, streamId: streamA.id, subjectId: math.id, teacherStaffId: tA.staffId, room: "R1" });
    expect(await code(tt.setTimetableEntry(admin, { ...slot, streamId: streamB.id, subjectId: math.id, teacherStaffId: tA.staffId }))).toBe("VALIDATION"); // teacher in two places
    expect(await code(tt.setTimetableEntry(admin, { ...slot, streamId: streamB.id, subjectId: math.id, teacherStaffId: tB.staffId, room: "r1" }))).toBe("VALIDATION"); // room, case-insensitive
    await tt.setTimetableEntry(admin, { ...slot, streamId: streamB.id, subjectId: math.id, teacherStaffId: tB.staffId, room: "R2" });
    expect(await code(tt.setTimetableEntry(admin, { ...slot, subjectId: eng.id }))).toBe("VALIDATION"); // whole class over stream lessons
    expect(await code(tt.setTimetableEntry(admin, { ...slot, dayOfWeek: 2, streamId: streamA.id, subjectId: sci.id }))).toBe("VALIDATION"); // subject not in class
    await tt.setTimetableEntry(admin, { classId: setup.cls.id, dayOfWeek: 1, periodId: p2.id, subjectId: eng.id }); // whole class, P2
    expect(await code(tt.setTimetableEntry(admin, { classId: setup.cls.id, dayOfWeek: 1, periodId: p2.id, streamId: streamA.id, subjectId: math.id }))).toBe("VALIDATION");
  });

  it("replacing a lesson updates it in place; clearing removes it", async () => {
    const before = await db.timetableEntry.count({ where: { schoolId: school.id } });
    const e = await tt.setTimetableEntry(admin, { classId: setup.cls.id, dayOfWeek: 1, periodId: p1.id, streamId: streamA.id, subjectId: eng.id, teacherStaffId: tA.staffId, room: "R1" });
    expect(await db.timetableEntry.count({ where: { schoolId: school.id } })).toBe(before);
    expect(e.subjectId).toBe(eng.id);
    await tt.setTimetableEntry(admin, { classId: setup.cls.id, dayOfWeek: 3, periodId: p1.id, streamId: streamA.id, subjectId: math.id });
    const lessons = (await tt.classTimetable(admin, { classId: setup.cls.id })).lessons;
    const wed = lessons.find((l) => l.dayOfWeek === 3)!;
    await tt.clearTimetableEntry(admin, wed.id);
    expect((await tt.classTimetable(admin, { classId: setup.cls.id })).lessons.some((l) => l.id === wed.id)).toBe(false);
    expect(await code(tt.clearTimetableEntry(tA, wed.id))).toBe("FORBIDDEN");
  });

  it("the database refuses a double-booked teacher or room even if the service were bypassed", async () => {
    const row = { schoolId: school.id, academicYearId: setup.year.id, dayOfWeek: 1, periodId: p1.id, classId: setup.cls.id, subjectId: math.id, createdById: admin.userId };
    await expect(db.timetableEntry.create({ data: { ...row, streamId: null, teacherStaffId: tA.staffId } })).rejects.toThrow();
    await expect(db.timetableEntry.create({ data: { ...row, streamId: streamB.id, teacherStaffId: tB.staffId, room: "R1" } })).rejects.toThrow();
  });

  it("teachers and families read the right timetable", async () => {
    const mine = await tt.teacherTimetable(tA, null);
    expect(mine.lessons.every((l) => l.teacherStaffId === tA.staffId)).toBe(true);
    expect(mine.lessons.length).toBeGreaterThan(0);
    const a = await tt.studentTimetable(school.id, kidsA[0]!.id);
    const b = await tt.studentTimetable(school.id, kidB.id);
    expect(a.lessons.some((l) => l.streamId === streamB.id)).toBe(false);
    expect(b.lessons.some((l) => l.streamId === streamA.id)).toBe(false);
    expect(a.lessons.some((l) => l.streamId === null)).toBe(true); // the whole-class English lesson
    expect(await code(tt.classTimetable(accountant, { classId: setup.cls.id }))).toBe("FORBIDDEN");
  });
});

// ───────────────────────── Schemes of work and lesson plans ─────────────────────────

describe("schemes of work and lesson plans", () => {
  let scheme: { id: string };
  const weeks = [{ weekNo: 1, topic: "Numbers to 100" }, { weekNo: 2, topic: "Addition" }];

  it("a teacher plans only what they teach; a stream teacher may write the class scheme", async () => {
    scheme = await plans.createScheme(tA, { classId: setup.cls.id, subjectId: math.id, title: "Maths Term 1", weeks });
    expect(await code(plans.createScheme(tNone, { classId: setup.cls.id, subjectId: math.id, title: "x", weeks }))).toBe("FORBIDDEN");
    expect(await code(plans.createScheme(head, { classId: setup.cls.id, subjectId: math.id, title: "x", weeks }))).toBe("FORBIDDEN");
    expect(await code(plans.createScheme(tB, { classId: setup.cls.id, subjectId: eng.id, title: "x", weeks }))).toBe("FORBIDDEN");
    expect(await code(plans.createScheme(tA, { classId: setup.cls.id, subjectId: math.id, title: "x", weeks: [{ weekNo: 1, topic: "a" }, { weekNo: 1, topic: "b" }] }))).toBe("VALIDATION");
  });

  it("workflow: submit, return with a note, resubmit, approve; nobody edits a submitted plan", async () => {
    expect(await code(plans.getScheme(tNone, scheme.id))).toBe("NOT_FOUND"); // another teacher's draft is invisible
    expect(await code(plans.getScheme(head, scheme.id))).toBe("NOT_FOUND");
    await plans.submitScheme(tA, scheme.id);
    expect(await code(plans.updateScheme(tA, scheme.id, { title: "Changed", weeks }))).toBe("CONFLICT");
    expect((await plans.listSchemes(head, { box: "review" })).some((s) => s.id === scheme.id)).toBe(true);
    expect(await code(plans.reviewScheme(head, scheme.id, { decision: "RETURN" }))).toBe("VALIDATION");
    expect(await code(plans.reviewScheme(tA, scheme.id, { decision: "APPROVE" }))).toBe("FORBIDDEN");
    await plans.reviewScheme(head, scheme.id, { decision: "RETURN", note: "Add assessment" });
    expect((await plans.getScheme(tA, scheme.id)).reviewNote).toBe("Add assessment");
    await plans.updateScheme(tA, scheme.id, { title: "Maths Term 1", weeks: [...weeks, { weekNo: 3, topic: "Subtraction", assessment: "Quiz" }] });
    await plans.submitScheme(tA, scheme.id);
    await plans.reviewScheme(head, scheme.id, { decision: "APPROVE" });
    expect((await plans.getScheme(head, scheme.id)).status).toBe("APPROVED");
    expect(await code(plans.reviewScheme(head, scheme.id, { decision: "APPROVE" }))).toBe("CONFLICT");
  });

  it("lesson plans: scoped to stream and subject, reviewed by plans.review, reflection allowed after approval", async () => {
    const base = { classId: setup.cls.id, subjectId: math.id, lessonDate: setup.today, topic: "Counting", objectives: "Count to 100", activities: "Group counting" };
    const mine = await plans.createLessonPlan(tA, { ...base, streamId: streamA.id });
    expect(await code(plans.createLessonPlan(tA, { ...base, streamId: streamB.id }))).toBe("FORBIDDEN");
    expect(await code(plans.createLessonPlan(tB, { ...base, streamId: streamB.id, subjectId: eng.id }))).toBe("FORBIDDEN");
    await plans.createLessonPlan(tB, { ...base, streamId: streamB.id });
    expect(await code(plans.createLessonPlan(tA, { ...base, streamId: streamA.id, topic: "" }))).toBe("VALIDATION");
    await plans.submitLessonPlan(tA, mine.id);
    await plans.reviewLessonPlan(head, mine.id, { decision: "APPROVE" });
    await plans.addReflection(tA, mine.id, { reflection: "Went well" });
    expect((await plans.getLessonPlan(tA, mine.id)).reflection).toBe("Went well");
    expect(await code(plans.updateLessonPlan(tA, mine.id, { lessonDate: setup.today, topic: "x", objectives: "y", activities: "z" }))).toBe("CONFLICT");
    expect(await code(plans.getLessonPlan(tB, mine.id))).toBe("NOT_FOUND");
  });

  it("the teaching-unit picker offers only what the teacher teaches", async () => {
    const a = await plans.myTeachingUnits(tA);
    expect(a.map((u) => u.subjectName).sort()).toEqual(["English", "Mathematics"]);
    expect(a.every((u) => !u.wholeClass && u.streams.length === 1 && u.streams[0]!.id === streamA.id)).toBe(true);
    const b = await plans.myTeachingUnits(tB);
    expect(b.map((u) => u.subjectName)).toEqual(["Mathematics"]);
    expect(b[0]!.streams[0]!.id).toBe(streamB.id);
    expect(await plans.myTeachingUnits(tNone)).toEqual([]);
  });
});

// ───────────────────────── Assignments ─────────────────────────

describe("assignments", () => {
  const base = () => ({ classId: setup.cls.id, streamId: streamA.id, subjectId: math.id, title: "Counting homework", instructions: "Do page 4", dueAt: tomorrow(), maxScore: "20" });
  let a1: { id: string };

  it("a teacher sets homework only where they teach; drafts stay hidden from families", async () => {
    a1 = await asg.createAssignment(tA, base());
    expect(await code(asg.createAssignment(tA, { ...base(), streamId: "" }))).toBe("FORBIDDEN"); // whole class, but tA teaches stream A only
    expect(await code(asg.createAssignment(tA, { ...base(), streamId: streamB.id }))).toBe("FORBIDDEN");
    expect(await code(asg.createAssignment(tB, { ...base(), streamId: streamB.id, subjectId: eng.id }))).toBe("FORBIDDEN");
    expect(await code(asg.createAssignment(head, base()))).toBe("FORBIDDEN"); // oversight only
    expect(await code(asg.createAssignment(tA, { ...base(), dueAt: new Date(Date.now() - 3600_000).toISOString() }))).toBe("VALIDATION");
    expect(await code(asg.createAssignment(tA, { ...base(), maxScore: "-5" }))).toBe("VALIDATION");
    expect((await asg.childAssignments(parentA, kidsA[0]!.id)).items).toHaveLength(0);
    expect(await code(asg.getChildAssignment(studentA, kidsA[0]!.id, a1.id))).toBe("NOT_FOUND");
  });

  it("publishing shows it to the class family only, notifies portal accounts, and is oversight-readable", async () => {
    await asg.publishAssignment(tA, a1.id);
    expect(await code(asg.publishAssignment(tA, a1.id))).toBe("CONFLICT");
    const seen = await asg.childAssignments(parentA, kidsA[0]!.id);
    expect(seen.items.map((i) => i.id)).toEqual([a1.id]);
    expect(seen.canSubmit).toBe(false); // a parent cannot hand work in
    expect((await asg.childAssignments(studentA, kidsA[0]!.id)).canSubmit).toBe(true);
    expect((await asg.childAssignments(parentB, kidB.id)).items).toHaveLength(0); // other stream
    expect(await code(asg.getChildAssignment(parentB, kidB.id, a1.id))).toBe("NOT_FOUND");
    expect(await code(asg.getChildAssignment(parentB, kidsA[0]!.id, a1.id))).toBe("NOT_FOUND"); // not their child
    expect(await db.inAppNotification.count({ where: { userId: { in: [parentA.userId, studentA.userId] }, link: { contains: a1.id } } })).toBe(2);
    expect(await db.inAppNotification.count({ where: { userId: { in: [parentB.userId, studentB.userId] }, link: { contains: a1.id } } })).toBe(0);
    expect((await asg.getAssignment(head, a1.id)).students.length).toBe(3);
    expect(await code(asg.getAssignment(tB, a1.id))).toBe("NOT_FOUND");
    expect(await code(asg.getAssignment(tNone, a1.id))).toBe("NOT_FOUND");
    expect(await code(asg.getAssignment(accountant, a1.id))).toBe("FORBIDDEN");
  });

  it("only the student of that class hands in work; empty hand-ins and parents are refused", async () => {
    expect(await code(asg.submitWork(parentA, a1.id, { text: "mine" }))).toBe("FORBIDDEN");
    expect(await code(asg.submitWork(tA, a1.id, { text: "mine" }))).toBe("FORBIDDEN");
    expect(await code(asg.submitWork(studentB, a1.id, { text: "mine" }))).toBe("NOT_FOUND"); // other stream
    expect(await code(asg.submitWork(studentA, a1.id, { text: "  " }))).toBe("VALIDATION");
    const r = await asg.submitWork(studentA, a1.id, { text: "42 apples" });
    expect(r).toMatchObject({ late: false, revision: 1 });
  });

  it("marks stay private until released; a marked piece of work is locked; scores are validated", async () => {
    const sid = kidsA[0]!.id;
    expect(await code(asg.gradeSubmission(tNone, a1.id, sid, { decision: "GRADE", score: "10" }))).toBe("FORBIDDEN");
    expect(await code(asg.gradeSubmission(head, a1.id, sid, { decision: "GRADE", score: "10" }))).toBe("FORBIDDEN"); // oversight, no marking
    expect(await code(asg.gradeSubmission(tA, a1.id, sid, { decision: "GRADE", score: "25" }))).toBe("VALIDATION");
    expect(await code(asg.gradeSubmission(tA, a1.id, sid, { decision: "GRADE", score: "-1" }))).toBe("VALIDATION");
    expect(await code(asg.gradeSubmission(tA, a1.id, sid, { decision: "GRADE" }))).toBe("VALIDATION");
    expect(await code(asg.gradeSubmission(tA, a1.id, kidsA[1]!.id, { decision: "GRADE", score: "5" }))).toBe("NOT_FOUND"); // nothing handed in
    await asg.gradeSubmission(tA, a1.id, sid, { decision: "GRADE", score: "15.5", feedback: "Good counting" });
    const hidden = (await asg.getChildAssignment(parentA, sid, a1.id)).submission!;
    expect(hidden).toMatchObject({ released: false, score: null, feedback: null, state: "SUBMITTED" });
    expect(await code(asg.submitWork(studentA, a1.id, { text: "changed my mind" }))).toBe("CONFLICT");
    expect(await asg.releaseResults(tA, a1.id)).toBe(1);
    const shown = (await asg.getChildAssignment(parentA, sid, a1.id)).submission!;
    expect(shown).toMatchObject({ released: true, score: 15.5, feedback: "Good counting", state: "GRADED" });
    expect(await asg.releaseResults(tA, a1.id)).toBe(0);
  });

  it("returning for revision shows the note, then a resubmission replaces the answer", async () => {
    const a2 = await asg.createAssignment(tA, { ...base(), title: "Revision work" });
    await asg.publishAssignment(tA, a2.id);
    await asg.submitWork(studentA, a2.id, { text: "first try" });
    const sid = kidsA[0]!.id;
    expect(await code(asg.gradeSubmission(tA, a2.id, sid, { decision: "RETURN" }))).toBe("VALIDATION");
    await asg.gradeSubmission(tA, a2.id, sid, { decision: "RETURN", feedback: "Show your working" });
    expect((await asg.getChildAssignment(studentA, sid, a2.id)).submission).toMatchObject({ state: "RETURNED", feedback: "Show your working" });
    const r = await asg.submitWork(studentA, a2.id, { text: "second try with working" });
    expect(r.revision).toBe(2);
    expect((await asg.getChildAssignment(studentA, sid, a2.id)).submission).toMatchObject({ state: "SUBMITTED", text: "second try with working", score: null });
  });

  it("late work is flagged, and moving the deadline recalculates it", async () => {
    const a3 = await asg.createAssignment(tA, { ...base(), title: "Late test" });
    await asg.publishAssignment(tA, a3.id);
    await db.assignment.update({ where: { id: a3.id }, data: { dueAt: new Date(Date.now() - 3600_000) } }); // time passes
    expect((await asg.submitWork(studentA, a3.id, { text: "slow" })).late).toBe(true);
    await asg.updateAssignment(tA, a3.id, { title: "Late test", instructions: "Do page 4", dueAt: tomorrow(), maxScore: "20" });
    expect((await db.assignmentSubmission.findFirstOrThrow({ where: { assignmentId: a3.id } })).late).toBe(false);
  });

  it("paper work is recorded by the teacher for students on the roster only, once", async () => {
    const sid = kidsA[2]!.id;
    await asg.recordPaper(tA, a1.id, sid, { note: "Handed in a notebook" });
    expect(await code(asg.recordPaper(tA, a1.id, sid))).toBe("CONFLICT");
    expect(await code(asg.recordPaper(tA, a1.id, kidB.id))).toBe("NOT_FOUND");
    expect(await code(asg.recordPaper(tNone, a1.id, kidsA[1]!.id))).toBe("FORBIDDEN");
    await asg.gradeSubmission(tA, a1.id, sid, { decision: "GRADE", score: "18", release: "on" });
    const row = (await asg.getAssignment(tA, a1.id)).students.find((s) => s.studentId === sid)!;
    expect(row.submission).toMatchObject({ via: "PAPER", state: "GRADED", score: 18, released: true });
  });

  it("an assignment without a score takes feedback only; closing stops hand-ins; reopening allows them", async () => {
    const a4 = await asg.createAssignment(tA, { ...base(), title: "Reading", maxScore: "" });
    await asg.publishAssignment(tA, a4.id);
    await asg.submitWork(studentA, a4.id, { text: "read it" });
    expect(await code(asg.gradeSubmission(tA, a4.id, kidsA[0]!.id, { decision: "GRADE", score: "5" }))).toBe("VALIDATION");
    await asg.gradeSubmission(tA, a4.id, kidsA[0]!.id, { decision: "GRADE", feedback: "Well read" });
    await asg.closeAssignment(tA, a4.id);
    const a5 = await asg.createAssignment(tA, { ...base(), title: "Closing test" });
    await asg.publishAssignment(tA, a5.id);
    await asg.closeAssignment(tA, a5.id);
    expect(await code(asg.submitWork(studentA, a5.id, { text: "too late" }))).toBe("CONFLICT");
    await asg.reopenAssignment(tA, a5.id);
    await asg.submitWork(studentA, a5.id, { text: "now ok" });
  });

  it("only an untouched draft can be deleted; max score is frozen once work is marked", async () => {
    const d = await asg.createAssignment(tA, { ...base(), title: "Draft to delete" });
    await asg.deleteAssignment(tA, d.id);
    expect(await db.assignment.count({ where: { id: d.id } })).toBe(0);
    expect(await code(asg.deleteAssignment(tA, a1.id))).toBe("CONFLICT");
    expect(await code(asg.updateAssignment(tA, a1.id, { title: "x", instructions: "y", dueAt: tomorrow(), maxScore: "50" }))).toBe("CONFLICT");
  });

  it("another school cannot see any of it", async () => {
    const other = await createTestSchool("Other School");
    const t = (await createTestUser(other.id, ["class_teacher"])).ctx;
    expect(await code(asg.getAssignment(t, a1.id))).toBe("NOT_FOUND");
    expect(await code(asg.publishAssignment(t, a1.id))).toBe("NOT_FOUND");
    expect((await asg.listAssignments(t)).length).toBe(0);
  });

  it("lists show each teacher only their own classes and counts", async () => {
    const rows = await asg.listAssignments(tA);
    expect(rows.find((r) => r.id === a1.id)).toMatchObject({ roster: 3, handedIn: 2, marked: 2, state: "OPEN" });
    expect(await asg.listAssignments(tB)).toHaveLength(0);
    expect((await asg.listAssignments(head)).length).toBeGreaterThanOrEqual(rows.length);
  });
});

// ───────────────────────── Attachments ─────────────────────────

describe("attachments", () => {
  let a: { id: string };
  let subId: string;
  let worksheetId: string, workId: string;

  it("teachers attach worksheets; only PDF/JPEG/PNG/WebP are accepted", async () => {
    a = await asg.createAssignment(tA, { classId: setup.cls.id, streamId: streamA.id, subjectId: math.id, title: "With files", instructions: "See sheet", dueAt: tomorrow(), maxScore: "10" });
    expect(await code(asg.attachToAssignment(tA, a.id, { fileName: "notes.txt", bytes: TEXTFILE }))).toBe("VALIDATION");
    expect(await code(asg.attachToAssignment(tA, a.id, { fileName: "empty.png", bytes: Buffer.alloc(0) }))).toBe("VALIDATION");
    expect(await code(asg.attachToAssignment(tNone, a.id, { fileName: "sheet.png", bytes: PNG }))).toBe("FORBIDDEN");
    const f = await asg.attachToAssignment(tA, a.id, { fileName: "sheet.png", bytes: PNG });
    worksheetId = f.id;
    await asg.publishAssignment(tA, a.id);
  });

  it("a student hands in a file; storage problems save nothing", async () => {
    setStorageForTests(null);
    expect(await code(asg.submitWork(studentA, a.id, { text: "with a file" }, [{ fileName: "work.png", bytes: PNG }]))).toBe("VALIDATION");
    expect(await db.assignmentSubmission.count({ where: { assignmentId: a.id } })).toBe(0);
    setStorageForTests(storage);
    expect(await code(asg.submitWork(studentA, a.id, { text: "" }, [{ fileName: "work.txt", bytes: TEXTFILE }]))).toBe("VALIDATION");
    const r = await asg.submitWork(studentA, a.id, { text: "" }, [{ fileName: "work.png", bytes: PNG }]); // a file alone is a valid answer
    subId = r.id;
    const detail = await asg.getChildAssignment(studentA, kidsA[0]!.id, a.id);
    workId = detail.submissionFiles[0]!.id;
    expect(detail.files.map((f) => f.id)).toEqual([worksheetId]);
  });

  it("files open only for people who could see the record", async () => {
    expect((await readLearningFile(studentA, worksheetId)).fileName).toBe("sheet.png");
    expect((await readLearningFile(parentA, workId)).bytes.length).toBe(PNG.length);
    expect((await readLearningFile(tA, workId)).mimeType).toBe("image/png");
    expect((await readLearningFile(head, workId)).fileName).toBe("work.png");
    for (const who of [studentB, parentB, tB, tNone, accountant]) {
      expect(await code(readLearningFile(who, workId))).toBe("NOT_FOUND");
      expect(await code(readLearningFile(who, worksheetId))).toBe("NOT_FOUND");
    }
    // a draft's worksheet is not visible to families
    const draft = await asg.createAssignment(tA, { classId: setup.cls.id, streamId: streamA.id, subjectId: math.id, title: "Draft", instructions: "x", dueAt: tomorrow() });
    const df = await asg.attachToAssignment(tA, draft.id, { fileName: "d.png", bytes: PNG });
    expect(await code(readLearningFile(studentA, df.id))).toBe("NOT_FOUND");
    expect((await readLearningFile(tA, df.id)).fileName).toBe("d.png");
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "learning_file.download", entityId: workId } })).toBeGreaterThanOrEqual(2); // staff reads are audited
  });

  it("a student removes only their own file; a record holds at most 5 files", async () => {
    expect(await code(asg.removeMySubmissionFile(studentB, workId))).toBe("NOT_FOUND");
    await asg.removeMySubmissionFile(studentA, workId);
    expect(await code(readLearningFile(studentA, workId))).toBe("NOT_FOUND");
    for (let i = 0; i < 4; i++) await asg.attachToAssignment(tA, a.id, { fileName: `s${i}.png`, bytes: PNG }); // worksheet + 4 = 5
    expect(await code(asg.attachToAssignment(tA, a.id, { fileName: "one-too-many.png", bytes: PNG }))).toBe("CONFLICT");
    await asg.removeAssignmentFile(tA, worksheetId);
    const replacement = await asg.attachToAssignment(tA, a.id, { fileName: "replacement.png", bytes: PNG });
    expect(await code(asg.removeAssignmentFile(tB, replacement.id))).toBe("FORBIDDEN");
    expect(await code(asg.removeAssignmentFile(tA, worksheetId))).toBe("NOT_FOUND"); // already removed
  });
});

// ───────────────────────── Portfolio ─────────────────────────

describe("portfolio", () => {
  let teacherItem: { id: string }, studentItem: { id: string };

  it("teachers add items for students they teach; the family sees them at once", async () => {
    teacherItem = await pf.addPortfolioItem(tA, kidsA[0]!.id, { title: "Clay model", description: "Made in art", comment: "Lovely work" });
    expect(await code(pf.addPortfolioItem(tA, kidB.id, { title: "x" }))).toBe("NOT_FOUND"); // not their student
    expect(await code(pf.addPortfolioItem(tNone, kidsA[0]!.id, { title: "x" }))).toBe("NOT_FOUND");
    expect(await code(pf.addPortfolioItem(accountant, kidsA[0]!.id, { title: "x" }))).toBe("FORBIDDEN");
    expect(await code(pf.addPortfolioItem(tA, kidsA[0]!.id, { title: "" }))).toBe("VALIDATION");
    expect((await pf.childPortfolio(parentA, kidsA[0]!.id)).items.map((i) => i.id)).toEqual([teacherItem.id]);
    expect(await code(pf.childPortfolio(parentB, kidsA[0]!.id))).toBe("NOT_FOUND");
    await pf.addPortfolioItem(head, kidB.id, { title: "Science fair" }); // school-wide staff
  });

  it("a student's own item waits for a teacher; parents never see it before it is published", async () => {
    studentItem = await pf.addMyPortfolioItem(studentA, { title: "My drawing", description: "A tree" });
    expect(await code(pf.addMyPortfolioItem(parentA, { title: "x" }))).toBe("FORBIDDEN");
    expect(await code(pf.addMyPortfolioItem(tA, { title: "x" }))).toBe("FORBIDDEN");
    expect((await pf.childPortfolio(parentA, kidsA[0]!.id)).items.map((i) => i.title)).toEqual(["Clay model"]);
    const mine = await pf.childPortfolio(studentA, kidsA[0]!.id);
    expect(mine.canAdd).toBe(true);
    expect(mine.items.find((i) => i.id === studentItem.id)!.status).toBe("PENDING");
    expect((await pf.pendingPortfolio(tA)).some((i) => i.id === studentItem.id)).toBe(true);
    expect((await pf.pendingPortfolio(tB)).some((i) => i.id === studentItem.id)).toBe(false);
    expect(await code(pf.reviewPortfolioItem(studentA, studentItem.id, { decision: "PUBLISH" }))).toBe("FORBIDDEN");
    expect(await code(pf.reviewPortfolioItem(tB, studentItem.id, { decision: "PUBLISH" }))).toBe("NOT_FOUND");
  });

  it("files on a pending item are private to the student and teachers until it is published", async () => {
    const f = await pf.attachToPortfolio(studentA, studentItem.id, { fileName: "tree.png", bytes: PNG });
    expect(await code(pf.attachToPortfolio(studentB, studentItem.id, { fileName: "x.png", bytes: PNG }))).toBe("NOT_FOUND");
    expect(await code(pf.attachToPortfolio(studentA, teacherItem.id, { fileName: "x.png", bytes: PNG }))).toBe("NOT_FOUND"); // not theirs
    expect((await readLearningFile(studentA, f.id)).fileName).toBe("tree.png");
    expect((await readLearningFile(tA, f.id)).fileName).toBe("tree.png");
    expect(await code(readLearningFile(parentA, f.id))).toBe("NOT_FOUND");
    await pf.reviewPortfolioItem(tA, studentItem.id, { decision: "PUBLISH", comment: "Well done" });
    expect((await readLearningFile(parentA, f.id)).fileName).toBe("tree.png");
    expect(await code(readLearningFile(parentB, f.id))).toBe("NOT_FOUND");
    expect(await code(pf.attachToPortfolio(studentA, studentItem.id, { fileName: "y.png", bytes: PNG }))).toBe("CONFLICT"); // already reviewed
    expect(await code(pf.reviewPortfolioItem(tA, studentItem.id, { decision: "PUBLISH" }))).toBe("CONFLICT");
    expect((await pf.childPortfolio(parentA, kidsA[0]!.id)).items.map((i) => i.title).sort()).toEqual(["Clay model", "My drawing"]);
    expect(await db.inAppNotification.count({ where: { userId: parentA.userId, link: { contains: "/portfolio" } } })).toBeGreaterThanOrEqual(2);
  });

  it("removal needs a reason, hides the item from the family and its files stop opening", async () => {
    expect(await code(pf.reviewPortfolioItem(tA, teacherItem.id, { decision: "REMOVE" }))).toBe("VALIDATION");
    const f = await pf.attachToPortfolio(tA, teacherItem.id, { fileName: "clay.png", bytes: PNG });
    await pf.reviewPortfolioItem(tA, teacherItem.id, { decision: "REMOVE", comment: "Wrong student" });
    expect((await pf.childPortfolio(parentA, kidsA[0]!.id)).items.map((i) => i.title)).toEqual(["My drawing"]);
    expect(await code(readLearningFile(parentA, f.id))).toBe("NOT_FOUND");
    expect(await code(readLearningFile(tA, f.id))).toBe("NOT_FOUND");
    expect((await pf.studentPortfolio(tA, kidsA[0]!.id)).items.some((i) => i.id === teacherItem.id)).toBe(false);
    expect(await code(pf.studentPortfolio(tB, kidsA[0]!.id))).toBe("NOT_FOUND");
  });
});

// ───────────────────────── Behaviour ─────────────────────────

describe("behaviour records", () => {
  let praise: { id: string }, concern: { id: string };
  const rec = (extra: Record<string, unknown> = {}) => ({ studentId: kidsA[0]!.id, occurredOn: setup.today, type: "POSITIVE", category: "Helping others", description: "Helped a classmate with reading", ...extra });

  it("teachers record for students they teach; future dates and other students are refused", async () => {
    praise = await bh.recordBehaviour(tA, rec());
    concern = await bh.recordBehaviour(tA, rec({ type: "CONCERN", category: "Late to class", description: "Late three days this week" }));
    expect(await code(bh.recordBehaviour(tA, rec({ studentId: kidB.id })))).toBe("NOT_FOUND");
    expect(await code(bh.recordBehaviour(tNone, rec()))).toBe("NOT_FOUND");
    expect(await code(bh.recordBehaviour(accountant, rec()))).toBe("FORBIDDEN");
    expect(await code(bh.recordBehaviour(tA, rec({ occurredOn: "2999-01-01" })))).toBe("VALIDATION");
    expect(await code(bh.recordBehaviour(tA, rec({ description: "" })))).toBe("VALIDATION");
    expect(await code(bh.recordBehaviour(tA, rec({ type: "OTHER" })))).toBe("VALIDATION");
    await bh.recordBehaviour(head, rec({ studentId: kidB.id })); // school-wide
  });

  it("records are scoped: a teacher sees their own students, read_all sees everyone", async () => {
    const mineA = await bh.listBehaviour(tA);
    expect(mineA.every((r) => r.studentId !== kidB.id)).toBe(true);
    expect(mineA.map((r) => r.id)).toEqual(expect.arrayContaining([praise.id, concern.id]));
    expect((await bh.listBehaviour(tB)).some((r) => r.studentId === kidsA[0]!.id)).toBe(false);
    expect((await bh.listBehaviour(tNone)).length).toBe(0);
    const all = await bh.listBehaviour(head);
    expect(all.some((r) => r.studentId === kidB.id) && all.some((r) => r.studentId === kidsA[0]!.id)).toBe(true);
    expect(await code(bh.listBehaviour(accountant))).toBe("FORBIDDEN");
    expect((await bh.behaviourStudents(tA, "")).every((s) => s.id !== kidB.id)).toBe(true);
  });

  it("nothing reaches the family until shared; a student account sees shared positive records only", async () => {
    expect(await bh.childBehaviour(parentA, kidsA[0]!.id)).toHaveLength(0);
    await bh.setBehaviourShared(tA, praise.id, true);
    await bh.setBehaviourShared(tA, concern.id, true);
    expect((await bh.childBehaviour(parentA, kidsA[0]!.id)).map((r) => r.id).sort()).toEqual([praise.id, concern.id].sort());
    expect((await bh.childBehaviour(studentA, kidsA[0]!.id)).map((r) => r.id)).toEqual([praise.id]);
    expect(await code(bh.childBehaviour(parentB, kidsA[0]!.id))).toBe("NOT_FOUND");
    expect(await code(bh.setBehaviourShared(tNone, praise.id, false))).toBe("NOT_FOUND"); // not theirs
    const view = (await bh.childBehaviour(parentA, kidsA[0]!.id))[0]!;
    expect(Object.keys(view).sort()).toEqual(["action", "category", "description", "id", "occurredOn", "type"]); // no recorder, no internal fields
    await bh.setBehaviourShared(tA, concern.id, false);
    expect((await bh.childBehaviour(parentA, kidsA[0]!.id)).map((r) => r.id)).toEqual([praise.id]);
  });

  it("records cannot be edited or deleted, even directly in the database", async () => {
    await expect(db.behaviourRecord.update({ where: { id: praise.id }, data: { description: "Rewritten" } })).rejects.toThrow();
    await expect(db.behaviourRecord.update({ where: { id: praise.id }, data: { type: "INCIDENT" } })).rejects.toThrow();
    await expect(db.behaviourRecord.delete({ where: { id: praise.id } })).rejects.toThrow();
  });

  it("voiding needs a reason, hides it everywhere by default, and keeps the record", async () => {
    expect(await code(bh.voidBehaviour(tA, concern.id, ""))).toBe("VALIDATION");
    expect(await code(bh.voidBehaviour(tNone, concern.id, "mistake"))).toBe("NOT_FOUND");
    await bh.voidBehaviour(head, concern.id, "Recorded against the wrong student"); // read_all may void
    expect(await code(bh.voidBehaviour(tA, concern.id, "again"))).toBe("CONFLICT");
    expect(await code(bh.setBehaviourShared(tA, concern.id, true))).toBe("CONFLICT");
    expect((await bh.listBehaviour(tA)).some((r) => r.id === concern.id)).toBe(false);
    const withVoided = await bh.listBehaviour(tA, { includeVoided: true });
    expect(withVoided.find((r) => r.id === concern.id)).toMatchObject({ voided: true, voidReason: "Recorded against the wrong student" });
    expect(await db.behaviourRecord.count({ where: { id: concern.id } })).toBe(1);
  });

  it("the audit log keeps who and when, never the description", async () => {
    const logs = await db.auditLog.findMany({ where: { schoolId: school.id, entityType: "BehaviourRecord", entityId: praise.id } });
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(logs)).not.toContain("Helped a classmate");
  });
});
