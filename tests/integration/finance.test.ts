import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import * as students from "@/server/students";
import * as fees from "@/server/fees";
import * as invoices from "@/server/invoices";
import * as payments from "@/server/payments";
import * as expenses from "@/server/expenses";
import * as events from "@/server/payment-events";
import { loadStudentFinance } from "@/server/balances";
import { receiptDocument, receiptPdf } from "@/server/finance-pdf";
import { expensesReport } from "@/server/finance-reports";
import { feeSheetDocument, feeSheetPdf } from "@/server/fee-sheet";
import { signBody } from "@/lib/payments/providers";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, accountant: AuthContext, head: AuthContext, registrar: AuthContext, teacher: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let kids: { id: string; admissionNo: string }[] = [];
let tuition: { id: string }, bus: { id: string }, admission: { id: string };
let n = 200000 + Math.floor(Math.random() * 7_000_000);

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const T = 100; // cents per TZS
const tzs = (v: number) => v * T;
const dueDate = () => `${setup.yearNo}-12-31`;
const bal = async (i: number) => (await loadStudentFinance(db, school.id, kids[i]!.id)).ledger;
const pay = (i: number, amount: number | string, extra: Record<string, unknown> = {}) => payments.recordPayment(accountant, { studentId: kids[i]!.id, amount, method: "CASH", ...extra });

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  accountant = (await createTestUser(school.id, ["accountant"])).ctx;
  head = (await createTestUser(school.id, ["head_teacher"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
  setup = await createCurrentYearAcademics(admin);
  for (let i = 0; i < 4; i++) kids.push(await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id })));
});

describe("fee items and structures", () => {
  it("only fees.manage can configure; names are unique", async () => {
    expect(await code(fees.createFeeItem(teacher, { name: "X" }))).toBe("FORBIDDEN");
    expect(await code(fees.createFeeItem(registrar, { name: "X" }))).toBe("FORBIDDEN");
    tuition = await fees.createFeeItem(accountant, { name: "Tuition", category: "TUITION" });
    bus = await fees.createFeeItem(accountant, { name: "School bus", category: "TRANSPORT" });
    admission = await fees.createFeeItem(accountant, { name: "Admission", category: "ADMISSION" });
    expect(await code(fees.createFeeItem(accountant, { name: "Tuition" }))).toBe("VALIDATION");
  });

  it("validates structures and keeps one active structure per scope", async () => {
    const base = { academicYearId: setup.year.id, name: "Std I fees", classId: setup.cls.id };
    const lines = [{ feeItemId: tuition.id, amount: "300,000", termSequence: null }, { feeItemId: bus.id, amount: "50000", termSequence: null }, { feeItemId: admission.id, amount: 20000, termSequence: 1 }];
    expect(await code(fees.createStructure(accountant, { ...base, lines: [{ feeItemId: tuition.id, amount: "0", termSequence: null }] }))).toBe("VALIDATION");
    expect(await code(fees.createStructure(accountant, { ...base, lines: [{ feeItemId: randomUUID(), amount: "10", termSequence: null }] }))).toBe("VALIDATION");
    expect(await code(fees.createStructure(accountant, { ...base, levelId: setup.level.id, lines }))).toBe("VALIDATION"); // class and level together
    expect(await code(fees.createStructure(accountant, { ...base, lines: [...lines, lines[0]!] }))).toBe("VALIDATION"); // same item twice
    expect(await code(fees.createStructure(teacher, { ...base, lines }))).toBe("FORBIDDEN");
    await fees.createStructure(accountant, { ...base, lines });
    expect(await code(fees.createStructure(accountant, { ...base, name: "Another", lines }))).toBe("VALIDATION"); // second active structure for the same class and year
  });

  it("the most specific structure wins: class, then level, then everyone", async () => {
    const level = await fees.createStructure(accountant, { academicYearId: setup.year.id, name: "Primary", levelId: setup.level.id, lines: [{ feeItemId: tuition.id, amount: "100000", termSequence: null }] });
    const everyone = await fees.createStructure(accountant, { academicYearId: setup.year.id, name: "All", lines: [{ feeItemId: tuition.id, amount: "1000", termSequence: null }] });
    const r = await fees.resolveStructure(db, school.id, setup.year.id, setup.cls.id, setup.level.id);
    expect(r!.name).toBe("Std I fees");
    await fees.setStructureActive(accountant, (await db.feeStructure.findFirstOrThrow({ where: { schoolId: school.id, name: "Std I fees" } })).id, false);
    expect((await fees.resolveStructure(db, school.id, setup.year.id, setup.cls.id, setup.level.id))!.id).toBe(level.id);
    await fees.setStructureActive(accountant, level.id, false);
    expect((await fees.resolveStructure(db, school.id, setup.year.id, setup.cls.id, setup.level.id))!.id).toBe(everyone.id);
    await fees.setStructureActive(accountant, everyone.id, false);
    await fees.setStructureActive(accountant, (await db.feeStructure.findFirstOrThrow({ where: { schoolId: school.id, name: "Std I fees" } })).id, true);
    expect(await code(fees.setStructureActive(accountant, level.id, true).then(() => fees.setStructureActive(accountant, everyone.id, true)))).toBe(null); // different scopes may coexist
    await fees.setStructureActive(accountant, level.id, false);
    await fees.setStructureActive(accountant, everyone.id, false);
  });
});

describe("discounts and scholarships", () => {
  it("only fees.discount can grant; percentages are limited to 100", async () => {
    const d = { studentId: kids[0]!.id, academicYearId: setup.year.id, name: "Staff child", kind: "PERCENT", value: "50", reason: "Child of a teacher" };
    expect(await code(fees.grantDiscount(accountant, d))).toBe("FORBIDDEN");
    expect(await code(fees.grantDiscount(head, { ...d, value: "101" }))).toBe("VALIDATION");
    expect(await code(fees.grantDiscount(head, { ...d, value: "abc" }))).toBe("VALIDATION");
    expect(await code(fees.grantDiscount(head, { ...d, reason: "" }))).toBe("VALIDATION");
    await fees.grantDiscount(head, d);
    await fees.grantDiscount(head, { studentId: kids[1]!.id, academicYearId: setup.year.id, name: "Bursary", kind: "FIXED", value: "100000", feeItemId: tuition.id, reason: "Hardship" });
    await fees.grantDiscount(head, { studentId: kids[2]!.id, academicYearId: setup.year.id, name: "Full scholarship", kind: "PERCENT", value: "100", reason: "Sponsored" });
  });
});

describe("invoice generation", () => {
  const input = () => ({ termId: setup.term.id, dueDate: dueDate() });

  it("previews, then generates once; a second run never bills anyone twice", async () => {
    expect(await code(invoices.previewTermInvoices(teacher, input()))).toBe("FORBIDDEN");
    const p = await invoices.previewTermInvoices(accountant, input());
    expect(p).toMatchObject({ willCreate: 4, alreadyInvoiced: 0, noStructure: [] });
    // Student 0: 50% of 370,000; student 1: 370,000 - 100,000; student 2: 100% scholarship; student 3: full.
    expect(p.billedCents).toBe(tzs(185_000 + 270_000 + 0 + 370_000));
    expect(p.zeroTotal).toBe(1);
    const g = await invoices.generateTermInvoices(accountant, input());
    expect(g).toMatchObject({ created: 4, alreadyInvoiced: 0 });
    const again = await invoices.generateTermInvoices(accountant, input());
    expect(again).toMatchObject({ created: 0, alreadyInvoiced: 4 });
    expect(await db.invoice.count({ where: { schoolId: school.id, type: "TERM_FEES" } })).toBe(4);
  });

  it("amounts, discounts and numbers are right", async () => {
    expect((await bal(0)).billed).toBe(tzs(185_000));
    expect((await bal(1)).billed).toBe(tzs(270_000));
    expect((await bal(2)).billed).toBe(0);
    expect((await bal(3)).billed).toBe(tzs(370_000));
    const list = await invoices.listInvoices(accountant, { termId: setup.term.id });
    expect(list.total).toBe(4);
    expect(new Set(list.items.map((i) => i.number)).size).toBe(4);
    expect(list.items[0]!.number).toMatch(new RegExp(`^INV/${setup.yearNo}/\\d{5}$`));
    expect(list.items.find((i) => i.studentId === kids[2]!.id)!.balance!.state).toBe("NO_CHARGE"); // zero charge is not "paid"
    expect((await invoices.listInvoices(accountant, { termId: setup.term.id, state: "UNPAID" })).total).toBe(3);
    expect((await invoices.listInvoices(accountant, { q: kids[3]!.admissionNo })).items.map((i) => i.studentId)).toEqual([kids[3]!.id]);
  });

  it("refuses a due date before the issue date and concurrent runs never duplicate", async () => {
    expect(await code(invoices.generateTermInvoices(accountant, { termId: setup.term.id, issueDate: `${setup.yearNo}-06-01`, dueDate: `${setup.yearNo}-05-01` }))).toBe("VALIDATION");
    await db.invoice.updateMany({ where: { schoolId: school.id, studentId: kids[3]!.id }, data: { status: "VOID", voidedAt: new Date(), voidedById: accountant.userId, voidReason: "test" } });
    const results = await Promise.all([1, 2, 3].map(() => invoices.generateTermInvoices(accountant, input())));
    expect(results.reduce((a, r) => a + r.created, 0)).toBe(1);
    expect(await db.invoice.count({ where: { schoolId: school.id, studentId: kids[3]!.id, status: "ISSUED" } })).toBe(1);
  });
});

describe("recording payments", () => {
  it("is limited to payment.record and validates input", async () => {
    expect(await code(pay(3, "1000"))).toBe(null);
    expect(await code(payments.recordPayment(teacher, { studentId: kids[3]!.id, amount: "10", method: "CASH" }))).toBe("FORBIDDEN");
    expect(await code(payments.recordPayment(head, { studentId: kids[3]!.id, amount: "10", method: "CASH" }))).toBe("FORBIDDEN");
    for (const bad of ["0", "-5", "abc", "1.234", "", "1e3"]) expect(await code(pay(3, bad))).toBe("VALIDATION");
    expect(await code(pay(3, "100", { method: "BANK" }))).toBe("VALIDATION"); // bank needs a reference
    expect(await code(pay(3, "100", { receivedOn: `${setup.yearNo + 5}-01-01` }))).toBe("VALIDATION"); // future
    expect(await code(payments.recordPayment(accountant, { studentId: randomUUID(), amount: "10", method: "CASH" }))).toBe("NOT_FOUND");
    expect(await code(pay(3, "100", { targetInvoiceId: randomUUID() }))).toBe("VALIDATION");
  });

  it("a partial payment leaves the rest outstanding and issues a numbered receipt", async () => {
    const r = await pay(0, "100000", { payerName: "Mama Amina" });
    expect(r.receipt.number).toMatch(/^RCT\/\d{4}\/\d{5}$/);
    const snap = r.receipt.snapshot as unknown as payments.ReceiptSnapshot;
    expect(snap).toMatchObject({ amountCents: tzs(100_000), outstandingBeforeCents: tzs(185_000), outstandingAfterCents: tzs(85_000), creditAddedCents: 0, payer: "Mama Amina" });
    expect(snap.appliedTo).toEqual([{ number: expect.stringMatching(/^INV\//), amountCents: tzs(100_000) }]);
    const l = await bal(0);
    expect(l).toMatchObject({ outstanding: tzs(85_000), credit: 0 });
    expect([...l.invoices.values()][0]!.state).toBe("PARTIAL");
  });

  it("an overpayment becomes credit, never a negative balance", async () => {
    await pay(1, "300000");
    const l = await bal(1);
    expect(l).toMatchObject({ outstanding: 0, credit: tzs(30_000) });
    expect([...l.invoices.values()][0]!.state).toBe("PAID");
  });

  it("is idempotent: the same submission key can never create two payments", async () => {
    const key = randomUUID();
    const rs = await Promise.all(Array.from({ length: 6 }, () => pay(0, "1000", { idempotencyKey: key })));
    expect(new Set(rs.map((r) => r.payment.id)).size).toBe(1);
    expect(rs.filter((r) => !r.replay).length).toBe(1);
    expect(await code(pay(0, "2000", { idempotencyKey: key }))).toBe("CONFLICT"); // same key, different payment
    expect(await db.payment.count({ where: { schoolId: school.id, idempotencyKey: key } })).toBe(1);
  });

  it("refuses to record the same bank reference twice while it is posted", async () => {
    await pay(3, "5000", { method: "BANK", reference: "SLIP-1" });
    expect(await code(pay(2, "5000", { method: "BANK", reference: "SLIP-1" }))).toBe("VALIDATION");
    expect(await code(pay(3, "5000", { method: "MOBILE_MONEY", reference: "SLIP-1" }))).toBe(null); // a different method is a different transaction
  });

  it("parallel payments for one student all land, with unique receipt numbers and the right balance", async () => {
    const before = (await bal(3)).paymentsTotal;
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => pay(3, "1000", { idempotencyKey: randomUUID(), notes: `p${i}` })));
    expect(new Set(rs.map((r) => r.receipt.number)).size).toBe(8);
    expect((await bal(3)).paymentsTotal).toBe(before + tzs(8000));
  });

  it("a payment aimed at one invoice pays it first", async () => {
    const other = await invoices.createOtherInvoice(accountant, { studentId: kids[2]!.id, lines: "Uniform | 40,000\nBadge | 5,000", dueDate: dueDate() });
    expect((await bal(2)).billed).toBe(tzs(45_000));
    await pay(2, "45000", { targetInvoiceId: other.id });
    expect(await bal(2)).toMatchObject({ outstanding: 0, credit: 0 });
  });
});

describe("reversals", () => {
  it("restores the balance, voids the receipt, keeps the record, and cannot be repeated", async () => {
    const r = await pay(0, "20000", { idempotencyKey: randomUUID() });
    const before = await bal(0);
    expect(await code(payments.reversePayment(accountant, r.payment.id, { reason: "" }))).toBe("VALIDATION");
    expect(await code(payments.reversePayment(teacher, r.payment.id, { reason: "typo" }))).toBe("FORBIDDEN");
    await payments.reversePayment(accountant, r.payment.id, { reason: "Entered for the wrong student" });
    expect((await bal(0)).outstanding).toBe(before.outstanding + tzs(20_000));
    const p = await db.payment.findUniqueOrThrow({ where: { id: r.payment.id }, include: { receipt: true } });
    expect(p).toMatchObject({ status: "REVERSED", reverseReason: "Entered for the wrong student" });
    expect(p.receipt!.voidedAt).not.toBeNull();
    expect(await code(payments.reversePayment(accountant, r.payment.id, { reason: "again" }))).toBe("CONFLICT");
  });

  it("the database refuses edits and deletes of payments, receipts and invoice lines", async () => {
    const p = await db.payment.findFirstOrThrow({ where: { schoolId: school.id, status: "POSTED", studentId: { not: kids[1]!.id } } }); // not kids[1]: moving it there would be a no-op
    await expect(db.payment.update({ where: { id: p.id }, data: { amount: "1.00" } })).rejects.toThrow();
    await expect(db.payment.update({ where: { id: p.id }, data: { studentId: kids[1]!.id } })).rejects.toThrow();
    await expect(db.payment.delete({ where: { id: p.id } })).rejects.toThrow();
    const rec = await db.receipt.findFirstOrThrow({ where: { schoolId: school.id } });
    await expect(db.receipt.update({ where: { id: rec.id }, data: { snapshot: { hacked: true } } })).rejects.toThrow();
    await expect(db.receipt.delete({ where: { id: rec.id } })).rejects.toThrow();
    const line = await db.invoiceLine.findFirstOrThrow({ where: { invoice: { schoolId: school.id } } });
    await expect(db.invoiceLine.update({ where: { id: line.id }, data: { amount: "1.00" } })).rejects.toThrow();
    await expect(db.invoiceLine.delete({ where: { id: line.id } })).rejects.toThrow();
    const reversed = await db.payment.findFirstOrThrow({ where: { schoolId: school.id, status: "REVERSED" } });
    await expect(db.payment.update({ where: { id: reversed.id }, data: { status: "POSTED" } })).rejects.toThrow(); // a reversal is final
  });

  it("a reversed payment's reference can be entered again (for the right student)", async () => {
    const a = await pay(3, "7000", { method: "BANK", reference: "SLIP-9" });
    await payments.reversePayment(accountant, a.payment.id, { reason: "Wrong student" });
    expect(await code(pay(2, "7000", { method: "BANK", reference: "SLIP-9" }))).toBe(null);
  });
});

describe("refunds", () => {
  it("only unapplied credit can be refunded, by two different people", async () => {
    const credit = (await bal(1)).credit; // 30,000
    expect(credit).toBe(tzs(30_000));
    const ask = { studentId: kids[1]!.id, method: "CASH", reason: "Overpaid by mistake" };
    expect(await code(payments.requestRefund(teacher, { ...ask, amount: "1000" }))).toBe("FORBIDDEN");
    expect(await code(payments.requestRefund(accountant, { ...ask, amount: "30001" }))).toBe("VALIDATION");
    expect(await code(payments.requestRefund(accountant, { ...ask, studentId: kids[0]!.id, amount: "1" }))).toBe("VALIDATION"); // no credit
    const r = await payments.requestRefund(accountant, { ...ask, amount: "20000" });
    expect((await bal(1)).credit).toBe(tzs(10_000)); // reserved
    expect(await code(payments.requestRefund(accountant, { ...ask, amount: "15000" }))).toBe("VALIDATION"); // only 10,000 left
    expect(await code(payments.decideRefund(accountant, r.id, { decision: "APPROVE" }))).toBe("FORBIDDEN"); // lacks refund.approve
    expect(await code(payments.decideRefund(head, r.id, { decision: "REJECT" }))).toBe("VALIDATION"); // needs a reason
    await payments.decideRefund(head, r.id, { decision: "APPROVE", note: "OK" });
    expect(await code(payments.decideRefund(head, r.id, { decision: "APPROVE" }))).toBe("CONFLICT"); // already decided
    expect(await code(payments.payRefund(accountant, randomUUID(), {}))).toBe("NOT_FOUND");
    await payments.payRefund(accountant, r.id, {});
    expect((await db.refund.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PAID");
    expect((await bal(1)).credit).toBe(tzs(10_000));
  });

  it("nobody can approve their own request, and the database enforces it too", async () => {
    const r = await payments.requestRefund(admin, { studentId: kids[1]!.id, amount: "5000", method: "CASH", reason: "Test" });
    expect(await code(payments.decideRefund(admin, r.id, { decision: "APPROVE" }))).toBe("FORBIDDEN");
    await expect(db.refund.update({ where: { id: r.id }, data: { status: "APPROVED", decidedById: admin.userId, decidedAt: new Date() } })).rejects.toThrow();
    await payments.decideRefund(head, r.id, { decision: "REJECT", note: "Not needed" });
    expect((await bal(1)).credit).toBe(tzs(10_000)); // a rejected request releases its reservation
  });

  it("a payment whose money was refunded cannot be reversed", async () => {
    const pays = await db.payment.findMany({ where: { schoolId: school.id, studentId: kids[1]!.id, status: "POSTED" } });
    expect(await code(payments.reversePayment(accountant, pays[0]!.id, { reason: "oops" }))).toBe("CONFLICT");
  });
});

describe("invoice adjustments, instalments and voiding", () => {
  let inv: { id: string };
  beforeAll(async () => {
    inv = await invoices.createOtherInvoice(accountant, { studentId: kids[2]!.id, lines: "Trip | 30,000\nSnacks | 10,000", dueDate: dueDate() });
  });

  it("adds lines only with a reason, never edits, and never takes the total below zero", async () => {
    expect(await code(invoices.addInvoiceLine(teacher, inv.id, { kind: "CHARGE", description: "x", amount: "1", reason: "r" }))).toBe("FORBIDDEN");
    expect(await code(invoices.addInvoiceLine(accountant, inv.id, { kind: "CHARGE", description: "Extra", amount: "5000", reason: "" }))).toBe("VALIDATION");
    expect(await code(invoices.addInvoiceLine(accountant, inv.id, { kind: "DISCOUNT", description: "Too much", amount: "99000", reason: "r" }))).toBe("VALIDATION");
    await invoices.addInvoiceLine(accountant, inv.id, { kind: "DISCOUNT", description: "Goodwill", amount: "10000", reason: "Parent complaint" });
    expect((await invoices.getInvoice(accountant, inv.id)).total).toBe(tzs(30_000));
  });

  it("instalments must add up to the total and cannot start before the invoice", async () => {
    const plus = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    expect(await code(invoices.setInstalments(accountant, inv.id, { items: [{ dueDate: plus(5), amount: "10000" }] }))).toBe("VALIDATION"); // does not add up to 30,000
    expect(await code(invoices.setInstalments(accountant, inv.id, { items: [{ dueDate: plus(-60), amount: "30000" }] }))).toBe("VALIDATION"); // before issue
    await invoices.setInstalments(accountant, inv.id, { items: [{ dueDate: plus(60), amount: "10000" }, { dueDate: plus(5), amount: "10000" }, { dueDate: plus(30), amount: "10000" }] });
    const d = await invoices.getInvoice(accountant, inv.id);
    expect(d.balance!.schedule.map((x) => x.dueDate)).toEqual([plus(5), plus(30), plus(60)]); // ordered by date
    expect(d.balance!.overdueAmount).toBe(0); // nothing is due yet
    expect(d.invoice.instalments).toHaveLength(3);
  });

  it("voiding keeps the record; payments aimed at it become credit; a void invoice cannot be changed", async () => {
    await pay(2, "10000", { targetInvoiceId: inv.id });
    const before = await bal(2);
    expect(await code(invoices.voidInvoice(accountant, inv.id, { reason: "" }))).toBe("VALIDATION");
    await invoices.voidInvoice(accountant, inv.id, { reason: "Trip cancelled" });
    expect(await code(invoices.voidInvoice(accountant, inv.id, { reason: "again" }))).toBe("CONFLICT");
    expect(await code(invoices.addInvoiceLine(accountant, inv.id, { kind: "CHARGE", description: "x", amount: "1", reason: "r" }))).toBe("CONFLICT");
    expect((await bal(2)).billed).toBe(before.billed - tzs(30_000));
    expect((await bal(2)).credit).toBeGreaterThanOrEqual(tzs(10_000));
    expect((await invoices.getInvoice(accountant, inv.id)).invoice.status).toBe("VOID");
  });
});

describe("financial clearance", () => {
  it("needs a bill for the term and an outstanding balance within the school's limit", async () => {
    const all = kids.map((k) => k.id);
    const cleared = await fees.clearedStudents(db, school.id, setup.term.id, all);
    expect(cleared.has(kids[1]!.id)).toBe(true); // fully paid
    expect(cleared.has(kids[2]!.id)).toBe(true); // scholarship, zero outstanding (explicit zero invoice exists)
    expect(cleared.has(kids[0]!.id)).toBe(false); // still owes
    await fees.updateFeeSettings(accountant, { defaultDueDays: "14", clearanceMaxOutstanding: "100000" });
    expect((await fees.clearedStudents(db, school.id, setup.term.id, all)).has(kids[0]!.id)).toBe(true); // 85,000 owed <= 100,000
    const unbilled = await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id }));
    expect((await fees.clearedStudents(db, school.id, setup.term.id, [unbilled.id])).has(unbilled.id)).toBe(false); // never billed = not cleared
    await fees.updateFeeSettings(accountant, { defaultDueDays: "14", clearanceMaxOutstanding: "0" });
  });
});

describe("expenses", () => {
  it("records and voids expenses, never deletes, and is permission-limited", async () => {
    expect(await code(expenses.createExpenseCategory(teacher, { name: "Stationery" }))).toBe("FORBIDDEN");
    const cat = await expenses.createExpenseCategory(accountant, { name: "Stationery" });
    expect(await code(expenses.createExpenseCategory(accountant, { name: "Stationery" }))).toBe("VALIDATION");
    const e = await expenses.recordExpense(accountant, { categoryId: cat.id, amount: "25,000", payee: "Book shop", method: "CASH" });
    expect(await code(expenses.recordExpense(accountant, { categoryId: cat.id, amount: "0", payee: "x", method: "CASH" }))).toBe("VALIDATION");
    expect(await code(expenses.recordExpense(accountant, { categoryId: cat.id, amount: "5", payee: "x", method: "BANK" }))).toBe("VALIDATION");
    expect(await code(expenses.recordExpense(accountant, { categoryId: cat.id, amount: "5", payee: "x", method: "CASH", spentOn: `${setup.yearNo + 4}-01-01` }))).toBe("VALIDATION");
    expect(await code(expenses.recordExpense(head, { categoryId: cat.id, amount: "5", payee: "x", method: "CASH" }))).toBe("FORBIDDEN");
    expect((await expenses.listExpenses(head)).totalCents).toBe(tzs(25_000));
    await expenses.voidExpense(accountant, e.id, { reason: "Duplicate entry" });
    expect((await expenses.listExpenses(accountant)).totalCents).toBe(0);
    expect(await code(expenses.voidExpense(accountant, e.id, { reason: "again" }))).toBe("CONFLICT");
    await expect(db.expense.delete({ where: { id: e.id } })).rejects.toThrow();
  });
});

describe("provider notifications", () => {
  const SECRET = "s".repeat(32);
  const env = () => ({ PAYMENTS_SELCOM_WEBHOOK_SECRET: SECRET, PAYMENTS_SCHOOL_CODE: school.code });
  const meta = { ip: "203.0.113.5", userAgent: "provider" };
  const send = (body: object, opts: { secret?: string; provider?: string; env?: Record<string, string | undefined>; sign?: boolean } = {}) => {
    const raw = JSON.stringify(body);
    const sig = opts.sign === false ? "deadbeef" : signBody(opts.secret ?? SECRET, raw);
    return events.processProviderEvent(opts.provider ?? "selcom", raw, new Headers({ "x-signature": sig }), meta, opts.env ?? env());
  };
  const evt = (over: Record<string, unknown> = {}) => ({ eventId: `E-${randomUUID()}`, status: "SUCCESS", amount: "50000", currency: "TZS", reference: kids[0]!.admissionNo, msisdn: "255700111222", ...over });

  it("refuses unknown and unconfigured providers and bad signatures, storing nothing", async () => {
    const eventsBefore = await db.paymentEvent.count({ where: { schoolId: school.id } });
    expect((await send(evt(), { provider: "nope" })).status).toBe(404);
    expect((await send(evt(), { env: {} })).status).toBe(503); // not configured
    expect((await send(evt(), { env: { PAYMENTS_SELCOM_WEBHOOK_SECRET: "short" } })).status).toBe(503);
    expect((await send(evt(), { sign: false })).status).toBe(401);
    expect((await send(evt(), { secret: "x".repeat(32) })).status).toBe(401); // signed with the wrong secret
    const tampered = JSON.stringify(evt());
    expect((await events.processProviderEvent("selcom", tampered.replace("50000", "99999"), new Headers({ "x-signature": signBody(SECRET, tampered) }), meta, env())).status).toBe(401);
    expect((await events.processProviderEvent("selcom", "not json", new Headers({ "x-signature": signBody(SECRET, "not json") }), meta, env())).status).toBe(422);
    expect(await db.paymentEvent.count({ where: { schoolId: school.id } })).toBe(eventsBefore);
  });

  it("a verified, matched SUCCESS notification records one payment, once", async () => {
    const before = (await bal(0)).paymentsTotal;
    const e = evt();
    const first = await send(e);
    expect(first).toMatchObject({ status: 200, body: { status: "POSTED" } });
    const second = await send(e); // provider retry
    expect(second).toMatchObject({ status: 200, body: { duplicate: true } });
    expect((await bal(0)).paymentsTotal).toBe(before + tzs(50_000));
    const p = await db.payment.findFirstOrThrow({ where: { schoolId: school.id, provider: "selcom", reference: e.eventId } });
    expect(p).toMatchObject({ method: "MOBILE_MONEY", source: "PROVIDER", createdById: null, studentId: kids[0]!.id });
    expect(await db.receipt.count({ where: { paymentId: p.id } })).toBe(1);
    const audit = await db.auditLog.findFirst({ where: { schoolId: school.id, entityId: p.id, action: "payment.record" } });
    expect(audit?.actorId).toBeNull();
    expect(audit?.actorName).toContain("Selcom");
  });

  it("concurrent identical notifications create exactly one payment", async () => {
    const e = evt();
    const before = (await bal(0)).paymentsTotal;
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => send(e)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect((await bal(0)).paymentsTotal).toBe(before + tzs(50_000));
  });

  it("pending and failed notifications are stored but never create money", async () => {
    const before = await db.payment.count({ where: { schoolId: school.id } });
    for (const status of ["PENDING", "FAILED"]) expect((await send(evt({ status }))).body).toMatchObject({ status: "NOT_SUCCESSFUL" });
    expect(await db.payment.count({ where: { schoolId: school.id } })).toBe(before);
    expect(await db.paymentEvent.count({ where: { schoolId: school.id, status: "NOT_SUCCESSFUL" } })).toBe(2);
  });

  it("unmatched, wrong-currency and invalid-amount notifications wait for a person", async () => {
    const before = await db.payment.count({ where: { schoolId: school.id } });
    const a = evt({ reference: "NO-SUCH-STUDENT" });
    expect((await send(a)).body).toMatchObject({ status: "UNMATCHED" });
    expect((await send(evt({ currency: "USD" }))).body).toMatchObject({ status: "UNMATCHED" });
    expect((await send(evt({ amount: "-5" }))).body).toMatchObject({ status: "UNMATCHED" });
    expect((await send(evt({ amount: undefined }))).body).toMatchObject({ status: "UNMATCHED" });
    expect(await db.payment.count({ where: { schoolId: school.id } })).toBe(before);
    const queue = await events.listPaymentEvents(accountant, { status: "UNMATCHED" });
    expect(queue.total).toBe(4);
    expect(await code(events.listPaymentEvents(teacher))).toBe("FORBIDDEN");
  });

  it("an invoice number as the reference also matches, and aims the payment at that invoice", async () => {
    const inv = await db.invoice.findFirstOrThrow({ where: { schoolId: school.id, studentId: kids[0]!.id, status: "ISSUED" } });
    const r = await send(evt({ reference: inv.number, amount: "1000" }));
    expect(r.body).toMatchObject({ status: "POSTED" });
    expect((await db.payment.findFirstOrThrow({ where: { schoolId: school.id, targetInvoiceId: inv.id, provider: "selcom" } })).amount.toString()).toBe("1000");
  });

  it("a person can assign or reject an unmatched notification, once", async () => {
    const queue = (await events.listPaymentEvents(accountant, { status: "UNMATCHED" })).items;
    const assignable = queue.find((e) => e.reference === "NO-SUCH-STUDENT")!;
    const before = (await bal(2)).paymentsTotal;
    await events.assignPaymentEvent(accountant, assignable.id, { studentId: kids[2]!.id });
    expect((await bal(2)).paymentsTotal).toBe(before + tzs(50_000));
    expect(await code(events.assignPaymentEvent(accountant, assignable.id, { studentId: kids[2]!.id }))).toBe("CONFLICT");
    const usd = queue.find((e) => e.currency === "USD")!;
    expect(await code(events.assignPaymentEvent(accountant, usd.id, { studentId: kids[2]!.id }))).toBe("CONFLICT"); // wrong currency cannot become a payment
    expect(await code(events.rejectPaymentEvent(accountant, usd.id, { reason: "" }))).toBe("VALIDATION");
    await events.rejectPaymentEvent(accountant, usd.id, { reason: "Foreign currency, handled elsewhere" });
    expect(await code(events.rejectPaymentEvent(accountant, usd.id, { reason: "again" }))).toBe("CONFLICT");
    const row = await db.paymentEvent.findUniqueOrThrow({ where: { id: assignable.id } });
    await expect(db.paymentEvent.update({ where: { id: row.id }, data: { payload: { tampered: true } } })).rejects.toThrow();
    await expect(db.paymentEvent.delete({ where: { id: row.id } })).rejects.toThrow();
  });
});

describe("tenant isolation", () => {
  it("another school cannot see, record, reverse or approve anything here", async () => {
    const other = await createTestSchool("Other");
    const o = (await createTestUser(other.id, ["accountant"])).ctx;
    const oHead = (await createTestUser(other.id, ["head_teacher"])).ctx;
    const p = await db.payment.findFirstOrThrow({ where: { schoolId: school.id, status: "POSTED" } });
    const inv = await db.invoice.findFirstOrThrow({ where: { schoolId: school.id } });
    expect(await code(payments.recordPayment(o, { studentId: kids[0]!.id, amount: "100", method: "CASH" }))).toBe("NOT_FOUND");
    expect(await code(payments.reversePayment(o, p.id, { reason: "x" }))).toBe("NOT_FOUND");
    expect(await code(payments.getPayment(o, p.id))).toBe("NOT_FOUND");
    expect(await code(invoices.getInvoice(o, inv.id))).toBe("NOT_FOUND");
    expect(await code(invoices.voidInvoice(o, inv.id, { reason: "x" }))).toBe("NOT_FOUND");
    expect(await code(invoices.getStudentStatement(o, kids[0]!.id))).toBe("NOT_FOUND");
    expect(await code(payments.requestRefund(o, { studentId: kids[1]!.id, amount: "1", method: "CASH", reason: "x" }))).toBe("NOT_FOUND");
    const refund = await db.refund.findFirstOrThrow({ where: { schoolId: school.id } });
    expect(await code(payments.decideRefund(oHead, refund.id, { decision: "APPROVE" }))).toBe("NOT_FOUND");
    expect((await invoices.listInvoices(o, {})).total).toBe(0);
    expect((await payments.listPayments(o, {})).total).toBe(0);
  });
});

describe("the printed receipt", () => {
  const stored = (i: number) => db.payment.findFirstOrThrow({ where: { schoolId: school.id, studentId: kids[i]!.id, status: "POSTED" }, include: { receipt: true }, orderBy: { createdAt: "asc" } });

  it("adds class, what was paid for, who received it and the amount in words, without touching the stored receipt", async () => {
    const p = await stored(0);
    const before = JSON.stringify(p.receipt!.snapshot);
    const doc = await receiptDocument(school.id, p.receipt!.snapshot as unknown as payments.ReceiptSnapshot, null, "EN");
    const cls = await db.schoolClass.findUniqueOrThrow({ where: { id: setup.cls.id }, select: { name: true } });
    expect(doc.className).toBe(cls.name);
    expect(doc.receivedBy).toBe(accountant.fullName);
    expect(doc.amountWords).toBe("TZS One Hundred Thousand Only");
    expect(doc.payingFor).toHaveLength(1);
    expect(doc.payingFor[0]).toMatchObject({ description: expect.stringContaining("School fees"), amountCents: tzs(100_000) });
    expect(doc.payingFor[0]!.description).toContain(setup.term.name);
    expect(JSON.stringify((await stored(0)).receipt!.snapshot)).toBe(before);
    expect(Buffer.from(await receiptPdf(school.id, p.receipt!.snapshot as unknown as payments.ReceiptSnapshot, null, "SW")).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("describes a one-off invoice by its first charge", async () => {
    const p = await stored(2);
    const doc = await receiptDocument(school.id, p.receipt!.snapshot as unknown as payments.ReceiptSnapshot, { reason: "test" }, "SW");
    expect(doc.payingFor[0]!.description).toBe("Uniform");
    expect(doc.voided).toBe(true);
    expect(doc.amountWords).toBe("TZS Elfu arobaini na tano tu");
  });
});

describe("the printed fee table", () => {
  it("lays the structure out by term and keeps the school's own scope names", async () => {
    const doc = await feeSheetDocument(accountant, { yearId: setup.year.id }, "EN");
    const sec = doc.sections.find((x) => x.name === "Std I fees")!;
    expect(sec.scope).toBe((await db.schoolClass.findUniqueOrThrow({ where: { id: setup.cls.id }, select: { name: true } })).name);
    expect(sec.table.terms.map((x) => x.name)).toEqual(["Term 1"]);
    expect(sec.table.rows.map((r) => [r.name, r.totalCents])).toEqual([["Tuition", tzs(300_000)], ["School bus", tzs(50_000)], ["Admission", tzs(20_000)]]);
    expect(sec.table.yearTotalCents).toBe(tzs(370_000));
    expect(doc.sections.every((x) => x.name !== "")).toBe(true);
    expect(doc.yearName).toBe(setup.year.name);
    const one = await feeSheetDocument(accountant, { yearId: setup.year.id, structureId: (await db.feeStructure.findFirstOrThrow({ where: { schoolId: school.id, name: "Std I fees" } })).id }, "SW");
    expect(one.sections).toHaveLength(1);
    expect(Buffer.from(await feeSheetPdf(accountant, { yearId: setup.year.id }, "SW")).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("needs fees.read and never reads another school's year or structure", async () => {
    expect(await code(feeSheetDocument(teacher, { yearId: setup.year.id }, "EN"))).toBe("FORBIDDEN");
    const other = await createTestSchool();
    const otherAccountant = (await createTestUser(other.id, ["accountant"])).ctx;
    expect(await code(feeSheetDocument(otherAccountant, { yearId: setup.year.id }, "EN"))).toBe("NOT_FOUND");
    const mine = await db.feeStructure.findFirstOrThrow({ where: { schoolId: school.id, name: "Std I fees" } });
    const otherAdmin = (await createTestUser(other.id, ["super_admin"])).ctx;
    const otherYear = (await createCurrentYearAcademics(otherAdmin)).year;
    expect(await code(feeSheetDocument(otherAccountant, { yearId: otherYear.id, structureId: mine.id }, "EN"))).toBe("NOT_FOUND");
  });
});

describe("expense approval", () => {
  it("holds expenses the school marked as needing approval, adds up only approved ones, and needs a second person", async () => {
    const cat = await expenses.createExpenseCategory(accountant, { name: `Capital ${n}` });
    const plain = await expenses.createExpenseCategory(accountant, { name: `Running ${n}` });
    await expenses.setExpenseCategoryApproval(accountant, cat.id, true);
    expect(await code(expenses.setExpenseCategoryApproval(teacher, cat.id, false))).toBe("FORBIDDEN");
    const held = await expenses.recordExpense(accountant, { categoryId: cat.id, amount: "80000", payee: "Builder", method: "CASH" });
    expect(held.approval).toBe("PENDING");
    expect((await expenses.recordExpense(accountant, { categoryId: plain.id, amount: "5000", payee: "Shop", method: "CASH" })).approval).toBe("APPROVED");
    const before = (await expenses.listExpenses(accountant, {})).totalCents;
    expect((await expenses.listExpenses(accountant, { approval: "PENDING" })).items.map((e) => e.id)).toContain(held.id);
    expect(await code(expenses.approveExpense(accountant, held.id))).toBe("FORBIDDEN"); // Finance records, someone else approves
    expect(await code(expenses.approveExpense(teacher, held.id))).toBe("FORBIDDEN");
    expect(await expenses.pendingExpenseCount(head)).toBeGreaterThan(0);
    await expenses.approveExpense(head, held.id);
    expect((await expenses.listExpenses(accountant, {})).totalCents).toBe(before + tzs(80_000)); // only now counted
    expect(await code(expenses.approveExpense(head, held.id))).toBe("CONFLICT"); // already decided
    // the person who recorded it cannot approve it, even with the permission
    const mine = await expenses.recordExpense(admin, { categoryId: cat.id, amount: "1000", payee: "Self", method: "CASH" });
    expect(await code(expenses.approveExpense(admin, mine.id))).toBe("CONFLICT");
    expect(await code(expenses.rejectExpense(head, mine.id, {}))).toBe("VALIDATION");
    await expenses.rejectExpense(head, mine.id, { reason: "No quotation attached" });
    expect((await expenses.listExpenses(accountant, {})).totalCents).toBe(before + tzs(80_000)); // rejected never counted
    expect(JSON.stringify(await db.auditLog.findMany({ where: { schoolId: school.id, entityId: held.id } }))).toContain("expense.approve");
  });

  it("holds any expense at or above the amount the school sets", async () => {
    await fees.updateFeeSettings(accountant, { defaultDueDays: 14, clearanceMaxOutstanding: "0", paymentInstructions: "", expenseApprovalAbove: "50000" });
    const c = await expenses.createExpenseCategory(accountant, { name: `Misc ${n}` });
    expect((await expenses.recordExpense(accountant, { categoryId: c.id, amount: "49999", payee: "A", method: "CASH" })).approval).toBe("APPROVED");
    expect((await expenses.recordExpense(accountant, { categoryId: c.id, amount: "50000", payee: "B", method: "CASH" })).approval).toBe("PENDING");
    await fees.updateFeeSettings(accountant, { defaultDueDays: 14, clearanceMaxOutstanding: "0", paymentInstructions: "" }); // a form without the field keeps it
    expect((await fees.getFeeSettings(db, school.id)).expenseApprovalAboveCents).toBe(tzs(50_000));
    await fees.updateFeeSettings(accountant, { defaultDueDays: 14, clearanceMaxOutstanding: "0", paymentInstructions: "", expenseApprovalAbove: "0" });
    expect((await expenses.recordExpense(accountant, { categoryId: c.id, amount: "900000", payee: "C", method: "CASH" })).approval).toBe("APPROVED");
  });
});
