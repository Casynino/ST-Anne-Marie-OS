import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildAuthContext, type AuthContext } from "@/lib/auth/context";
import * as students from "@/server/students";
import * as fees from "@/server/fees";
import * as invoices from "@/server/invoices";
import * as payments from "@/server/payments";
import * as expenses from "@/server/expenses";
import * as reports from "@/server/finance-reports";
import * as portal from "@/server/portal";
import { invoicePdf, receiptPdf } from "@/server/finance-pdf";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, accountant: AuthContext, head: AuthContext, registrar: AuthContext, teacher: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let kids: { id: string; admissionNo: string }[] = [];
let n = 300000 + Math.floor(Math.random() * 6_000_000);
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const pdfOk = (b: Uint8Array) => Buffer.from(b.slice(0, 5)).toString() === "%PDF-" && b.length > 1500;

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  accountant = (await createTestUser(school.id, ["accountant"])).ctx;
  head = (await createTestUser(school.id, ["head_teacher"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
  setup = await createCurrentYearAcademics(admin);
  for (let i = 0; i < 3; i++) kids.push(await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id })));
  const tuition = await fees.createFeeItem(accountant, { name: "Tuition" });
  await fees.createStructure(accountant, { academicYearId: setup.year.id, name: "Fees", classId: setup.cls.id, lines: [{ feeItemId: tuition.id, amount: "200000", termSequence: null }] });
  await invoices.generateTermInvoices(accountant, { termId: setup.term.id, dueDate: `${setup.yearNo}-12-31` });
});

describe("reports", () => {
  it("are limited to finance.reports", async () => {
    for (const ctx of [teacher, registrar]) {
      expect(await code(reports.financeOverview(ctx))).toBe("FORBIDDEN");
      expect(await code(reports.arrearsReport(ctx))).toBe("FORBIDDEN");
      expect(await code(reports.collectionsReport(ctx, { from: "2026-01-01", to: "2026-12-31" }))).toBe("FORBIDDEN");
    }
  });

  it("the overview, class and collection figures add up", async () => {
    const p1 = await payments.recordPayment(accountant, { studentId: kids[0]!.id, amount: "200000", method: "CASH" });
    await payments.recordPayment(accountant, { studentId: kids[1]!.id, amount: "50000", method: "MOBILE_MONEY", reference: "MM-1" });
    const wrong = await payments.recordPayment(accountant, { studentId: kids[2]!.id, amount: "70000", method: "BANK", reference: "B-1" });
    await payments.reversePayment(accountant, wrong.payment.id, { reason: "Wrong student" });
    const cat = await expenses.createExpenseCategory(accountant, { name: "Utilities" });
    await expenses.recordExpense(accountant, { categoryId: cat.id, amount: "30000", payee: "TANESCO", method: "CASH" });
    const o = (await reports.financeOverview(head, { termId: setup.term.id }))!;
    expect(o).toMatchObject({ billed: 600_000_00, paid: 250_000_00, outstanding: 350_000_00, collected: 250_000_00, expenses: 30_000_00, net: 220_000_00, collectionRatePct: 41.7 });
    expect(o.invoices).toMatchObject({ total: 3, unpaid: 1, partial: 1, paid: 1 });
    expect(o.byMethod.find((m) => m.method === "CASH")!.cents).toBe(200_000_00);
    const classes = await reports.classCollectionReport(accountant, { termId: setup.term.id });
    expect(classes).toEqual([expect.objectContaining({ className: setup.cls.name, students: 3, billed: 600_000_00, paid: 250_000_00, outstanding: 350_000_00 })]);
    const today = new Date().toISOString().slice(0, 10);
    const c = await reports.collectionsReport(accountant, { from: `${setup.yearNo}-01-01`, to: today });
    expect(c).toMatchObject({ collected: 250_000_00, count: 2, reversed: 70_000_00, reversedCount: 1, net: 250_000_00 });
    expect(await code(reports.collectionsReport(accountant, { from: "2026-05-01", to: "2026-04-01" }))).toBe("VALIDATION");
    void p1;
  });

  it("arrears list only students who owe, with ageing by due date (payments are applied oldest invoice first)", async () => {
    // Student 2 owes an old charge that fell due months ago; student 1 owes a charge due far in the future.
    await invoices.createOtherInvoice(accountant, { studentId: kids[2]!.id, lines: "Trip | 40,000", issueDate: `${setup.yearNo}-01-10`, dueDate: `${setup.yearNo}-02-01` });
    await invoices.createOtherInvoice(accountant, { studentId: kids[1]!.id, lines: "Books | 10,000", dueDate: `${setup.yearNo + 1}-01-01` });
    const a = await reports.arrearsReport(accountant, {});
    const byAdm = new Map(a.rows.map((r) => [r.admissionNo, r]));
    expect(byAdm.has(kids[0]!.admissionNo)).toBe(false); // paid in full
    const r2 = byAdm.get(kids[2]!.admissionNo)!;
    expect(r2.outstanding).toBe(240_000_00); // 200,000 tuition + 40,000 trip
    expect(r2.overdue).toBe(40_000_00); // only the trip is past its due date
    expect(r2.ageing["90+"]).toBe(40_000_00);
    expect(r2.oldestDue).toBe(`${setup.yearNo}-02-01`);
    const r1 = byAdm.get(kids[1]!.admissionNo)!;
    expect(r1.outstanding).toBe(160_000_00); // 150,000 tuition + 10,000 books
    expect(r1.overdue).toBe(0);
    expect(a.rows.every((r) => r.outstanding > 0)).toBe(true);
    expect(a.rows[0]!.admissionNo).toBe(kids[2]!.admissionNo); // most overdue first
    expect(a.totals["90+"]).toBe(40_000_00);
    expect(a.outstandingTotal).toBe(400_000_00);
    expect(r2.phone).not.toBeNull(); // accountants see the primary guardian's phone for follow-up
    expect((await reports.arrearsReport(accountant, { classId: setup.cls.id })).studentsOwing).toBe(2);
  });

  it("expense totals exclude voided entries", async () => {
    const e = await expenses.listExpenses(accountant, {});
    await expenses.voidExpense(accountant, e.items[0]!.id, { reason: "Duplicate" });
    const r = await reports.expensesReport(accountant, { from: `${setup.yearNo}-01-01`, to: new Date().toISOString().slice(0, 10) });
    expect(r.total).toBe(0);
  });
});

describe("pdf documents", () => {
  it("renders receipts (with a VOID marker when reversed) and invoices", async () => {
    const pay = await db.payment.findFirstOrThrow({ where: { schoolId: school.id, status: "POSTED" }, include: { receipt: true } });
    const snap = pay.receipt!.snapshot as unknown as payments.ReceiptSnapshot;
    expect(pdfOk(await receiptPdf(school.id, snap, null, "EN"))).toBe(true);
    expect(pdfOk(await receiptPdf(school.id, snap, { reason: "Reversed in error" }, "SW"))).toBe(true);
    const inv = await db.invoice.findFirstOrThrow({ where: { schoolId: school.id, status: "ISSUED" } });
    await invoices.setInstalments(accountant, inv.id, { items: [{ dueDate: `${setup.yearNo + 1}-01-01`, amount: "100000" }, { dueDate: `${setup.yearNo + 1}-02-01`, amount: "100000" }] }).catch(() => undefined);
    expect(pdfOk(await invoicePdf(school.id, inv.id, "EN"))).toBe(true);
    expect(pdfOk(await invoicePdf(school.id, inv.id, "SW"))).toBe(true);
  });
});

describe("family portal: fees", () => {
  let parent: AuthContext, other: AuthContext;
  beforeAll(async () => {
    const mk = async (i: number) => {
      const g = await db.guardian.findFirstOrThrow({ where: { schoolId: school.id, students: { some: { studentId: kids[i]!.id } } } });
      await portal.createGuardianAccount(registrar, g.id);
      return buildAuthContext((await db.guardian.findUniqueOrThrow({ where: { id: g.id } })).userId!);
    };
    parent = await mk(1);
    other = await mk(2);
  });

  it("a parent sees only their own child's invoices, payments and balance", async () => {
    const f = await portal.childFees(parent, kids[1]!.id);
    expect(f.summary).toMatchObject({ billed: 210_000_00, paid: 50_000_00, outstanding: 160_000_00, credit: 0 });
    expect(f.invoices).toHaveLength(2);
    expect(f.payments.map((p) => p.amountCents)).toEqual([50_000_00]);
    expect(f.payments[0]!.receiptNumber).toMatch(/^RCT\//);
    expect(await code(portal.childFees(parent, kids[2]!.id))).toBe("NOT_FOUND");
    expect(await code(portal.childFees(other, kids[1]!.id))).toBe("NOT_FOUND");
    expect(await code(portal.childFees(accountant, kids[1]!.id))).toBe("FORBIDDEN");
  });

  it("receipts and invoices are reachable only for the viewer's own child, never for reversed or void ones", async () => {
    const p = await db.payment.findFirstOrThrow({ where: { schoolId: school.id, studentId: kids[1]!.id, status: "POSTED" } });
    expect((await portal.getMyReceipt(parent, p.id)).snapshot.student.admissionNo).toBe(kids[1]!.admissionNo);
    expect(await code(portal.getMyReceipt(other, p.id))).toBe("NOT_FOUND");
    const reversed = await db.payment.findFirstOrThrow({ where: { schoolId: school.id, studentId: kids[2]!.id, status: "REVERSED" } });
    expect(await code(portal.getMyReceipt(other, reversed.id))).toBe("NOT_FOUND");
    const inv = await db.invoice.findFirstOrThrow({ where: { schoolId: school.id, studentId: kids[1]!.id, status: "ISSUED" } });
    expect((await portal.getMyInvoiceId(parent, inv.id)).id).toBe(inv.id);
    expect(await code(portal.getMyInvoiceId(other, inv.id))).toBe("NOT_FOUND");
    await invoices.voidInvoice(accountant, inv.id, { reason: "Test" });
    expect(await code(portal.getMyInvoiceId(parent, inv.id))).toBe("NOT_FOUND");
    expect((await portal.childFees(parent, kids[1]!.id)).invoices.map((i) => i.id)).not.toContain(inv.id);
  });
});
