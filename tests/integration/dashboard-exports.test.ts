import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import * as academics from "@/server/academics";
import * as students from "@/server/students";
import * as fees from "@/server/fees";
import * as invoices from "@/server/invoices";
import * as payments from "@/server/payments";
import * as grading from "@/server/grading";
import * as exams from "@/server/exams";
import * as marks from "@/server/marks";
import { getDashboard } from "@/server/dashboard";
import { financeTable, resultsTable, studentsTable, attendanceTable } from "@/server/exports";
import { respondTable } from "@/server/export-response";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, head: AuthContext, accountant: AuthContext, registrar: AuthContext, teacherA: AuthContext, teacherB: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let kids: { id: string; admissionNo: string }[] = [];
let n = 600000 + Math.floor(Math.random() * 4_000_000);
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  head = (await createTestUser(school.id, ["head_teacher"])).ctx;
  accountant = (await createTestUser(school.id, ["accountant"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  teacherA = (await createTestUser(school.id, ["subject_teacher"])).ctx;
  teacherB = (await createTestUser(school.id, ["class_teacher"])).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: ["A", "B"] });
  const [sa, sb] = setup.streams;
  const math = await academics.createSubject(admin, { code: "MATH", name: "Mathematics" });
  await academics.setClassSubjects(admin, setup.cls.id, [math.id]);
  await academics.addSubjectTeacher(admin, { academicYearId: setup.year.id, classId: setup.cls.id, streamId: sa!.id, subjectId: math.id, staffId: teacherA.staffId });
  await academics.setClassTeacher(admin, { academicYearId: setup.year.id, classId: setup.cls.id, streamId: sb!.id, staffId: teacherB.staffId });
  for (let i = 0; i < 4; i++) kids.push(await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: i < 2 ? sa!.id : sb!.id })));
  // money
  const tuition = await fees.createFeeItem(accountant, { name: "Tuition" });
  await fees.createStructure(accountant, { academicYearId: setup.year.id, name: "Fees", classId: setup.cls.id, lines: [{ feeItemId: tuition.id, amount: "100000", termSequence: null }] });
  await invoices.generateTermInvoices(accountant, { termId: setup.term.id, issueDate: `${setup.yearNo}-01-10`, dueDate: `${setup.yearNo}-02-01` });
  await payments.recordPayment(accountant, { studentId: kids[0]!.id, amount: "100000", method: "CASH" });
  await payments.recordPayment(accountant, { studentId: kids[1]!.id, amount: "30000", method: "CASH" });
  // results
  await grading.createScale(admin, { name: "S", bands: "A | 80 | 100 | 1\nB | 60 | 79 | 2\nC | 40 | 59 | 3\nD | 0 | 39 | 4", isDefault: "on" });
  const exam = await exams.createExam(head, { termId: setup.term.id, name: "Test", maxMarks: "100", weight: "100", submissionDeadline: `${setup.yearNo}-01-31` });
  await exams.addExamSubjects(head, exam.id, { classIds: [setup.cls.id] });
  const units = await marks.listSubmissions(admin, { examId: exam.id });
  const a = units.find((u) => u.streamName === "A")!;
  await marks.saveMarks(admin, a.id, { entries: [{ studentId: kids[0]!.id, score: 90 }, { studentId: kids[1]!.id, score: 55 }] });
  await marks.submitMarks(admin, a.id);
  // a refund request by the accountant waits for the head
  await payments.recordPayment(accountant, { studentId: kids[2]!.id, amount: "20000", method: "CASH" });
  await db.invoice.updateMany({ where: { schoolId: school.id, studentId: kids[2]!.id }, data: { status: "VOID", voidedAt: new Date(), voidedById: accountant.userId, voidReason: "test" } });
  await payments.requestRefund(accountant, { studentId: kids[2]!.id, amount: "5000", method: "CASH", reason: "Overpaid" });
});

describe("dashboard panels", () => {
  it("the accountant sees money, not marks", async () => {
    const d = await getDashboard(accountant);
    // 3 live invoices of 100,000 (one was voided); 100,000 + 30,000 applied to them; a further 20,000 is credit on the voided invoice's student.
    expect(d.finance).toMatchObject({ billed: 300_000_00, collected: 150_000_00, outstanding: 170_000_00, credit: 15_000_00 }); // 20,000 paid, 5,000 of it reserved for a refund request
    expect(d.finance!.ratePct).toBe(43.3);
    expect(d.finance!.topArrears.length).toBeGreaterThan(0);
    expect(d.finance!.trend).toHaveLength(30);
    expect(d.finance!.trend.reduce((s, p) => s + p.cents, 0)).toBe(150_000_00); // every posted payment in the window
    expect(d.exams).toBeNull();
    expect(d.kpis.map((k) => k.key)).toEqual(expect.arrayContaining(["collected", "outstanding"]));
    expect(d.kpis.find((k) => k.key === "collected")!.value).toBe(150_000_00);
  });
  it("the head teacher sees results progress and what waits for a decision", async () => {
    const d = await getDashboard(head);
    expect(d.exams).toMatchObject({ total: 2, overall: true, toApprove: 1, toLock: 0 });
    expect(d.exams!.byStatus).toMatchObject({ SUBMITTED: 1, DRAFT: 1 });
    expect(d.attention.find((a) => a.key === "resultsToApprove")).toMatchObject({ count: 1, href: "/marks?view=queue" });
    expect(d.attention.find((a) => a.key === "refundsPending")).toMatchObject({ count: 1 });
    expect(d.finance).not.toBeNull();
  });
  it("a teacher sees only their own mark sheets and no money", async () => {
    const d = await getDashboard(teacherB);
    expect(d.finance).toBeNull();
    expect(d.exams!.overall).toBe(false);
    expect(d.exams!.total).toBe(1); // only stream B, where they are the class teacher
    expect(d.exams!.mine).toHaveLength(1);
    expect(d.exams!.mine[0]!.streamName).toBe("B");
    expect(d.exams!.toApprove).toBe(0);
    expect(d.attention.some((a) => a.key === "refundsPending" || a.key === "unmatchedPayments")).toBe(false);
    expect(d.kpis.some((k) => k.key === "collected" || k.key === "resultsLocked")).toBe(false);
    const subject = await getDashboard(teacherA);
    expect(subject.exams!.total).toBe(1);
    expect(subject.exams!.mine).toHaveLength(0); // their sheet (stream A) is already submitted, nothing is left to enter
  });
  it("the registrar sees neither panel", async () => {
    const d = await getDashboard(registrar);
    expect(d.finance).toBeNull();
    expect(d.exams).toBeNull();
  });
});

describe("exports", () => {
  it("students: teachers get only their students, guardian contacts only with permission, each export is audited", async () => {
    const all = await studentsTable(head, {});
    expect(all.rows).toHaveLength(4);
    expect(all.columns.map((c) => c.key)).toContain("g");
    const mine = await studentsTable(teacherA, {});
    expect(mine.rows).toHaveLength(2); // the subject teacher of stream A sees stream A only
    expect(mine.columns.map((c) => c.key)).not.toContain("g"); // this role has no guardian contact permission
    expect((await studentsTable(teacherB, {})).columns.map((c) => c.key)).toContain("g"); // class teachers do
    expect(await code(studentsTable(accountant, {}).then(() => null))).toBe(null); // the accountant may read students
    const res = await respondTable(head, all, "xlsx", "students");
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toMatch(/filename="Students-\d{4}-\d{2}-\d{2}\.xlsx"/);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "export.download", entityId: "students" } })).toBe(1);
    const pdf = await respondTable(head, all, "pdf", "students");
    expect(Buffer.from((await pdf.arrayBuffer()).slice(0, 5)).toString()).toBe("%PDF-");
    const csv = await respondTable(head, all, "csv", "students");
    expect((await csv.text()).split("\n").length).toBeGreaterThan(4);
  });

  it("results: the same permission and class-teacher scope as the screen", async () => {
    const t = await resultsTable(head, { termId: setup.term.id, classId: setup.cls.id, basis: "PROVISIONAL" });
    expect(t.title).toContain(setup.cls.name);
    expect(t.subtitle).toContain("INCOMPLETE");
    expect(await code(resultsTable(registrar, { termId: setup.term.id, classId: setup.cls.id }))).toBe("FORBIDDEN");
    expect(await code(resultsTable(teacherA, { termId: setup.term.id, classId: setup.cls.id }))).toBe("FORBIDDEN"); // subject teacher: not a whole-class view
    expect((await resultsTable(teacherB, { termId: setup.term.id, classId: setup.cls.id, streamId: setup.streams[1]!.id })).rows.length).toBe(2);
    expect(await code(resultsTable(teacherB, { termId: setup.term.id, classId: setup.cls.id, streamId: setup.streams[0]!.id }))).toBe("FORBIDDEN"); // not their stream
  });

  it("attendance: scoped like the report", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const t = await attendanceTable(head, { classId: setup.cls.id, from: `${setup.yearNo}-01-01`, to: today });
    expect(t.title).toContain(setup.cls.name);
    expect(await code(attendanceTable(accountant, { classId: setup.cls.id, from: `${setup.yearNo}-01-01`, to: today }))).toBe("FORBIDDEN");
  });

  it("finance: permission per report, money in major units, spreadsheet-safe", async () => {
    const arrears = await financeTable(accountant, "arrears", {});
    expect(arrears.rows.length).toBeGreaterThan(0);
    const amountCol = arrears.columns.findIndex((c) => c.key === "out");
    expect(arrears.rows.map((r) => r[amountCol])).toContain(100000); // major units, not cents
    expect(await code(financeTable(teacherA, "arrears", {}))).toBe("FORBIDDEN");
    expect(await code(financeTable(registrar, "payments", {}))).toBe("FORBIDDEN");
    expect(await code(financeTable(head, "payments", {}).then(() => null))).toBe(null);
    const col = await financeTable(accountant, "collections", { from: `${setup.yearNo}-01-01`, to: new Date().toISOString().slice(0, 10) });
    expect(col.footnote).toContain("Collected 150000");
    expect((await financeTable(accountant, "invoices", {})).rows.length).toBe(3);
    expect((await financeTable(accountant, "payments", {})).rows.length).toBe(3);
  });
});
