import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import * as academics from "@/server/academics";
import * as exams from "@/server/exams";
import * as fees from "@/server/fees";
import * as grading from "@/server/grading";
import * as invoices from "@/server/invoices";
import * as marks from "@/server/marks";
import * as payments from "@/server/payments";
import * as students from "@/server/students";
import * as reg from "@/server/annual-registration";
import * as prog from "@/server/progression";
import * as annualFees from "@/server/annual-fees";
import { getLifecycleSettings, updateLifecycleSettings } from "@/server/lifecycle-settings";
import { studentTimeline, yearReadiness } from "@/server/year-readiness";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, registrar: AuthContext, academic: AuthContext, head: AuthContext, accountant: AuthContext, teacher: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let std2: { id: string }, std3: { id: string };
let nextYear: { id: string }, nextTerm: { id: string };
let streamA: { id: string }, streamB: { id: string };
let A: { id: string; admissionNo: string }[] = []; // stream A of Standard I: complete results
let B: { id: string; admissionNo: string }[] = []; // stream B: results not finalized
let F: { id: string; admissionNo: string }[] = []; // Standard III (the final grade)
let tuition: { id: string };
let n = 400000 + Math.floor(Math.random() * 6_000_000);

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const BANDS = "A | 80 | 100 | 1\nB | 60 | 79 | 2\nC | 40 | 59 | 3\nD | 0 | 39 | 4";
const setPolicy = (c: Partial<{ requireHeadApproval: boolean; promotionMinAverage: string; feePolicy: string; previousDebtCounts: boolean }> = {}) =>
  updateLifecycleSettings(admin, {
    requireHeadApproval: c.requireHeadApproval ? "on" : "", promotionMinAverage: c.promotionMinAverage ?? "", feePolicy: c.feePolicy ?? "INFORM_ONLY", previousDebtCounts: c.previousDebtCounts ? "on" : "",
  });
const decide = async (ctx: AuthContext, studentId: string, outcome: string, extra: Record<string, unknown> = {}) =>
  (await prog.decideProgressions(ctx, { yearId: setup.year.id, studentIds: [studentId], outcome, ...extra }))[0]!;
const live = (studentId: string) => db.studentProgression.findFirstOrThrow({ where: { studentId, fromAcademicYearId: setup.year.id, status: { not: "SUPERSEDED" } } });
const approve = async (ctx: AuthContext, studentId: string) => (await prog.approveProgressions(ctx, { ids: [(await live(studentId)).id] }))[0]!;
const regOf = (studentId: string) => db.annualRegistration.findUniqueOrThrow({ where: { studentId_academicYearId: { studentId, academicYearId: nextYear.id } } });
const placeFor = async (ctx: AuthContext, studentId: string, classId: string, extra: Record<string, unknown> = {}) => reg.placeReturning(ctx, { ...extra, classId, registrationId: (await regOf(studentId)).id });
const confirm = async (ctx: AuthContext, studentId: string) => reg.confirmRegistration(ctx, { registrationId: (await regOf(studentId)).id, confirmed: "on" });
const nextInvoice = (studentId: string) => db.invoice.findFirstOrThrow({ where: { studentId, academicYearId: nextYear.id } });

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  academic = (await createTestUser(school.id, ["academic_office"])).ctx;
  head = (await createTestUser(school.id, ["head_teacher"])).ctx;
  accountant = (await createTestUser(school.id, ["accountant"])).ctx;
  teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: ["A", "B"] });
  streamA = setup.streams[0]!; streamB = setup.streams[1]!;
  std2 = await academics.createClass(admin, { levelId: setup.level.id, name: "Standard II", sortOrder: 2, capacity: "2" });
  std3 = await academics.createClass(admin, { levelId: setup.level.id, name: "Standard III", sortOrder: 3, nextGrade: "FINAL" });
  const y = setup.yearNo + 1;
  nextYear = await academics.createAcademicYear(admin, { name: `${y}`, startsOn: `${y}-01-01`, endsOn: `${y}-12-31`, registrationOpensOn: `${y - 1}-11-01`, registrationClosesOn: `${y}-01-31` });
  nextTerm = await academics.createTerm(admin, { academicYearId: nextYear.id, name: "Term 1", sequence: 1, startsOn: `${y}-01-05`, endsOn: `${y}-12-20` });

  for (let i = 0; i < 6; i++) A.push(await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: streamA.id })));
  for (let i = 0; i < 2; i++) B.push(await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: streamB.id })));
  for (let i = 0; i < 2; i++) F.push(await students.createStudent(registrar, studentInput(++n, { classId: std3.id })));

  // One finalized examination for stream A; stream B is left unfinished on purpose.
  await grading.createScale(admin, { name: "Scale", bands: BANDS, isDefault: "on", passMark: "40" });
  const math = await academics.createSubject(admin, { code: "MATH", name: "Mathematics" });
  await academics.setClassSubjects(admin, setup.cls.id, [math.id]);
  const exam = await exams.createExam(admin, { termId: setup.term.id, name: "End of year", category: "ANNUAL", maxMarks: "100", weight: "100" });
  await exams.addExamSubjects(admin, exam.id, { classIds: [setup.cls.id] });
  const units = await marks.listSubmissions(admin, { examId: exam.id });
  const unitA = units.find((u) => u.streamName === "A")!;
  const scores = [90, 70, 30, 80, 65, 55];
  await marks.saveMarks(admin, unitA.id, { entries: A.map((s, i) => ({ studentId: s.id, score: scores[i]! })) });
  await marks.submitMarks(admin, unitA.id);
  await marks.approveMarks(admin, unitA.id);
  await marks.lockMarks(admin, unitA.id);

  tuition = await fees.createFeeItem(accountant, { name: "Tuition", category: "TUITION" });
  const line = (amount: string) => [{ feeItemId: tuition.id, amount, termSequence: null }];
  await fees.createStructure(accountant, { academicYearId: setup.year.id, name: "Std I now", classId: setup.cls.id, lines: line("100000") });
  await fees.createStructure(accountant, { academicYearId: nextYear.id, name: "Std I next", classId: setup.cls.id, lines: line("200000") });
  await fees.createStructure(accountant, { academicYearId: nextYear.id, name: "Std II next", classId: std2.id, lines: line("200000") });
  await invoices.generateTermInvoices(accountant, { termId: setup.term.id, dueDate: `${setup.yearNo}-12-31` });
});

describe("A. grades and the decision rules (nothing is decided by the system)", () => {
  it("knows the grade order and the final grade", async () => {
    const board = await prog.progressionBoard(academic, { yearId: setup.year.id });
    const row = board.rows.find((r) => r.studentId === A[0]!.id)!;
    expect(row.suggested).toMatchObject({ className: "Standard II" });
    expect(board.rows.find((r) => r.studentId === F[0]!.id)!.suggested).toEqual({ final: true });
    expect(row.completion.state).toBe("COMPLETE");
    expect(board.rows.find((r) => r.studentId === B[0]!.id)!.completion.state).toBe("INCOMPLETE");
  });

  it("with no promotion average set, preparing drafts decides nobody", async () => {
    const r = await prog.prepareProgressions(academic, { yearId: setup.year.id, classId: setup.cls.id, streamId: streamA.id });
    expect(r).toMatchObject({ created: 6, promoted: 0, review: 6 });
    const drafts = await db.studentProgression.findMany({ where: { schoolId: school.id, studentId: { in: A.map((s) => s.id) } } });
    expect(drafts.every((d) => d.outcome === "PENDING_REVIEW" && d.status === "DRAFT")).toBe(true);
    expect((await prog.prepareProgressions(academic, { yearId: setup.year.id, classId: setup.cls.id, streamId: streamA.id })).created).toBe(0); // idempotent
  });

  it("only the Academic Office side can decide; teachers and Admissions cannot", async () => {
    expect(await code(prog.progressionBoard(teacher, { yearId: setup.year.id }))).toBe("FORBIDDEN");
    expect(await code(prog.decideProgressions(registrar, { yearId: setup.year.id, studentIds: [A[0]!.id], outcome: "PROMOTED" }))).toBe("FORBIDDEN");
    expect(await code(prog.decideProgressions(accountant, { yearId: setup.year.id, studentIds: [A[0]!.id], outcome: "PROMOTED" }))).toBe("FORBIDDEN");
  });

  it("promotes, repeats and records the grade; a final-grade student cannot be 'promoted'", async () => {
    expect((await decide(academic, A[0]!.id, "PROMOTED")).ok).toBe(true);
    expect((await live(A[0]!.id)).toClassId).toBe(std2.id);
    expect((await decide(academic, A[1]!.id, "PROMOTED")).ok).toBe(true);
    expect((await decide(academic, A[2]!.id, "REPEAT")).ok).toBe(true);
    expect((await live(A[2]!.id)).toClassId).toBe(setup.cls.id);
    expect((await decide(academic, A[3]!.id, "PROMOTED")).ok).toBe(true);
    expect((await decide(academic, A[4]!.id, "PROMOTED")).ok).toBe(true);
    const notFinal = await decide(academic, A[5]!.id, "COMPLETED"); // Standard I is not the last grade: an exception
    expect(notFinal.ok).toBe(false);
    expect(notFinal.message).toMatch(/final grade|exception/i);
    expect((await decide(academic, A[5]!.id, "REPEAT")).ok).toBe(true);
    const bad = await decide(academic, F[0]!.id, "PROMOTED");
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/final grade/i);
    // Admissions cannot approve a decision
    expect((await prog.approveProgressions(registrar, { ids: [(await live(A[0]!.id)).id] }))[0]!.ok).toBe(false);
    expect((await live(A[0]!.id)).status).toBe("DRAFT");
  });

  it("a grade outside the school's order, or incomplete results, is an exception: permission and reason required", async () => {
    const skip = await decide(academic, A[4]!.id, "PROMOTED", { toClassId: std3.id });
    expect(skip.ok).toBe(false);
    expect(skip.message).toMatch(/exception/i);
    const noReason = await decide(head, A[4]!.id, "PROMOTED", { toClassId: std3.id });
    expect(noReason.ok).toBe(false);
    expect((await decide(head, A[4]!.id, "PROMOTED", { toClassId: std3.id, exceptionReason: "Advanced for age" })).ok).toBe(true);
    expect((await live(A[4]!.id)).exceptionReason).toContain("Advanced for age");
    // put it back to the normal grade for the rest of the tests
    expect((await decide(academic, A[4]!.id, "REPEAT")).ok).toBe(true);

    // C. incomplete results: only as a recorded exception
    const incomplete = await decide(academic, B[0]!.id, "PROMOTED");
    expect(incomplete.ok).toBe(false);
    expect(incomplete.message).toMatch(/not complete|exception/i);
    expect((await decide(academic, B[0]!.id, "PENDING_REVIEW", { note: "Waiting for the mathematics results" })).ok).toBe(true);
    expect((await decide(academic, B[1]!.id, "PENDING_REVIEW")).ok).toBe(true);
    const approvePending = await approve(academic, B[0]!.id);
    expect(approvePending.ok).toBe(false);
    expect(approvePending.message).toMatch(/pending review/i);
  });

  it("leaving needs a reason; completing the final grade needs no exception", async () => {
    expect((await decide(academic, F[1]!.id, "WITHDRAWN")).ok).toBe(false);
    expect((await decide(academic, F[1]!.id, "TRANSFERRED", { note: "Family moved to Arusha" })).ok).toBe(true);
    expect((await decide(academic, F[0]!.id, "COMPLETED")).ok).toBe(false); // no examinations recorded for the class: an exception
    expect((await decide(head, F[0]!.id, "COMPLETED", { exceptionReason: "Class sat the national examination" })).ok).toBe(true);
  });
});

describe("B. approval, the Head Teacher, and revision", () => {
  it("approval makes a decision final and creates the returning-student record for the next year", async () => {
    expect((await decide(academic, A[0]!.id, "PROMOTED")).ok).toBe(true);
    await setPolicy({ requireHeadApproval: true });
    const first = await approve(academic, A[0]!.id);
    expect(first).toMatchObject({ ok: true, status: "AWAITING_HEAD" });
    expect((await live(A[0]!.id)).approvedById).toBe(academic.userId);
    expect(await regOf(A[0]!.id).catch(() => null)).toBeNull(); // not final yet: no registration record
    const academicAgain = await approve(academic, A[0]!.id);
    expect(academicAgain.ok).toBe(false); // the Academic Office cannot give the Head Teacher's approval
    const done = await approve(head, A[0]!.id);
    expect(done).toMatchObject({ ok: true, status: "APPROVED" });
    const p = await live(A[0]!.id);
    expect(p).toMatchObject({ status: "APPROVED", headApprovedById: head.userId });
    const r = await regOf(A[0]!.id);
    expect(r).toMatchObject({ status: "PENDING", progressionId: p.id, classId: null });
    expect((await db.workflowTask.findFirstOrThrow({ where: { schoolId: school.id, kind: "RETURNING_PLACEMENT", relatedId: r.id } })).department).toBe("ADMISSIONS");
    // the student record and Student ID are the same ones: no new student, no new application
    expect(await db.student.count({ where: { schoolId: school.id } })).toBe(A.length + B.length + F.length);
    expect(await db.application.count({ where: { schoolId: school.id } })).toBe(0);
  });

  it("an approved decision cannot be edited; two approvals at once give one registration", async () => {
    expect((await decide(academic, A[0]!.id, "REPEAT")).message).toMatch(/already has an approved decision/i);
    await expect(db.studentProgression.update({ where: { id: (await live(A[0]!.id)).id }, data: { outcome: "REPEAT" } })).rejects.toThrow();
    await setPolicy({}); // no Head Teacher approval from here on
    for (const s of [A[1]!, A[3]!]) expect((await decide(academic, s.id, "PROMOTED")).ok).toBe(true);
    expect((await decide(academic, A[2]!.id, "REPEAT")).ok).toBe(true);
    const id = (await live(A[1]!.id)).id;
    const both = await Promise.all([prog.approveProgressions(academic, { ids: [id] }), prog.approveProgressions(head, { ids: [id] })]);
    expect(both.flat().filter((x) => x.ok)).toHaveLength(1);
    expect(await db.annualRegistration.count({ where: { studentId: A[1]!.id } })).toBe(1);
    expect((await approve(academic, A[3]!.id)).ok).toBe(true);
    expect((await approve(academic, A[2]!.id)).ok).toBe(true);
    expect((await approve(academic, A[5]!.id)).ok).toBe(true);
    expect((await regOf(A[2]!.id)).progressionId).toBe((await live(A[2]!.id)).id); // repeat: back to the same grade
  });

  it("a revision needs the exception permission and a reason, keeps the old decision, and re-links the registration", async () => {
    expect((await decide(academic, A[4]!.id, "PROMOTED")).ok).toBe(true);
    expect((await approve(academic, A[4]!.id)).ok).toBe(true);
    const old = await live(A[4]!.id);
    expect(old.outcome).toBe("PROMOTED");
    expect(await code(prog.reviseProgression(academic, { id: old.id, outcome: "REPEAT", exceptionReason: "Changed" }))).toBe("FORBIDDEN");
    expect(await code(prog.reviseProgression(head, { id: old.id, outcome: "REPEAT" }))).toBe("VALIDATION"); // no reason
    const revised = await prog.reviseProgression(head, { id: old.id, outcome: "REPEAT", exceptionReason: "Parents asked for another year" });
    expect((await db.studentProgression.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("SUPERSEDED"); // kept for the history
    expect((await db.studentProgression.findUniqueOrThrow({ where: { id: revised.id } })).status).toBe("DRAFT");
    expect((await approve(academic, A[4]!.id)).ok).toBe(true);
    expect((await regOf(A[4]!.id)).progressionId).toBe(revised.id);
    expect(await db.annualRegistration.count({ where: { studentId: A[4]!.id } })).toBe(1);
    expect(await db.studentProgression.count({ where: { studentId: A[4]!.id } })).toBe(2);
  });

  it("completing school and leaving close the enrolment through the normal status change", async () => {
    expect((await approve(academic, F[0]!.id)).ok).toBe(true);
    expect((await approve(academic, F[1]!.id)).ok).toBe(true);
    expect((await db.student.findUniqueOrThrow({ where: { id: F[0]!.id } })).status).toBe("GRADUATED");
    expect((await db.student.findUniqueOrThrow({ where: { id: F[1]!.id } })).status).toBe("TRANSFERRED");
    const e = await db.studentEnrollment.findFirstOrThrow({ where: { studentId: F[0]!.id } });
    expect(e.status).toBe("COMPLETED");
    expect(await db.annualRegistration.count({ where: { studentId: { in: F.map((s) => s.id) } } })).toBe(0); // nobody returns
    expect(await code(prog.reviseProgression(head, { id: (await live(F[0]!.id)).id, outcome: "REPEAT", exceptionReason: "x" }))).toBe("CONFLICT");
  });
});

describe("C. placement by Admissions: stream, capacity, grade", () => {
  it("lists the returning students for Admissions with the next action", async () => {
    const board = await reg.returningBoard(registrar, { yearId: nextYear.id });
    expect(board.counts.total).toBe(6);
    expect(board.rows.every((r) => r.stage === "NEEDS_PLACEMENT" && r.department === "ADMISSIONS")).toBe(true);
    expect(board.missing).toBe(0);
  });

  it("needs a stream where the class has streams, and the decided grade unless an academic exception is recorded", async () => {
    expect(await code(placeFor(registrar, A[2]!.id, setup.cls.id))).toBe("VALIDATION"); // Standard I has streams
    expect(await code(placeFor(registrar, A[2]!.id, std2.id))).toBe("FORBIDDEN"); // decided: repeat Standard I
    expect(await code(placeFor(academic, A[2]!.id, std2.id))).toBe("FORBIDDEN"); // the Academic Office does not place students
    await placeFor(registrar, A[2]!.id, setup.cls.id, { streamId: streamB.id });
    expect(await regOf(A[2]!.id)).toMatchObject({ classId: setup.cls.id, streamId: streamB.id, status: "PENDING" });
  });

  it("recommends the emptiest stream", async () => {
    const places = await reg.classPlaces(db, school.id, nextYear.id);
    const c = places.get(setup.cls.id)!;
    expect(c.streams.find((s) => s.id === streamB.id)!.count).toBe(1);
    expect(c.recommendedStreamId).toBe(streamA.id);
    await placeFor(registrar, A[5]!.id, setup.cls.id, { streamId: streamA.id });
  });

  it("two people filling the last place at once: exactly one succeeds", async () => {
    await placeFor(registrar, A[0]!.id, std2.id);
    const r = await Promise.all([placeFor(registrar, A[1]!.id, std2.id), placeFor(registrar, A[3]!.id, std2.id)].map((p) => code(p)));
    expect(r.filter((x) => x === null)).toHaveLength(1);
    expect(r.filter((x) => x === "CONFLICT")).toHaveLength(1);
    const places = (await reg.classPlaces(db, school.id, nextYear.id)).get(std2.id)!;
    expect(places).toMatchObject({ capacity: 2, reserved: 2, left: 0 });
  });

  it("a full class needs the override permission and a reason", async () => {
    const loserId = (await regOf(A[1]!.id)).classId ? A[3]!.id : A[1]!.id;
    expect(await code(placeFor(registrar, loserId, std2.id, { overrideCapacity: "on", overrideReason: "Sibling" }))).toBe("FORBIDDEN");
    expect(await code(placeFor(admin, loserId, std2.id, { overrideCapacity: "on" }))).toBe("VALIDATION");
    await placeFor(admin, loserId, std2.id, { overrideCapacity: "on", overrideReason: "Sibling of a current pupil" });
    expect((await regOf(loserId)).capacityOverrideReason).toContain("Sibling");
    // places promised to returning students count against a new admission in the same class
    const newcomer = await students.createStudent(registrar, studentInput(++n, { classId: std3.id }));
    expect(await code(students.enrollStudent(registrar, newcomer.id, { classId: std2.id, academicYearId: nextYear.id }))).toBe("CONFLICT");
  });

  it("the lifecycle is permission-gated: Finance cannot place, Admissions cannot approve exceptions", async () => {
    expect(await code(placeFor(accountant, A[0]!.id, std2.id))).toBe("FORBIDDEN");
    expect(await code(reg.setClearanceException(registrar, { registrationId: (await regOf(A[0]!.id)).id, reason: "x" }))).toBe("FORBIDDEN");
  });
});

describe("D. annual registration and fee clearance (separate from the academic decision)", () => {
  it("Admissions sees clearance but no amounts; Finance sees the amounts", async () => {
    await reg.confirmRegistration(registrar, { registrationId: (await regOf(A[0]!.id)).id, confirmed: "on" }); // before any bill exists
    const bill = await annualFees.billReturningStudents(accountant, { yearId: nextYear.id, dueDate: `${setup.yearNo + 1}-03-31` });
    expect(bill.created).toBe(5); // A0, A1, A3 (Standard II), A2 and A5 (Standard I); A4 is not placed yet
    const asRegistrar = await reg.returningBoard(registrar, { yearId: nextYear.id });
    const row = asRegistrar.rows.find((r) => r.studentId === A[0]!.id)!;
    expect(row.firstTermOutstanding).toBeNull();
    expect(row.clearance).toBe("OUTSTANDING");
    const asFinance = await annualFees.annualFeeBoard(accountant, { yearId: nextYear.id });
    const f = asFinance.rows.find((r) => r.studentId === A[0]!.id)!;
    expect(f.firstTerm).toMatchObject({ billed: true, charged: 20_000_000, outstanding: 20_000_000 });
    expect(await code(annualFees.annualFeeBoard(registrar, { yearId: nextYear.id }))).toBe("FORBIDDEN");
    expect(asFinance.rows.find((r) => r.studentId === A[4]!.id)?.state).toBe("NOT_BILLED");
  });

  it("billing again does not bill twice", async () => {
    const again = await annualFees.billReturningStudents(accountant, { yearId: nextYear.id, dueDate: `${setup.yearNo + 1}-03-31` });
    expect(again.created).toBe(0);
    expect(await db.invoice.count({ where: { schoolId: school.id, academicYearId: nextYear.id } })).toBe(5);
  });

  it("D. paid students are cleared; the money goes to the year it was meant for", async () => {
    // A1 pays both years; A0 pays only the new year's invoice and keeps owing the old year
    await payments.recordPayment(accountant, { studentId: A[1]!.id, amount: "300000", method: "CASH" });
    await payments.recordPayment(accountant, { studentId: A[0]!.id, amount: "200000", method: "CASH", targetInvoiceId: (await nextInvoice(A[0]!.id)).id });
    const b = await annualFees.annualFeeBoard(accountant, { yearId: nextYear.id });
    const a1 = b.rows.find((r) => r.studentId === A[1]!.id)!;
    expect(a1.state).toBe("CLEARED");
    expect(a1.previousOutstanding).toBe(0);
    const a0 = b.rows.find((r) => r.studentId === A[0]!.id)!;
    expect(a0.firstTerm.outstanding).toBe(0);
    expect(a0.previousOutstanding).toBe(10_000_000); // the old year's debt is shown on its own, never merged into the year's figures
    expect(a0.previous[0]!.yearName).toBe(`${setup.yearNo}`);
    expect(a0.year.outstanding).toBe(0);
    expect(a0.state).toBe("CLEARED"); // the school's setting: older debt does not count
  });

  it("H. the school may count older debt; it still never changes a decision", async () => {
    await setPolicy({ previousDebtCounts: true });
    const b = await annualFees.annualFeeBoard(accountant, { yearId: nextYear.id });
    expect(b.rows.find((r) => r.studentId === A[0]!.id)!.state).toBe("OUTSTANDING");
    expect(b.rows.find((r) => r.studentId === A[0]!.id)!.year.outstanding).toBe(0);
    expect((await live(A[0]!.id)).status).toBe("APPROVED"); // unpaid fees never reverse a promotion
    await setPolicy({});
  });

  it("E. unpaid fees block nothing unless the school says so", async () => {
    const r = await regOf(A[3]!.id);
    expect(r.classId).not.toBeNull();
    await confirm(registrar, A[3]!.id); // owes the whole bill, the default rule only informs
    expect((await regOf(A[3]!.id)).status).toBe("REGISTERED");
    expect((await live(A[3]!.id)).status).toBe("APPROVED");
  });

  it("when the school asks for clearance, registration waits, Finance is told, and a payment opens the way", async () => {
    await setPolicy({ feePolicy: "BLOCK_REGISTRATION" });
    const r = await regOf(A[2]!.id);
    expect(await code(confirm(registrar, A[2]!.id))).toBe("CONFLICT");
    const task = await db.workflowTask.findFirstOrThrow({ where: { schoolId: school.id, kind: "RETURNING_FEE", relatedId: r.id } });
    expect(task).toMatchObject({ department: "FINANCE", status: "PENDING" });
    const stage = (await reg.returningBoard(registrar, { yearId: nextYear.id })).rows.find((x) => x.studentId === A[2]!.id)!;
    expect(stage).toMatchObject({ stage: "NEEDS_FEE", department: "FINANCE", blocked: true });
    await payments.recordPayment(accountant, { studentId: A[2]!.id, amount: "200000", method: "CASH", targetInvoiceId: (await nextInvoice(A[2]!.id)).id });
    expect((await db.workflowTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("COMPLETED"); // closed by the payment itself
    await confirm(registrar, A[2]!.id);
    expect((await regOf(A[2]!.id)).status).toBe("REGISTERED");
  });

  it("an approved arrangement, recorded by Finance with a reason, treats the condition as met without touching any balance", async () => {
    const r = await regOf(A[5]!.id);
    expect(await code(confirm(registrar, A[5]!.id))).toBe("CONFLICT");
    expect(await code(reg.setClearanceException(accountant, { registrationId: r.id }))).toBe("VALIDATION");
    await reg.setClearanceException(accountant, { registrationId: r.id, reason: "Pays in instalments, agreed with the bursar" });
    expect((await db.workflowTask.findFirstOrThrow({ where: { schoolId: school.id, kind: "RETURNING_FEE", relatedId: r.id } })).status).toBe("COMPLETED");
    await confirm(registrar, A[5]!.id);
    expect((await regOf(A[5]!.id)).status).toBe("REGISTERED");
    const f = (await annualFees.annualFeeBoard(accountant, { yearId: nextYear.id })).rows.find((x) => x.studentId === A[5]!.id)!;
    expect(f.state).toBe("CLEARED_EXCEPTION");
    expect(f.firstTerm.outstanding).toBe(20_000_000); // nothing was paid or changed
    expect(await db.payment.count({ where: { schoolId: school.id, studentId: A[5]!.id } })).toBe(0);
    await setPolicy({});
  });
});

describe("F. joining the class roster", () => {
  it("is held back until the year starts; then the student joins with the same record, the old year is kept", async () => {
    const r0 = await regOf(A[0]!.id);
    const early = await reg.activateRegistrations(registrar, [r0.id]);
    expect(early[0]).toMatchObject({ ok: false });
    expect(early[0]!.message).toMatch(/has not started/i);

    // The year rolls over: the old year ends yesterday and the new one starts today.
    const yesterday = new Date(Date.now() - 86_400_000);
    await db.academicYear.update({ where: { id: setup.year.id }, data: { endsOn: new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate())) } });
    await db.academicYear.update({ where: { id: nextYear.id }, data: { startsOn: new Date(`${setup.today}T00:00:00Z`) } });
    await academics.setCurrentAcademicYear(admin, nextYear.id);

    const before = await db.student.count({ where: { schoolId: school.id } });
    const res = await reg.activateRegistrations(registrar, [r0.id]);
    expect(res[0]).toMatchObject({ ok: true });
    const after = await regOf(A[0]!.id);
    expect(after.status).toBe("ACTIVE");
    const e = await db.studentEnrollment.findUniqueOrThrow({ where: { id: after.enrollmentId! } });
    expect(e).toMatchObject({ academicYearId: nextYear.id, classId: std2.id, status: "ACTIVE" });
    const history = await db.studentEnrollment.findMany({ where: { studentId: A[0]!.id }, orderBy: { startedOn: "asc" } });
    expect(history.map((h) => [h.classId === setup.cls.id ? "I" : "II", h.status])).toEqual([["I", "COMPLETED"], ["II", "ACTIVE"]]); // history kept
    expect(await db.student.count({ where: { schoolId: school.id } })).toBe(before); // same record, same Student ID
    expect((await db.mark.findFirst({ where: { studentId: A[0]!.id, status: "SCORED" } }))?.lockedPercent).not.toBeNull(); // last year's results are untouched
    expect((await reg.activateRegistrations(registrar, [r0.id]))[0]).toMatchObject({ ok: false }); // twice does nothing
    expect((await reg.classPlaces(db, school.id, nextYear.id)).get(std2.id)!).toMatchObject({ inClass: 1 });
  });

  it("someone who has not been registered cannot join the roster", async () => {
    const r4 = await regOf(A[4]!.id);
    const res = await reg.activateRegistrations(registrar, [r4.id]);
    expect(res[0]!.ok).toBe(false);
    expect(res[0]!.message).toMatch(/register the student first/i);
  });

  it("a registration can be cancelled with a reason and opened again", async () => {
    const r4 = await regOf(A[4]!.id);
    expect(await code(reg.cancelRegistration(registrar, { registrationId: r4.id }))).toBe("VALIDATION");
    await reg.cancelRegistration(registrar, { registrationId: r4.id, reason: "Family is leaving the area" });
    expect((await regOf(A[4]!.id)).status).toBe("CANCELLED");
    await reg.reopenRegistration(registrar, { registrationId: r4.id });
    expect((await regOf(A[4]!.id)).status).toBe("PENDING");
    await expect(db.annualRegistration.delete({ where: { id: r4.id } })).rejects.toThrow();
  });
});

describe("G. the whole story of one student, and the year checklist", () => {
  it("shows every year of one student in one timeline", async () => {
    const t = await studentTimeline(academic, A[0]!.id);
    expect(t.map((x) => x.kind)).toEqual(expect.arrayContaining(["ENROLMENT", "DECISION", "REGISTRATION"]));
    expect(t.filter((x) => x.kind === "ENROLMENT")).toHaveLength(2);
  });

  it("the new-year checklist reports what is not ready", async () => {
    const r = await yearReadiness(academic, nextYear.id);
    expect(r.year?.id).toBe(nextYear.id);
    const by = Object.fromEntries(r.checks.map((c) => [c.key, c]));
    expect(by.terms!.ok).toBe(true);
    expect(by.fees!.ok).toBe(true);
    expect(by.dates!.ok).toBe(true);
    expect(by.review!.ok).toBe(false); // two students are still "pending review"
    expect(r.ready).toBe(false);
  });

  it("settings are saved and audited", async () => {
    await setPolicy({ requireHeadApproval: true, promotionMinAverage: "55", feePolicy: "BLOCK_ACTIVATION" });
    expect(await getLifecycleSettings(db, school.id)).toEqual({ requireHeadApproval: true, promotionMinAverage: 55, feePolicy: "BLOCK_ACTIVATION", previousDebtCounts: false });
    expect(await code(updateLifecycleSettings(academic, { feePolicy: "INFORM_ONLY" }))).toBe("FORBIDDEN");
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "settings.year_lifecycle_update" } })).toBeGreaterThan(1);
    await setPolicy({});
  });
});
