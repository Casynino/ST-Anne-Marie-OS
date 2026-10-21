import { z } from "zod";
import { db, type Db, type Tx } from "@/lib/db";
import { conflict, invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { formatDateOnly } from "@/lib/dates";
import { centsOf, decimalOf, formatMoney, parseAmount, positiveAmount } from "@/lib/finance/money";
import { applyDiscounts, type DiscountRule, type InvoiceBalance } from "@/lib/finance/ledger";
import { actorOf, writeAudit } from "@/server/audit";
import { loadFinance, loadStudentFinance, schoolToday } from "@/server/balances";
import { loadRoster } from "@/server/marks";
import { resolveStructure } from "@/server/fees";
import { dateOnly, optDateOnly, optText, optUuid, parse, text, uuid } from "@/lib/validation";

const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";

/** Concurrency-safe numbers (INV/2026/00001, RCT/2026/00001; ADM = admission offer letter, ARC = admission payment receipt, REC = job candidate): the counter row is locked until commit and numbers are never reused. */
export async function allocateNumber(tx: Tx, schoolId: string, prefix: "INV" | "RCT" | "ADM" | "ARC" | "REC", year: number): Promise<string> {
  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO admission_counters ("schoolId", "scope", "lastValue")
    VALUES (${schoolId}::uuid, ${`${prefix}:${year}`}, 1)
    ON CONFLICT ("schoolId", "scope") DO UPDATE SET "lastValue" = admission_counters."lastValue" + 1
    RETURNING "lastValue"`;
  return `${prefix}/${year}/${String(rows[0]!.lastValue).padStart(5, "0")}`;
}

// ───────────────────────── Term invoice generation ─────────────────────────

const genSchema = z.object({ termId: uuid(), classId: optUuid(), streamId: optUuid(), issueDate: optDateOnly(), dueDate: dateOnly() });

type PlannedLine = { feeItemId: string | null; kind: "CHARGE" | "DISCOUNT"; description: string; amount: number };
type PlannedInvoice = { studentId: string; studentName: string; classId: string; lines: PlannedLine[]; total: number };

async function planTermInvoices(client: Db | Tx, ctx: AuthContext, d: z.infer<typeof genSchema>) {
  const term = await client.term.findFirst({ where: { id: d.termId, schoolId: ctx.schoolId }, include: { academicYear: true } });
  if (!term) throw invalid("Please correct the highlighted fields.", { termId: "Choose a term" });
  const classes = await client.schoolClass.findMany({ where: { schoolId: ctx.schoolId, isActive: true, ...(d.classId ? { id: d.classId } : {}) }, include: { streams: { select: { id: true } } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  if (d.classId && !classes.length) throw notFound("Class");
  if (d.streamId && !classes.some((c) => c.streams.some((s) => s.id === d.streamId))) throw invalid("Please correct the highlighted fields.", { streamId: "That stream does not belong to the selected class" });
  const issue = d.issueDate ?? (await schoolDateAsDate(client, ctx.schoolId));
  if (d.dueDate < issue) throw invalid("Please correct the highlighted fields.", { dueDate: "The due date cannot be before the issue date" });

  const plan: PlannedInvoice[] = [];
  const noStructure: string[] = [];
  let alreadyInvoiced = 0;
  let notEnrolled = 0;
  const discounts = await client.studentDiscount.findMany({ where: { schoolId: ctx.schoolId, academicYearId: term.academicYearId, isActive: true }, orderBy: { createdAt: "asc" } });
  const feeItemNames = new Map((await client.feeItem.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true } })).map((f) => [f.id, f.name]));

  for (const cls of classes) {
    const roster = await loadRoster(client, ctx.schoolId, { academicYearId: term.academicYearId, termId: term.id }, cls.id, d.streamId ?? null);
    if (!roster.length) continue;
    const structure = await resolveStructure(client, ctx.schoolId, term.academicYearId, cls.id, cls.levelId);
    const lines = (structure?.lines ?? []).filter((l) => l.termSequence === null || l.termSequence === term.sequence);
    if (!structure || !lines.length) {
      noStructure.push(cls.name);
      continue;
    }
    const existing = new Set((await client.invoice.findMany({ where: { schoolId: ctx.schoolId, termId: term.id, type: "TERM_FEES", status: "ISSUED", studentId: { in: roster.map((s) => s.id) } }, select: { studentId: true } })).map((i) => i.studentId));
    for (const s of roster) {
      if (s.status !== "ENROLLED") { notEnrolled++; continue; }
      if (existing.has(s.id)) { alreadyInvoiced++; continue; }
      const charges: PlannedLine[] = lines.map((l) => ({ feeItemId: l.feeItemId, kind: "CHARGE", description: l.feeItem.name, amount: centsOf(l.amount) }));
      const rules: (DiscountRule & { name: string })[] = discounts.filter((x) => x.studentId === s.id).map((x) => ({ kind: x.kind, value: centsOf(x.value), feeItemId: x.feeItemId, name: x.name }));
      const applied = applyDiscounts(charges, rules);
      const discountLines: PlannedLine[] = applied.map((a) => ({ feeItemId: a.rule.feeItemId, kind: "DISCOUNT", description: `${(a.rule as DiscountRule & { name: string }).name}${a.rule.feeItemId ? ` (${feeItemNames.get(a.rule.feeItemId) ?? ""})` : ""}`, amount: a.amount }));
      const all = [...charges, ...discountLines];
      plan.push({ studentId: s.id, studentName: [s.firstName, s.lastName].join(" "), classId: cls.id, lines: all, total: all.reduce((n, l) => n + (l.kind === "CHARGE" ? l.amount : -l.amount), 0) });
    }
  }
  return { term, plan, noStructure, alreadyInvoiced, notEnrolled, issue };
}

async function schoolDateAsDate(client: Db | Tx, schoolId: string): Promise<Date> {
  return new Date(`${await schoolToday(client, schoolId)}T00:00:00Z`);
}

/** What generating would do, without creating anything. */
export async function previewTermInvoices(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "invoice.generate");
  const r = await planTermInvoices(db, ctx, parse(genSchema, input));
  return { willCreate: r.plan.length, billedCents: r.plan.reduce((n, p) => n + p.total, 0), zeroTotal: r.plan.filter((p) => p.total === 0).length, alreadyInvoiced: r.alreadyInvoiced, notEnrolled: r.notEnrolled, noStructure: r.noStructure };
}

/** Idempotent: students who already have a live term-fee invoice for the term are skipped, never billed twice. */
export async function generateTermInvoices(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "invoice.generate");
  const d = parse(genSchema, input);
  const r = await planTermInvoices(db, ctx, d);
  const year = Number(formatDateOnly(r.issue).slice(0, 4));
  let created = 0;
  let raced = 0;
  let billed = 0;
  for (const p of r.plan) {
    try {
      await db.$transaction(async (tx) => {
        const number = await allocateNumber(tx, ctx.schoolId, "INV", year);
        await tx.invoice.create({
          data: {
            schoolId: ctx.schoolId, studentId: p.studentId, academicYearId: r.term.academicYearId, termId: r.term.id, classId: p.classId, number, type: "TERM_FEES",
            issueDate: r.issue, dueDate: d.dueDate, createdById: ctx.userId,
            lines: { create: p.lines.map((l, i) => ({ feeItemId: l.feeItemId, kind: l.kind, description: l.description, amount: decimalOf(l.amount), createdById: ctx.userId, sortOrder: i })) },
          },
        });
      });
      created++;
      billed += p.total;
    } catch (e) {
      if (isUnique(e)) raced++; // another request billed this student at the same moment
      else throw e;
    }
  }
  await writeAudit(db, actorOf(ctx), { action: "invoice.generate", entityType: "Term", entityId: r.term.id, summary: r.term.name, changes: { created, billedCents: billed, alreadyInvoiced: r.alreadyInvoiced + raced, noStructure: r.noStructure, classId: d.classId ?? null } });
  return { created, billedCents: billed, alreadyInvoiced: r.alreadyInvoiced + raced, notEnrolled: r.notEnrolled, noStructure: r.noStructure };
}

// ───────────────────────── One-off invoices ─────────────────────────

/** "Description | amount" per line. */
export function parseChargeLines(raw: string): { description: string; amount: number }[] {
  const out: { description: string; amount: number }[] = [];
  const errors: string[] = [];
  raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
    const at = line.lastIndexOf("|");
    const description = at < 0 ? "" : line.slice(0, at).trim();
    const amount = at < 0 ? null : parseAmount(line.slice(at + 1).trim());
    if (!description || amount === null || amount <= 0) errors.push(`Line ${i + 1}: use  Description | amount`);
    else out.push({ description, amount });
  });
  if (errors.length) throw invalid("Please correct the highlighted fields.", { lines: errors[0]! });
  if (!out.length) throw invalid("Please correct the highlighted fields.", { lines: "Add at least one charge" });
  if (out.length > 30) throw invalid("Please correct the highlighted fields.", { lines: "At most 30 lines" });
  return out;
}

/** "yyyy-mm-dd | amount" per line. */
export function parseInstalmentLines(raw: string): { dueDate: string; amount: string }[] {
  const out: { dueDate: string; amount: string }[] = [];
  raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
    const [d, a, ...rest] = line.split("|").map((x) => x.trim());
    if (!d || !a || rest.length || !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw invalid("Please correct the highlighted fields.", { items: `Line ${i + 1}: use  yyyy-mm-dd | amount` });
    out.push({ dueDate: d, amount: a });
  });
  return out;
}

const otherSchema = z.object({ studentId: uuid(), lines: z.string().min(1, "Add at least one charge"), issueDate: optDateOnly(), dueDate: dateOnly(), notes: optText(300) });

export async function createOtherInvoice(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "invoice.generate");
  const d = parse(otherSchema, input);
  const lines = parseChargeLines(d.lines);
  const student = await db.student.findFirst({ where: { id: d.studentId, schoolId: ctx.schoolId }, select: { id: true, firstName: true, lastName: true } });
  if (!student) throw notFound("Student");
  const issue = d.issueDate ?? (await schoolDateAsDate(db, ctx.schoolId));
  if (d.dueDate < issue) throw invalid("Please correct the highlighted fields.", { dueDate: "The due date cannot be before the issue date" });
  const year = await db.academicYear.findFirst({ where: { schoolId: ctx.schoolId, startsOn: { lte: issue }, endsOn: { gte: issue } } });
  if (!year) throw invalid("Please correct the highlighted fields.", { issueDate: "No academic year covers this date" });
  return db.$transaction(async (tx) => {
    const number = await allocateNumber(tx, ctx.schoolId, "INV", Number(formatDateOnly(issue).slice(0, 4)));
    const inv = await tx.invoice.create({
      data: {
        schoolId: ctx.schoolId, studentId: student.id, academicYearId: year.id, number, type: "OTHER", issueDate: issue, dueDate: d.dueDate, notes: d.notes ?? null, createdById: ctx.userId,
        lines: { create: lines.map((l, i) => ({ kind: "CHARGE" as const, description: l.description, amount: decimalOf(l.amount), createdById: ctx.userId, sortOrder: i })) },
      },
    });
    await writeAudit(tx, actorOf(ctx), { action: "invoice.create_other", entityType: "Invoice", entityId: inv.id, summary: `${number} · ${student.firstName} ${student.lastName}`, changes: { totalCents: lines.reduce((n, l) => n + l.amount, 0) } });
    return inv;
  });
}

// ───────────────────────── Adjust, instalments, void ─────────────────────────

const adjustSchema = z.object({ kind: z.enum(["CHARGE", "DISCOUNT"]), description: text(120), amount: positiveAmount("Amount"), reason: text(300) });

/** Appends a line to an issued invoice. Existing lines are never edited. A discount can never take the total below zero. */
export async function addInvoiceLine(ctx: AuthContext, invoiceId: string, input: unknown) {
  requirePermission(ctx, "invoice.adjust");
  const d = parse(adjustSchema, input);
  await db.$transaction(async (tx) => {
    const inv = await tx.invoice.findFirst({ where: { id: invoiceId, schoolId: ctx.schoolId }, include: { lines: { select: { kind: true, amount: true } } } });
    if (!inv) throw notFound("Invoice");
    if (inv.status !== "ISSUED") throw conflict("A void invoice cannot be adjusted.");
    const total = inv.lines.reduce((n, l) => n + (l.kind === "CHARGE" ? centsOf(l.amount) : -centsOf(l.amount)), 0);
    if (d.kind === "DISCOUNT" && d.amount > total) throw invalid("Please correct the highlighted fields.", { amount: `A discount cannot be more than the invoice total (${formatMoney(total)})` });
    await tx.invoiceLine.create({ data: { invoiceId, kind: d.kind, description: d.description, amount: decimalOf(d.amount), reason: d.reason, createdById: ctx.userId, sortOrder: 1000 + inv.lines.length } });
    await writeAudit(tx, actorOf(ctx), { action: "invoice.adjust", entityType: "Invoice", entityId: invoiceId, summary: inv.number, reason: d.reason, changes: { kind: d.kind, amountCents: d.amount, description: d.description, totalBeforeCents: total } });
  });
}

const instalmentSchema = z.object({ items: z.array(z.object({ dueDate: dateOnly(), amount: positiveAmount("Amount") })).min(1, "Add at least one instalment").max(12) });

/** Replaces the payment schedule. The instalments must add up exactly to the invoice total. */
export async function setInstalments(ctx: AuthContext, invoiceId: string, input: unknown) {
  requirePermission(ctx, "invoice.generate");
  const d = parse(instalmentSchema, input);
  await db.$transaction(async (tx) => {
    const inv = await tx.invoice.findFirst({ where: { id: invoiceId, schoolId: ctx.schoolId }, include: { lines: { select: { kind: true, amount: true } } } });
    if (!inv) throw notFound("Invoice");
    if (inv.status !== "ISSUED") throw conflict("A void invoice cannot have instalments.");
    const total = inv.lines.reduce((n, l) => n + (l.kind === "CHARGE" ? centsOf(l.amount) : -centsOf(l.amount)), 0);
    const sum = d.items.reduce((n, i) => n + i.amount, 0);
    if (sum !== total) throw invalid("Please correct the highlighted fields.", { items: `The instalments add up to ${formatMoney(sum)} but the invoice total is ${formatMoney(total)}` });
    if (d.items.some((i) => i.dueDate < inv.issueDate)) throw invalid("Please correct the highlighted fields.", { items: "An instalment cannot be due before the invoice was issued" });
    const ordered = [...d.items].sort((a, b) => +a.dueDate - +b.dueDate);
    await tx.invoiceInstalment.deleteMany({ where: { invoiceId } });
    await tx.invoiceInstalment.createMany({ data: ordered.map((i, n) => ({ invoiceId, sequence: n + 1, dueDate: i.dueDate, amount: decimalOf(i.amount) })) });
    await writeAudit(tx, actorOf(ctx), { action: "invoice.instalments", entityType: "Invoice", entityId: invoiceId, summary: inv.number, changes: { count: ordered.length, totalCents: total } });
  });
}

const voidSchema = z.object({ reason: text(300) });

/** Voiding keeps the invoice and its lines for the record. Payments that were aimed at it stay posted and become credit. */
export async function voidInvoice(ctx: AuthContext, invoiceId: string, input: unknown) {
  requirePermission(ctx, "invoice.void");
  const { reason } = parse(voidSchema, input);
  await db.$transaction(async (tx) => {
    const inv = await tx.invoice.findFirst({ where: { id: invoiceId, schoolId: ctx.schoolId } });
    if (!inv) throw notFound("Invoice");
    if (inv.status === "VOID") throw conflict("This invoice is already void.");
    const aimed = await tx.payment.aggregate({ where: { schoolId: ctx.schoolId, targetInvoiceId: invoiceId, status: "POSTED" }, _sum: { amount: true } });
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: "VOID", voidedAt: new Date(), voidedById: ctx.userId, voidReason: reason } });
    await writeAudit(tx, actorOf(ctx), { action: "invoice.void", entityType: "Invoice", entityId: invoiceId, summary: inv.number, reason, changes: { paymentsAimedAtItCents: centsOf(aimed._sum.amount) } });
  });
}

// ───────────────────────── Reading ─────────────────────────

export type InvoiceRow = {
  id: string; number: string; type: "TERM_FEES" | "OTHER"; status: "ISSUED" | "VOID"; studentId: string; studentName: string; admissionNo: string; className: string | null;
  termName: string | null; issueDate: string; dueDate: string; balance: InvoiceBalance | null;
};

export type InvoiceFilter = { termId?: string; classId?: string; studentId?: string; state?: "UNPAID" | "PARTIAL" | "PAID" | "NO_CHARGE" | "OVERDUE" | "VOID"; q?: string; page?: number };

export async function listInvoices(ctx: AuthContext, f: InvoiceFilter = {}) {
  requirePermission(ctx, "fees.read");
  const pageSize = 25;
  const page = Math.max(1, f.page ?? 1);
  const q = f.q?.trim();
  const matchingStudents = q
    ? (await db.student.findMany({ where: { schoolId: ctx.schoolId, OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { admissionNo: { contains: q, mode: "insensitive" } }] }, select: { id: true }, take: 2000 })).map((s) => s.id)
    : [];
  const rows = await db.invoice.findMany({
    where: {
      schoolId: ctx.schoolId, ...(f.termId ? { termId: f.termId } : {}), ...(f.classId ? { classId: f.classId } : {}), ...(f.studentId ? { studentId: f.studentId } : {}),
      status: f.state === "VOID" ? "VOID" : "ISSUED",
      ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { studentId: { in: matchingStudents } }] } : {}),
    },
    orderBy: [{ issueDate: "desc" }, { number: "desc" }],
    take: 6000,
  });
  const studentIds = [...new Set(rows.map((r) => r.studentId))];
  const [students, finance, classes, terms] = await Promise.all([
    db.student.findMany({ where: { schoolId: ctx.schoolId, id: { in: studentIds } }, select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true } }),
    loadFinance(db, ctx.schoolId, studentIds),
    db.schoolClass.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true } }),
    db.term.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true } }),
  ]);
  const stu = new Map(students.map((s) => [s.id, s]));
  const cls = new Map(classes.map((c) => [c.id, c.name]));
  const trm = new Map(terms.map((t) => [t.id, t.name]));
  let out: InvoiceRow[] = rows.map((r) => {
    const s = stu.get(r.studentId);
    return {
      id: r.id, number: r.number, type: r.type, status: r.status, studentId: r.studentId, studentName: s ? [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ") : "—", admissionNo: s?.admissionNo ?? "",
      className: r.classId ? (cls.get(r.classId) ?? null) : null, termName: r.termId ? (trm.get(r.termId) ?? null) : null,
      issueDate: formatDateOnly(r.issueDate), dueDate: formatDateOnly(r.dueDate), balance: r.status === "ISSUED" ? (finance.get(r.studentId)?.ledger.invoices.get(r.id) ?? null) : null,
    };
  });
  if (f.state && f.state !== "VOID") out = out.filter((o) => (f.state === "OVERDUE" ? (o.balance?.overdueAmount ?? 0) > 0 : o.balance?.state === f.state));
  const total = out.length;
  return { items: out.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize };
}

export async function getInvoice(ctx: AuthContext, id: string) {
  requirePermission(ctx, "fees.read");
  const inv = await db.invoice.findFirst({ where: { id, schoolId: ctx.schoolId }, include: { lines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }, instalments: { orderBy: { sequence: "asc" } } } });
  if (!inv) throw notFound("Invoice");
  const [student, finance, term, cls, payments] = await Promise.all([
    db.student.findUniqueOrThrow({ where: { id: inv.studentId }, select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true } }),
    inv.status === "ISSUED" ? loadStudentFinance(db, ctx.schoolId, inv.studentId) : null,
    inv.termId ? db.term.findUnique({ where: { id: inv.termId }, select: { name: true } }) : null,
    inv.classId ? db.schoolClass.findUnique({ where: { id: inv.classId }, select: { name: true } }) : null,
    db.payment.findMany({ where: { schoolId: ctx.schoolId, targetInvoiceId: id }, select: { id: true, amount: true, receivedOn: true, status: true } }),
  ]);
  const charges = inv.lines.filter((l) => l.kind === "CHARGE").reduce((n, l) => n + centsOf(l.amount), 0);
  const discounts = inv.lines.filter((l) => l.kind === "DISCOUNT").reduce((n, l) => n + centsOf(l.amount), 0);
  return {
    invoice: inv, student, termName: term?.name ?? null, className: cls?.name ?? null,
    charges, discounts, total: charges - discounts,
    balance: finance?.ledger.invoices.get(id) ?? null, credit: finance?.ledger.credit ?? 0, aimedPayments: payments,
  };
}

export async function getStudentStatement(ctx: AuthContext, studentId: string) {
  requirePermission(ctx, "fees.read");
  const student = await db.student.findFirst({ where: { id: studentId, schoolId: ctx.schoolId }, select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true, status: true } });
  if (!student) throw notFound("Student");
  const [finance, invoices, payments, refunds] = await Promise.all([
    loadStudentFinance(db, ctx.schoolId, studentId),
    db.invoice.findMany({ where: { schoolId: ctx.schoolId, studentId }, orderBy: [{ issueDate: "desc" }, { number: "desc" }], include: { lines: { select: { kind: true, amount: true } } } }),
    db.payment.findMany({ where: { schoolId: ctx.schoolId, studentId }, orderBy: [{ receivedOn: "desc" }, { createdAt: "desc" }], include: { receipt: { select: { number: true, voidedAt: true } } } }),
    db.refund.findMany({ where: { schoolId: ctx.schoolId, studentId }, orderBy: { requestedAt: "desc" } }),
  ]);
  return {
    student, ledger: finance.ledger,
    invoices: invoices.map((i) => ({ ...i, total: i.lines.reduce((n, l) => n + (l.kind === "CHARGE" ? centsOf(l.amount) : -centsOf(l.amount)), 0), balance: finance.ledger.invoices.get(i.id) ?? null })),
    payments, refunds,
  };
}

