import { z } from "zod";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { formatDateOnly } from "@/lib/dates";
import { centsOf } from "@/lib/finance/money";
import { AGE_BUCKETS, ageing, type AgeBucket } from "@/lib/finance/ledger";
import { loadFinance, schoolToday } from "@/server/balances";
import { dateOnly, optUuid, parse, uuid } from "@/lib/validation";

/** All figures come from the balance service and posted payments. Reversed payments, void invoices and void expenses never count. */

export async function financeOverview(ctx: AuthContext, input: unknown = {}) {
  requirePermission(ctx, "finance.reports");
  const { termId } = parse(z.object({ termId: optUuid() }), input);
  const term = termId
    ? await db.term.findFirst({ where: { id: termId, schoolId: ctx.schoolId } })
    : ((await db.term.findFirst({ where: { schoolId: ctx.schoolId, isCurrent: true } })) ?? (await db.term.findFirst({ where: { schoolId: ctx.schoolId }, orderBy: { startsOn: "desc" } })));
  if (!term) return null;
  const today = await schoolToday(db, ctx.schoolId);
  const invoices = await db.invoice.findMany({ where: { schoolId: ctx.schoolId, termId: term.id, status: "ISSUED" }, select: { id: true, studentId: true } });
  const billedStudents = [...new Set(invoices.map((i) => i.studentId))];
  // Credit is school-wide: money paid by students who have no live invoice this term (or none at all) is still unapplied credit.
  const payers = (await db.payment.findMany({ where: { schoolId: ctx.schoolId, status: "POSTED" }, distinct: ["studentId"], select: { studentId: true } })).map((p) => p.studentId);
  const studentIds = [...new Set([...billedStudents, ...payers])];
  const finance = await loadFinance(db, ctx.schoolId, studentIds, today);
  const ids = new Set(invoices.map((i) => i.id));
  let billed = 0, paid = 0, outstanding = 0, overdue = 0, noCharge = 0, unpaid = 0, partial = 0, settled = 0;
  // Instalments that fall due in the next two weeks and are not yet paid (the next payment parents should expect to make).
  const soonLimit = new Date(new Date(`${today}T00:00:00Z`).getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
  let dueSoonAmount = 0; const dueSoonStudents = new Set<string>();
  for (const [studentId, f] of finance) {
    for (const [id, b] of f.ledger.invoices) {
      if (!ids.has(id)) continue;
      billed += b.total; paid += b.paid; outstanding += b.outstanding; overdue += b.overdueAmount;
      if (b.state === "NO_CHARGE") noCharge++; else if (b.state === "UNPAID") unpaid++; else if (b.state === "PARTIAL") partial++; else settled++;
      for (const item of b.schedule) if (item.paid < item.amount && item.dueDate >= today && item.dueDate <= soonLimit) { dueSoonAmount += item.amount - item.paid; dueSoonStudents.add(studentId); }
    }
  }
  const range = { gte: term.startsOn, lte: term.endsOn };
  const dayMs = 86_400_000;
  const weekStart = new Date(new Date(`${today}T00:00:00Z`).getTime() - 6 * dayMs);
  const monthStart = new Date(`${today.slice(0, 8)}01T00:00:00Z`);
  const sumSince = async (from: Date) => centsOf((await db.payment.aggregate({ where: { schoolId: ctx.schoolId, status: "POSTED", receivedOn: { gte: from, lte: new Date(`${today}T00:00:00Z`) } }, _sum: { amount: true } }))._sum.amount);
  const [receivedToday, receivedWeek, receivedMonth, admissionVerified, admissionPending] = await Promise.all([
    sumSince(new Date(`${today}T00:00:00Z`)), sumSince(weekStart), sumSince(monthStart),
    db.admissionPayment.aggregate({ where: { schoolId: ctx.schoolId, status: "VERIFIED", verifiedAt: { gte: term.startsOn, lt: new Date(term.endsOn.getTime() + dayMs) } }, _sum: { amount: true } }),
    db.admissionPayment.aggregate({ where: { schoolId: ctx.schoolId, status: "PENDING" }, _sum: { amount: true } }),
  ]);
  const [collected, byMethod, refundsPaid, expense, credit] = await Promise.all([
    db.payment.aggregate({ where: { schoolId: ctx.schoolId, status: "POSTED", receivedOn: range }, _sum: { amount: true }, _count: true }),
    db.payment.groupBy({ by: ["method"], where: { schoolId: ctx.schoolId, status: "POSTED", receivedOn: range }, _sum: { amount: true } }),
    db.refund.aggregate({ where: { schoolId: ctx.schoolId, status: "PAID", paidAt: { gte: term.startsOn, lt: new Date(term.endsOn.getTime() + 86_400_000) } }, _sum: { amount: true } }),
    db.expense.aggregate({ where: { schoolId: ctx.schoolId, voided: false, approval: "APPROVED", spentOn: range }, _sum: { amount: true } }),
    Promise.resolve([...finance.values()].reduce((n, f) => n + f.ledger.credit, 0)),
  ]);
  const collectedC = centsOf(collected._sum.amount);
  const refundsC = centsOf(refundsPaid._sum.amount);
  const expenseC = centsOf(expense._sum.amount);
  return {
    term: { id: term.id, name: term.name }, billed, paid, outstanding, overdue, credit,
    collectionRatePct: billed > 0 ? Math.round((paid / billed) * 1000) / 10 : null,
    invoices: { total: invoices.length, noCharge, unpaid, partial, paid: settled },
    collected: collectedC, payments: collected._count, byMethod: byMethod.map((m) => ({ method: m.method, cents: centsOf(m._sum.amount) })),
    refundsPaid: refundsC, expenses: expenseC, net: collectedC - refundsC - expenseC,
    received: { today: receivedToday, week: receivedWeek, month: receivedMonth },
    dueSoon: { amount: dueSoonAmount, students: dueSoonStudents.size },
    // Admission fees are paid by applicants and kept apart from school fees; they join only the cash position below.
    admissionFees: { verified: centsOf(admissionVerified._sum.amount), pending: centsOf(admissionPending._sum.amount) },
    netOperating: collectedC + centsOf(admissionVerified._sum.amount) - refundsC - expenseC,
  };
}

const arrearsSchema = z.object({ termId: optUuid(), classId: optUuid() });

export async function arrearsReport(ctx: AuthContext, input: unknown = {}) {
  requirePermission(ctx, "finance.reports");
  const f = parse(arrearsSchema, input);
  const today = await schoolToday(db, ctx.schoolId);
  const invoices = await db.invoice.findMany({ where: { schoolId: ctx.schoolId, status: "ISSUED", ...(f.termId ? { termId: f.termId } : {}), ...(f.classId ? { classId: f.classId } : {}) }, select: { id: true, studentId: true, classId: true }, take: 20000 });
  const studentIds = [...new Set(invoices.map((i) => i.studentId))];
  const finance = await loadFinance(db, ctx.schoolId, studentIds, today);
  const included = new Set(invoices.map((i) => i.id));
  const showContacts = ctx.permissions.has("student.guardians.read");
  const [students, classes, links] = await Promise.all([
    db.student.findMany({ where: { schoolId: ctx.schoolId, id: { in: studentIds } }, select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true } }),
    db.schoolClass.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true } }),
    showContacts ? db.studentGuardian.findMany({ where: { schoolId: ctx.schoolId, studentId: { in: studentIds }, isPrimary: true }, include: { guardian: { select: { fullName: true, phone: true } } } }) : [],
  ]);
  const su = new Map(students.map((s) => [s.id, s]));
  const cn = new Map(classes.map((c) => [c.id, c.name]));
  const contact = new Map(links.map((l) => [l.studentId, l.guardian]));
  const classOf = new Map(invoices.map((i) => [i.studentId, i.classId]));
  const rows = [];
  const totals: Record<AgeBucket, number> = { "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  let outstandingTotal = 0, overdueTotal = 0;
  for (const [studentId, fin] of finance) {
    const bals = [...fin.ledger.invoices.values()].filter((b) => included.has(b.id));
    const outstanding = bals.reduce((n, b) => n + b.outstanding, 0);
    if (outstanding <= 0) continue;
    const overdue = bals.reduce((n, b) => n + b.overdueAmount, 0);
    const age = ageing(bals, today);
    for (const k of AGE_BUCKETS) totals[k] += age[k];
    outstandingTotal += outstanding; overdueTotal += overdue;
    const s = su.get(studentId);
    const oldest = bals.flatMap((b) => b.overdue.map((o) => o.dueDate)).sort()[0] ?? null;
    rows.push({
      studentId, name: s ? [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ") : "—", admissionNo: s?.admissionNo ?? "", className: classOf.get(studentId) ? (cn.get(classOf.get(studentId)!) ?? null) : null,
      outstanding, overdue, oldestDue: oldest, ageing: age, credit: fin.ledger.credit,
      guardian: contact.get(studentId)?.fullName ?? null, phone: contact.get(studentId)?.phone ?? null,
    });
  }
  rows.sort((a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding || a.name.localeCompare(b.name));
  return { asOf: today, rows, totals, outstandingTotal, overdueTotal, studentsOwing: rows.length };
}

const rangeSchema = z.object({ from: dateOnly(), to: dateOnly() }).refine((v) => v.from <= v.to, { path: ["to"], message: "End date must not be before the start date" });

export async function collectionsReport(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "finance.reports");
  const r = parse(rangeSchema, input);
  const where = { schoolId: ctx.schoolId, receivedOn: { gte: r.from, lte: r.to } };
  const [posted, reversed, byMethod, days, refunds] = await Promise.all([
    db.payment.aggregate({ where: { ...where, status: "POSTED" }, _sum: { amount: true }, _count: true }),
    db.payment.aggregate({ where: { ...where, status: "REVERSED" }, _sum: { amount: true }, _count: true }),
    db.payment.groupBy({ by: ["method"], where: { ...where, status: "POSTED" }, _sum: { amount: true }, _count: true }),
    db.payment.groupBy({ by: ["receivedOn"], where: { ...where, status: "POSTED" }, _sum: { amount: true }, _count: true, orderBy: { receivedOn: "asc" } }),
    db.refund.aggregate({ where: { schoolId: ctx.schoolId, status: "PAID", paidAt: { gte: r.from, lt: new Date(r.to.getTime() + 86_400_000) } }, _sum: { amount: true } }),
  ]);
  return {
    from: formatDateOnly(r.from), to: formatDateOnly(r.to),
    collected: centsOf(posted._sum.amount), count: posted._count, reversed: centsOf(reversed._sum.amount), reversedCount: reversed._count, refundsPaid: centsOf(refunds._sum.amount),
    net: centsOf(posted._sum.amount) - centsOf(refunds._sum.amount),
    byMethod: byMethod.map((m) => ({ method: m.method, cents: centsOf(m._sum.amount), count: m._count })),
    byDay: days.map((d) => ({ date: formatDateOnly(d.receivedOn), cents: centsOf(d._sum.amount), count: d._count })),
  };
}

export async function classCollectionReport(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "finance.reports");
  const { termId } = parse(z.object({ termId: uuid() }), input);
  const term = await db.term.findFirst({ where: { id: termId, schoolId: ctx.schoolId } });
  if (!term) throw notFound("Term");
  const invoices = await db.invoice.findMany({ where: { schoolId: ctx.schoolId, termId, status: "ISSUED" }, select: { id: true, studentId: true, classId: true } });
  const finance = await loadFinance(db, ctx.schoolId, [...new Set(invoices.map((i) => i.studentId))]);
  const classes = await db.schoolClass.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } });
  const by = new Map<string, { billed: number; paid: number; outstanding: number; students: Set<string> }>();
  for (const i of invoices) {
    const b = finance.get(i.studentId)?.ledger.invoices.get(i.id);
    if (!b || !i.classId) continue;
    const row = by.get(i.classId) ?? by.set(i.classId, { billed: 0, paid: 0, outstanding: 0, students: new Set() }).get(i.classId)!;
    row.billed += b.total; row.paid += b.paid; row.outstanding += b.outstanding; row.students.add(i.studentId);
  }
  return classes.filter((c) => by.has(c.id)).map((c) => {
    const r = by.get(c.id)!;
    return { classId: c.id, className: c.name, students: r.students.size, billed: r.billed, paid: r.paid, outstanding: r.outstanding, ratePct: r.billed > 0 ? Math.round((r.paid / r.billed) * 1000) / 10 : null };
  });
}

export async function expensesReport(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "finance.reports");
  const r = parse(rangeSchema, input);
  const rows = await db.expense.groupBy({ by: ["categoryId"], where: { schoolId: ctx.schoolId, voided: false, approval: "APPROVED", spentOn: { gte: r.from, lte: r.to } }, _sum: { amount: true }, _count: true });
  const cats = await db.expenseCategory.findMany({ where: { schoolId: ctx.schoolId, id: { in: rows.map((x) => x.categoryId) } }, select: { id: true, name: true } });
  const out = rows.map((x) => ({ category: cats.find((c) => c.id === x.categoryId)?.name ?? "—", cents: centsOf(x._sum.amount), count: x._count })).sort((a, b) => b.cents - a.cents);
  return { from: formatDateOnly(r.from), to: formatDateOnly(r.to), rows: out, total: out.reduce((n, x) => n + x.cents, 0) };
}
