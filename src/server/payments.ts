import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { formatDateOnly } from "@/lib/dates";
import { centsOf, decimalOf, formatMoney, positiveAmount } from "@/lib/finance/money";
import { actorOf, writeAudit, type AuditActor } from "@/server/audit";
import { ACTIVE_REFUND, loadStudentFinance, lockStudentFinance, schoolToday } from "@/server/balances";
import { allocateNumber } from "@/server/invoices";
import { optDateOnly, optText, optUuid, parse, text, uuid } from "@/lib/validation";

const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";
const METHODS = ["CASH", "BANK", "MOBILE_MONEY", "OTHER"] as const;
export type Method = (typeof METHODS)[number];

export type ReceiptSnapshot = {
  number: string;
  issuedAt: string;
  school: { name: string; motto: string | null; address: string | null; phone: string | null; email: string | null };
  student: { id: string; name: string; admissionNo: string };
  payer: string | null;
  currency: string;
  amountCents: number;
  method: Method;
  provider: string | null;
  reference: string | null;
  receivedOn: string;
  appliedTo: { number: string; amountCents: number }[];
  creditAddedCents: number;
  outstandingBeforeCents: number;
  outstandingAfterCents: number;
};

// ───────────────────────── Posting (shared by manual entry, provider webhooks and reconciliation) ─────────────────────────

export type PostArgs = {
  schoolId: string;
  actor: AuditActor;
  createdById: string | null;
  studentId: string;
  amountCents: number;
  method: Method;
  provider?: string | null;
  reference?: string | null;
  receivedOn: Date;
  payerName?: string | null;
  notes?: string | null;
  targetInvoiceId?: string | null;
  source: "MANUAL" | "PROVIDER";
  idempotencyKey?: string | null;
  auditExtra?: Record<string, unknown>;
};

/** Creates the payment and its receipt in the caller's transaction. Serialised per student. */
export async function postPaymentTx(tx: Tx, a: PostArgs) {
  await lockStudentFinance(tx, a.studentId);
  const student = await tx.student.findFirst({ where: { id: a.studentId, schoolId: a.schoolId }, select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true } });
  if (!student) throw notFound("Student");
  if (a.targetInvoiceId) {
    const inv = await tx.invoice.findFirst({ where: { id: a.targetInvoiceId, schoolId: a.schoolId, studentId: a.studentId, status: "ISSUED" }, select: { id: true } });
    if (!inv) throw invalid("Please correct the highlighted fields.", { targetInvoiceId: "Choose one of this student's open invoices" });
  }
  const today = await schoolToday(tx, a.schoolId);
  if (formatDateOnly(a.receivedOn) > today) throw invalid("Please correct the highlighted fields.", { receivedOn: "The date cannot be in the future" });

  const before = await loadStudentFinance(tx, a.schoolId, a.studentId, today);
  const payment = await tx.payment.create({
    data: {
      schoolId: a.schoolId, studentId: a.studentId, targetInvoiceId: a.targetInvoiceId ?? null, method: a.method, provider: a.provider ?? null, reference: a.reference ?? null,
      amount: decimalOf(a.amountCents), receivedOn: a.receivedOn, payerName: a.payerName ?? null, notes: a.notes ?? null, source: a.source, idempotencyKey: a.idempotencyKey ?? null, createdById: a.createdById,
    },
  });
  const after = await loadStudentFinance(tx, a.schoolId, a.studentId, today);
  const school = await tx.school.findUniqueOrThrow({ where: { id: a.schoolId }, select: { name: true, motto: true, address: true, phone: true, email: true, currency: true } });
  const number = await allocateNumber(tx, a.schoolId, "RCT", Number(today.slice(0, 4)));
  const appliedTo = [...after.ledger.invoices.values()]
    .map((b) => ({ number: after.invoices.find((i) => i.id === b.id)!.number, amountCents: b.paid - (before.ledger.invoices.get(b.id)?.paid ?? 0) }))
    .filter((x) => x.amountCents > 0);
  const snapshot: ReceiptSnapshot = {
    number, issuedAt: new Date().toISOString(), school: { name: school.name, motto: school.motto, address: school.address, phone: school.phone, email: school.email },
    student: { id: student.id, name: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" "), admissionNo: student.admissionNo },
    payer: a.payerName ?? null, currency: school.currency, amountCents: a.amountCents, method: a.method, provider: a.provider ?? null, reference: a.reference ?? null, receivedOn: formatDateOnly(a.receivedOn),
    appliedTo, creditAddedCents: Math.max(0, after.ledger.credit - before.ledger.credit), outstandingBeforeCents: before.ledger.outstanding, outstandingAfterCents: after.ledger.outstanding,
  };
  const receipt = await tx.receipt.create({ data: { schoolId: a.schoolId, paymentId: payment.id, number, issuedById: a.createdById, snapshot: snapshot as unknown as object } });
  await writeAudit(tx, a.actor, {
    action: "payment.record", entityType: "Payment", entityId: payment.id, summary: `${number} · ${student.admissionNo} · ${formatMoney(a.amountCents, school.currency)}`,
    changes: { studentId: a.studentId, amountCents: a.amountCents, method: a.method, provider: a.provider ?? null, reference: a.reference ?? null, source: a.source, ...a.auditExtra },
  });
  return { payment, receipt, snapshot };
}

// ───────────────────────── Recording ─────────────────────────

const paymentSchema = z
  .object({
    studentId: uuid(),
    amount: positiveAmount("Amount"),
    method: z.enum(METHODS),
    receivedOn: optDateOnly(),
    reference: optText(80),
    payerName: optText(120),
    notes: optText(300),
    targetInvoiceId: optUuid(),
    idempotencyKey: optText(100),
  })
  .refine((v) => v.method === "CASH" || v.method === "OTHER" || !!v.reference, { path: ["reference"], message: "Enter the bank slip number or transaction id" });

export async function recordPayment(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "payment.record");
  const d = parse(paymentSchema, input);

  const replayOf = async () => {
    if (!d.idempotencyKey) return null;
    const existing = await db.payment.findFirst({ where: { schoolId: ctx.schoolId, idempotencyKey: d.idempotencyKey }, include: { receipt: true } });
    if (!existing) return null;
    if (existing.studentId !== d.studentId || centsOf(existing.amount) !== d.amount || existing.method !== d.method) throw conflict("This form was already submitted for a different payment. Reload the page and enter the payment again.");
    return { payment: existing, receipt: existing.receipt!, replay: true as const };
  };
  const replay = await replayOf();
  if (replay) return replay;

  const receivedOn = d.receivedOn ?? new Date(`${await schoolToday(db, ctx.schoolId)}T00:00:00Z`);
  try {
    const r = await db.$transaction((tx) =>
      postPaymentTx(tx, {
        schoolId: ctx.schoolId, actor: actorOf(ctx), createdById: ctx.userId, studentId: d.studentId, amountCents: d.amount, method: d.method, reference: d.reference ?? null,
        receivedOn, payerName: d.payerName ?? null, notes: d.notes ?? null, targetInvoiceId: d.targetInvoiceId ?? null, source: "MANUAL", idempotencyKey: d.idempotencyKey ?? null,
      }),
    );
    return { payment: r.payment, receipt: r.receipt, replay: false as const };
  } catch (e) {
    if (isUnique(e)) {
      const again = await replayOf(); // a double click that raced past the first check
      if (again) return again;
      throw invalid("Please correct the highlighted fields.", { reference: "A payment with this method and reference has already been recorded" });
    }
    throw e;
  }
}

// ───────────────────────── Reversal ─────────────────────────

const reasonSchema = z.object({ reason: text(300) });

/**
 * Reverses a posted payment (recorded in error). The payment and its receipt stay on file, marked reversed/void; balances
 * are recomputed from the remaining facts. Refused if money from it has already been refunded.
 */
export async function reversePayment(ctx: AuthContext, paymentId: string, input: unknown) {
  requirePermission(ctx, "payment.reverse");
  const { reason } = parse(reasonSchema, input);
  const pre = await db.payment.findFirst({ where: { id: paymentId, schoolId: ctx.schoolId }, select: { studentId: true } });
  if (!pre) throw notFound("Payment");
  await db.$transaction(async (tx) => {
    await lockStudentFinance(tx, pre.studentId);
    const p = await tx.payment.findFirst({ where: { id: paymentId, schoolId: ctx.schoolId } });
    if (!p) throw notFound("Payment");
    if (p.status === "REVERSED") throw conflict("This payment has already been reversed.");
    const [posted, refunds] = await Promise.all([
      tx.payment.aggregate({ where: { schoolId: ctx.schoolId, studentId: p.studentId, status: "POSTED" }, _sum: { amount: true } }),
      tx.refund.aggregate({ where: { schoolId: ctx.schoolId, studentId: p.studentId, status: { in: [...ACTIVE_REFUND] } }, _sum: { amount: true } }),
    ]);
    if (centsOf(posted._sum.amount) - centsOf(p.amount) < centsOf(refunds._sum.amount)) throw conflict("Part of this money has been refunded or reserved for a refund. Reject the pending refund first; a refund that was already paid out cannot be undone here.");
    await tx.payment.update({ where: { id: paymentId }, data: { status: "REVERSED", reversedAt: new Date(), reversedById: ctx.userId, reverseReason: reason } });
    await tx.receipt.update({ where: { paymentId }, data: { voidedAt: new Date(), voidReason: reason } });
    await writeAudit(tx, actorOf(ctx), { action: "payment.reverse", entityType: "Payment", entityId: paymentId, summary: formatMoney(centsOf(p.amount)), reason, changes: { studentId: p.studentId, amountCents: centsOf(p.amount), source: p.source } });
  });
}

// ───────────────────────── Refunds ─────────────────────────

const refundSchema = z
  .object({ studentId: uuid(), amount: positiveAmount("Amount"), method: z.enum(METHODS), reason: text(300) });

/** Only money that is not applied to any invoice (credit) can be refunded. Pending and approved requests reserve their amount. */
export async function requestRefund(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "refund.request");
  const d = parse(refundSchema, input);
  return db.$transaction(async (tx) => {
    await lockStudentFinance(tx, d.studentId);
    const s = await tx.student.findFirst({ where: { id: d.studentId, schoolId: ctx.schoolId }, select: { id: true, admissionNo: true } });
    if (!s) throw notFound("Student");
    const fin = await loadStudentFinance(tx, ctx.schoolId, d.studentId);
    if (d.amount > fin.ledger.credit) throw invalid("Please correct the highlighted fields.", { amount: fin.ledger.credit > 0 ? `Only ${formatMoney(fin.ledger.credit)} of unapplied credit is available to refund` : "This student has no unapplied credit to refund" });
    const refund = await tx.refund.create({ data: { schoolId: ctx.schoolId, studentId: d.studentId, amount: decimalOf(d.amount), method: d.method, reason: d.reason, requestedById: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "refund.request", entityType: "Refund", entityId: refund.id, summary: `${s.admissionNo} · ${formatMoney(d.amount)}`, reason: d.reason, changes: { studentId: d.studentId, amountCents: d.amount } });
    return refund;
  });
}

const decisionSchema = z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: optText(300) });

export async function decideRefund(ctx: AuthContext, refundId: string, input: unknown) {
  requirePermission(ctx, "refund.approve");
  const d = parse(decisionSchema, input);
  if (d.decision === "REJECT" && !d.note) throw invalid("Please correct the highlighted fields.", { note: "Say why the request is rejected" });
  const pre = await db.refund.findFirst({ where: { id: refundId, schoolId: ctx.schoolId }, select: { studentId: true } });
  if (!pre) throw notFound("Refund");
  await db.$transaction(async (tx) => {
    await lockStudentFinance(tx, pre.studentId);
    const r = await tx.refund.findFirst({ where: { id: refundId, schoolId: ctx.schoolId } });
    if (!r) throw notFound("Refund");
    if (r.status !== "REQUESTED") throw conflict("This request has already been decided.");
    if (r.requestedById === ctx.userId) throw forbidden("You cannot decide a refund you requested yourself.");
    await tx.refund.update({ where: { id: refundId }, data: { status: d.decision === "APPROVE" ? "APPROVED" : "REJECTED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: d.note ?? null } });
    await writeAudit(tx, actorOf(ctx), { action: d.decision === "APPROVE" ? "refund.approve" : "refund.reject", entityType: "Refund", entityId: refundId, summary: formatMoney(centsOf(r.amount)), reason: d.note, changes: { studentId: r.studentId } });
  });
}

const payoutSchema = z.object({ reference: optText(80) });

/** Records that an approved refund was paid out. */
export async function payRefund(ctx: AuthContext, refundId: string, input: unknown) {
  requirePermission(ctx, "refund.request");
  const d = parse(payoutSchema, input);
  await db.$transaction(async (tx) => {
    const r = await tx.refund.findFirst({ where: { id: refundId, schoolId: ctx.schoolId } });
    if (!r) throw notFound("Refund");
    if (r.status !== "APPROVED") throw conflict("Only an approved refund can be marked as paid.");
    if (r.method !== "CASH" && r.method !== "OTHER" && !d.reference) throw invalid("Please correct the highlighted fields.", { reference: "Enter the bank or mobile-money reference of the payout" });
    await tx.refund.update({ where: { id: refundId }, data: { status: "PAID", paidAt: new Date(), paidById: ctx.userId, reference: d.reference ?? r.reference } });
    await writeAudit(tx, actorOf(ctx), { action: "refund.pay", entityType: "Refund", entityId: refundId, summary: formatMoney(centsOf(r.amount)), changes: { studentId: r.studentId, reference: d.reference ?? null } });
  });
}

export async function listRefunds(ctx: AuthContext, filter: { status?: string } = {}) {
  requirePermission(ctx, "fees.read");
  const rows = await db.refund.findMany({ where: { schoolId: ctx.schoolId, ...(filter.status ? { status: filter.status as never } : {}) }, orderBy: { requestedAt: "desc" }, take: 200 });
  const [students, users] = await Promise.all([
    db.student.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(rows.map((r) => r.studentId))] } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } }),
    db.user.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById].filter((x): x is string => !!x)))] } }, select: { id: true, fullName: true } }),
  ]);
  const su = new Map(students.map((s) => [s.id, s]));
  const uu = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((r) => ({ ...r, studentName: su.get(r.studentId) ? `${su.get(r.studentId)!.firstName} ${su.get(r.studentId)!.lastName}` : "—", admissionNo: su.get(r.studentId)?.admissionNo ?? "", requestedBy: uu.get(r.requestedById) ?? "—", decidedBy: r.decidedById ? (uu.get(r.decidedById) ?? "—") : null }));
}

// ───────────────────────── Reading ─────────────────────────

const listSchema = z.object({
  from: optDateOnly(), to: optDateOnly(), method: z.enum(METHODS).optional(), status: z.enum(["POSTED", "REVERSED"]).optional(), studentId: optUuid(), q: optText(60), page: z.coerce.number().int().min(1).default(1),
});

export async function listPayments(ctx: AuthContext, input: unknown = {}) {
  requirePermission(ctx, "fees.read");
  const f = parse(listSchema, input);
  const pageSize = 25;
  const matching = f.q ? (await db.student.findMany({ where: { schoolId: ctx.schoolId, OR: [{ firstName: { contains: f.q, mode: "insensitive" } }, { lastName: { contains: f.q, mode: "insensitive" } }, { admissionNo: { contains: f.q, mode: "insensitive" } }] }, select: { id: true }, take: 2000 })).map((s) => s.id) : null;
  const where = {
    schoolId: ctx.schoolId,
    ...(f.from || f.to ? { receivedOn: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    ...(f.method ? { method: f.method } : {}), ...(f.status ? { status: f.status } : {}), ...(f.studentId ? { studentId: f.studentId } : {}),
    ...(matching ? { OR: [{ studentId: { in: matching } }, { reference: { contains: f.q!, mode: "insensitive" as const } }, { receipt: { number: { contains: f.q!, mode: "insensitive" as const } } }] } : {}),
  };
  const [items, total, sum] = await Promise.all([
    db.payment.findMany({ where, orderBy: [{ receivedOn: "desc" }, { createdAt: "desc" }], skip: (f.page - 1) * pageSize, take: pageSize, include: { receipt: { select: { number: true, voidedAt: true } } } }),
    db.payment.count({ where }),
    db.payment.aggregate({ where: { ...where, status: "POSTED" }, _sum: { amount: true } }),
  ]);
  const students = await db.student.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(items.map((p) => p.studentId))] } }, select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true } });
  const su = new Map(students.map((s) => [s.id, s]));
  return {
    items: items.map((p) => ({ ...p, amountCents: centsOf(p.amount), studentName: su.get(p.studentId) ? [su.get(p.studentId)!.firstName, su.get(p.studentId)!.lastName].join(" ") : "—", admissionNo: su.get(p.studentId)?.admissionNo ?? "" })),
    total, page: f.page, pageSize, postedTotalCents: centsOf(sum._sum.amount),
  };
}

export async function getPayment(ctx: AuthContext, id: string) {
  requirePermission(ctx, "fees.read");
  const p = await db.payment.findFirst({ where: { id, schoolId: ctx.schoolId }, include: { receipt: true } });
  if (!p) throw notFound("Payment");
  const [student, recorder, reverser] = await Promise.all([
    db.student.findUniqueOrThrow({ where: { id: p.studentId }, select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true } }),
    p.createdById ? db.user.findUnique({ where: { id: p.createdById }, select: { fullName: true } }) : null,
    p.reversedById ? db.user.findUnique({ where: { id: p.reversedById }, select: { fullName: true } }) : null,
  ]);
  return { payment: p, amountCents: centsOf(p.amount), snapshot: p.receipt?.snapshot as unknown as ReceiptSnapshot | undefined, student, recordedBy: recorder?.fullName ?? null, reversedBy: reverser?.fullName ?? null };
}

/** For the "record payment" form: find a student by name or admission number. */
export async function findStudentsForFinance(ctx: AuthContext, q: string) {
  requirePermission(ctx, "fees.read");
  const term = q.trim();
  if (term.length < 2) return [];
  return db.student.findMany({
    where: { schoolId: ctx.schoolId, OR: [{ firstName: { contains: term, mode: "insensitive" } }, { lastName: { contains: term, mode: "insensitive" } }, { admissionNo: { contains: term, mode: "insensitive" } }] },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 15,
    select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true, status: true },
  });
}

