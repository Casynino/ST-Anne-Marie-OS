import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { centsOf } from "@/lib/finance/money";
import { parse } from "@/lib/validation";
import { schoolToday } from "@/server/balances";
import { financeOverview } from "@/server/finance-reports";
import { getApprovalLimits } from "@/server/approval-limits";
import { TASK_DEPARTMENTS } from "@/server/workflow";

/**
 * The owner's view of the school (needs `executive.read`): money for a chosen period, the school's size and staffing, how each
 * department is keeping up with the work that is handed to it, and the few things that genuinely need the owner. Everything is read from
 * the records the departments keep; nothing is entered here, and nothing here lets the owner (or anyone) do a department's daily work.
 * Fee balances (billed, owed, overdue) come from the one finance calculation (`financeOverview`), never added up again here.
 */

export type Period = "term" | "month" | "year";
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const startOfDay = (s: string) => new Date(`${s}T00:00:00Z`);

export type DeptRow = {
  department: (typeof TASK_DEPARTMENTS)[number];
  open: number; inProgress: number; overdue: number; unassigned: number;
  completed30: number; onTimePct: number | null; avgDays: number | null;
  /** The longest-waiting overdue task: what it is, how many days late, and who holds it (null = nobody assigned). */
  oldest: { label: string; daysLate: number; assignedTo: string | null } | null;
  /** The people holding the most overdue work in this department. */
  responsible: { name: string; overdue: number }[];
};

export async function executiveOverview(ctx: AuthContext, input: unknown = {}) {
  requirePermission(ctx, "executive.read");
  const { period } = parse(z.object({ period: z.enum(["term", "month", "year"]).default("term") }), input);
  const today = await schoolToday(db, ctx.schoolId);
  const todayD = startOfDay(today);
  const term = (await db.term.findFirst({ where: { schoolId: ctx.schoolId, isCurrent: true } })) ?? (await db.term.findFirst({ where: { schoolId: ctx.schoolId }, orderBy: { startsOn: "desc" } }));
  const year = term ? await db.academicYear.findFirst({ where: { id: term.academicYearId, schoolId: ctx.schoolId } }) : null;
  const from = period === "month" ? startOfDay(`${today.slice(0, 8)}01`) : period === "year" && year ? year.startsOn : term ? term.startsOn : startOfDay(`${today.slice(0, 4)}-01-01`);
  const to = period === "month" ? todayD : period === "year" && year ? year.endsOn : term ? term.endsOn : todayD;
  const toEnd = new Date(to.getTime() + DAY);

  const [fee, limits] = await Promise.all([financeOverview(ctx, term ? { termId: term.id } : {}).catch(() => null), getApprovalLimits(db, ctx.schoolId)]);

  // ── Money in the chosen period ──
  const [pay, admissionFees, applicationFees, refunds, expenses, expenseRows, payRows, reversed, pendingAdmission, unmatched, notSuccessful] = await Promise.all([
    db.payment.aggregate({ where: { schoolId: ctx.schoolId, status: "POSTED", receivedOn: { gte: from, lte: to } }, _sum: { amount: true }, _count: true }),
    db.admissionPayment.aggregate({ where: { schoolId: ctx.schoolId, status: "VERIFIED", verifiedAt: { gte: from, lt: toEnd } }, _sum: { amount: true } }),
    db.applicationDraft.aggregate({ where: { schoolId: ctx.schoolId, paidAt: { gte: from, lt: toEnd } }, _sum: { paidAmount: true } }),
    db.refund.aggregate({ where: { schoolId: ctx.schoolId, status: "PAID", paidAt: { gte: from, lt: toEnd } }, _sum: { amount: true } }),
    db.expense.aggregate({ where: { schoolId: ctx.schoolId, voided: false, approval: "APPROVED", spentOn: { gte: from, lte: to } }, _sum: { amount: true } }),
    db.expense.findMany({ where: { schoolId: ctx.schoolId, voided: false, approval: "APPROVED", spentOn: { gte: from, lte: to } }, select: { amount: true, spentOn: true, category: { select: { name: true } } } }),
    db.payment.findMany({ where: { schoolId: ctx.schoolId, status: "POSTED", receivedOn: { gte: from, lte: to } }, select: { amount: true, receivedOn: true, method: true } }),
    db.payment.aggregate({ where: { schoolId: ctx.schoolId, status: "REVERSED", receivedOn: { gte: from, lte: to } }, _sum: { amount: true }, _count: true }),
    db.admissionPayment.aggregate({ where: { schoolId: ctx.schoolId, status: "PENDING" }, _sum: { amount: true }, _count: true }),
    db.paymentEvent.aggregate({ where: { schoolId: ctx.schoolId, status: "UNMATCHED" }, _sum: { amount: true }, _count: true }),
    db.paymentEvent.count({ where: { schoolId: ctx.schoolId, status: "NOT_SUCCESSFUL", receivedAt: { gte: from, lt: toEnd } } }),
  ]);
  const feesIncome = centsOf(pay._sum.amount);
  const income = feesIncome + centsOf(admissionFees._sum.amount) + centsOf(applicationFees._sum.paidAmount);
  const refundsPaid = centsOf(refunds._sum.amount);
  const expensesTotal = centsOf(expenses._sum.amount);

  // By month: money in and money out, so a trend is a real series (empty months are zero, not missing).
  const months: string[] = [];
  for (let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); d <= to; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) months.push(iso(d).slice(0, 7));
  const inBy = new Map(months.map((m) => [m, 0])), outBy = new Map(months.map((m) => [m, 0]));
  for (const p of payRows) inBy.set(iso(p.receivedOn).slice(0, 7), (inBy.get(iso(p.receivedOn).slice(0, 7)) ?? 0) + centsOf(p.amount));
  for (const e of expenseRows) outBy.set(iso(e.spentOn).slice(0, 7), (outBy.get(iso(e.spentOn).slice(0, 7)) ?? 0) + centsOf(e.amount));
  const byCategory = new Map<string, number>();
  for (const e of expenseRows) byCategory.set(e.category.name, (byCategory.get(e.category.name) ?? 0) + centsOf(e.amount));
  const byMethod = new Map<string, number>();
  for (const p of payRows) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + centsOf(p.amount));

  // Each term of the school year side by side (collected and spent; the bill itself is only worked out for the current term).
  const yearTerms = year ? await db.term.findMany({ where: { schoolId: ctx.schoolId, academicYearId: year.id }, orderBy: { sequence: "asc" } }) : [];
  const termRows = await Promise.all(yearTerms.map(async (tm) => {
    const [c, x] = await Promise.all([
      db.payment.aggregate({ where: { schoolId: ctx.schoolId, status: "POSTED", receivedOn: { gte: tm.startsOn, lte: tm.endsOn } }, _sum: { amount: true } }),
      db.expense.aggregate({ where: { schoolId: ctx.schoolId, voided: false, approval: "APPROVED", spentOn: { gte: tm.startsOn, lte: tm.endsOn } }, _sum: { amount: true } }),
    ]);
    return { id: tm.id, name: tm.name, current: tm.id === term?.id, collected: centsOf(c._sum.amount), expenses: centsOf(x._sum.amount) };
  }));

  // ── The school ──
  const [students, newStudents, applications, staff, teachers] = await Promise.all([
    db.student.count({ where: { schoolId: ctx.schoolId, status: "ENROLLED" } }),
    db.student.count({ where: { schoolId: ctx.schoolId, createdAt: { gte: from, lt: toEnd } } }),
    db.application.count({ where: { schoolId: ctx.schoolId, createdAt: { gte: from, lt: toEnd } } }),
    db.user.count({ where: { schoolId: ctx.schoolId, type: "STAFF", status: "ACTIVE" } }),
    db.user.count({ where: { schoolId: ctx.schoolId, type: "STAFF", status: "ACTIVE", roles: { some: { role: { key: { in: ["class_teacher", "subject_teacher"] } } } } } }),
  ]);

  // ── Departments: how the work handed to each one is going (last 30 days for what was finished) ──
  const since = new Date(todayD.getTime() - 30 * DAY);
  const [openTasks, doneTasks] = await Promise.all([
    db.workflowTask.findMany({ where: { schoolId: ctx.schoolId, status: { in: ["PENDING", "IN_PROGRESS"] } }, select: { department: true, status: true, dueOn: true, relatedLabel: true, kind: true, assignedToId: true } }),
    db.workflowTask.findMany({ where: { schoolId: ctx.schoolId, status: "COMPLETED", completedAt: { gte: since } }, select: { department: true, createdAt: true, dueOn: true, completedAt: true } }),
  ]);
  const people = await db.user.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(openTasks.map((t) => t.assignedToId).filter((x): x is string => !!x))] } }, select: { id: true, fullName: true } });
  const nameOf = (id: string | null) => (id ? (people.find((p) => p.id === id)?.fullName ?? null) : null);
  const departments: DeptRow[] = TASK_DEPARTMENTS.map((department) => {
    const open = openTasks.filter((t) => t.department === department);
    const overdue = open.filter((t) => t.dueOn && t.dueOn < todayD).sort((a, b) => a.dueOn!.getTime() - b.dueOn!.getTime());
    const done = doneTasks.filter((t) => t.department === department);
    const dated = done.filter((t) => t.dueOn);
    const onTime = dated.filter((t) => iso(t.completedAt!) <= iso(t.dueOn!)).length;
    const days = done.map((t) => (t.completedAt!.getTime() - t.createdAt.getTime()) / DAY);
    const held = new Map<string, number>();
    for (const t of overdue) held.set(t.assignedToId ?? "", (held.get(t.assignedToId ?? "") ?? 0) + 1);
    const top = overdue[0];
    return {
      department, open: open.length, inProgress: open.filter((t) => t.status === "IN_PROGRESS").length, overdue: overdue.length, unassigned: open.filter((t) => !t.assignedToId).length,
      completed30: done.length, onTimePct: dated.length > 0 ? Math.round((onTime / dated.length) * 100) : null, avgDays: days.length > 0 ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
      oldest: top ? { label: top.relatedLabel ?? top.kind, daysLate: Math.round((todayD.getTime() - top.dueOn!.getTime()) / DAY), assignedTo: nameOf(top.assignedToId) } : null,
      responsible: [...held.entries()].filter(([id]) => id).map(([id, n]) => ({ name: nameOf(id) ?? "—", overdue: n })).sort((a, b) => b.overdue - a.overdue).slice(0, 3),
    };
  });

  // ── What needs the owner: only what is reserved for the owner, discrepancies, and departments that are falling behind ──
  const [bigExpenses, bigRefunds, pendingExpenses, pendingRefunds, recruitment] = await Promise.all([
    limits.expenseOwnerAboveCents > 0 ? db.expense.count({ where: { schoolId: ctx.schoolId, voided: false, approval: "PENDING", amount: { gte: limits.expenseOwnerAboveCents / 100 } } }) : 0,
    limits.refundOwnerAboveCents > 0 ? db.refund.count({ where: { schoolId: ctx.schoolId, status: "REQUESTED", amount: { gte: limits.refundOwnerAboveCents / 100 } } }) : 0,
    db.expense.count({ where: { schoolId: ctx.schoolId, voided: false, approval: "PENDING" } }),
    db.refund.count({ where: { schoolId: ctx.schoolId, status: "REQUESTED" } }),
    db.workflowTask.count({ where: { schoolId: ctx.schoolId, department: "ADMIN", status: { in: ["PENDING", "IN_PROGRESS"] } } }),
  ]);

  return {
    period, from: iso(from), to: iso(to), term: term ? { id: term.id, name: term.name } : null, year: year ? { id: year.id, name: year.name } : null,
    money: {
      income, feesIncome, admissionFees: centsOf(admissionFees._sum.amount), applicationFees: centsOf(applicationFees._sum.paidAmount), refundsPaid, expenses: expensesTotal, net: income - refundsPaid - expensesTotal,
      payments: pay._count,
      trend: months.map((m) => ({ month: m, income: inBy.get(m) ?? 0, expenses: outBy.get(m) ?? 0 })),
      byCategory: [...byCategory.entries()].map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents),
      byMethod: [...byMethod.entries()].map(([method, cents]) => ({ method, cents })).sort((a, b) => b.cents - a.cents),
      terms: termRows,
    },
    fees: fee ? { termName: fee.term.name, expected: fee.billed, collected: fee.paid, outstanding: fee.outstanding, overdue: fee.overdue, ratePct: fee.collectionRatePct, studentsOwing: fee.invoices.unpaid + fee.invoices.partial, dueSoon: fee.dueSoon } : null,
    verification: { posted: pay._count, admissionPending: { count: pendingAdmission._count, cents: centsOf(pendingAdmission._sum.amount) }, unmatched: { count: unmatched._count, cents: centsOf(unmatched._sum.amount) }, notSuccessful },
    discrepancies: { unmatchedEvents: unmatched._count, reversals: { count: reversed._count, cents: centsOf(reversed._sum.amount) }, pendingExpenses, pendingRefunds },
    school: { students, newStudents, applications, staff, teachers },
    departments,
    limits,
    ownerQueue: { expenses: bigExpenses, refunds: bigRefunds, recruitment },
  };
}

export type Executive = NonNullable<Awaited<ReturnType<typeof executiveOverview>>>;
