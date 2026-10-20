import type { Cents } from "./money";

/*
 * The single authoritative balance calculation. Nothing else adds up fees.
 *
 * Inputs are facts: live invoices (with their totals), POSTED payments, and the amount of active refunds.
 * Allocation is derived, never stored, so reversals, adjustments and late invoices can never leave a
 * stale or over-allocated record behind:
 *   1. A payment aimed at one invoice pays that invoice first (never more than it still owes);
 *      whatever it cannot use joins the general pool together with all untargeted payments.
 *   2. Active refunds (money already returned or reserved for return) leave the pool.
 *   3. The pool pays the remaining invoices oldest first (issue date, due date, id).
 *   4. What is left is unapplied credit.
 * Invariants (covered by tests): paid <= total for every invoice, and
 *   sum(paid) + credit = sum(payments) - refunds (money is conserved).
 */

export type LedgerInvoice = {
  id: string;
  issueDate: string; // yyyy-mm-dd
  dueDate: string;
  total: Cents;
  instalments: { dueDate: string; amount: Cents }[];
};
export type LedgerPayment = { id: string; amount: Cents; targetInvoiceId: string | null; receivedOn: string };

export type PayState = "NO_CHARGE" | "UNPAID" | "PARTIAL" | "PAID";
export type ScheduleItem = { dueDate: string; amount: Cents; paid: Cents; state: "PAID" | "PARTIAL" | "UNPAID" };
export type InvoiceBalance = {
  id: string;
  total: Cents;
  paid: Cents;
  outstanding: Cents;
  state: PayState;
  schedule: ScheduleItem[];
  /** The unpaid parts of schedule items whose due date is before `today`. */
  overdue: { dueDate: string; amount: Cents }[];
  overdueAmount: Cents;
};
export type Ledger = {
  invoices: Map<string, InvoiceBalance>;
  billed: Cents;
  paymentsTotal: Cents;
  refunds: Cents;
  applied: Cents;
  outstanding: Cents;
  overdue: Cents;
  credit: Cents;
};

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Oldest first. */
export function sortInvoices<T extends { id: string; issueDate: string; dueDate: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => cmp(a.issueDate, b.issueDate) || cmp(a.dueDate, b.dueDate) || cmp(a.id, b.id));
}

/** The amounts due and when. Instalments are capped at the invoice total; any uncovered rest is due on the invoice due date. */
export function dueSchedule(inv: Pick<LedgerInvoice, "total" | "dueDate" | "instalments">): { dueDate: string; amount: Cents }[] {
  const items: { dueDate: string; amount: Cents }[] = [];
  let covered = 0;
  for (const i of [...inv.instalments].sort((a, b) => cmp(a.dueDate, b.dueDate))) {
    if (covered >= inv.total) break;
    const amount = Math.min(i.amount, inv.total - covered);
    if (amount > 0) {
      items.push({ dueDate: i.dueDate, amount });
      covered += amount;
    }
  }
  if (covered < inv.total) items.push({ dueDate: inv.dueDate, amount: inv.total - covered });
  return items;
}

export function computeLedger(invoicesIn: LedgerInvoice[], payments: LedgerPayment[], activeRefunds: Cents, today: string): Ledger {
  const invoices = sortInvoices(invoicesIn);
  const remaining = new Map(invoices.map((i) => [i.id, i.total]));
  const paid = new Map(invoices.map((i) => [i.id, 0]));
  let pool = 0;
  let paymentsTotal = 0;

  const ordered = [...payments].sort((a, b) => cmp(a.receivedOn, b.receivedOn) || cmp(a.id, b.id));
  for (const p of ordered) {
    paymentsTotal += p.amount;
    const target = p.targetInvoiceId ? remaining.get(p.targetInvoiceId) : undefined;
    if (target !== undefined) {
      const use = Math.min(p.amount, target);
      remaining.set(p.targetInvoiceId!, target - use);
      paid.set(p.targetInvoiceId!, paid.get(p.targetInvoiceId!)! + use);
      pool += p.amount - use;
    } else {
      pool += p.amount;
    }
  }
  pool = Math.max(0, pool - activeRefunds);
  for (const inv of invoices) {
    const take = Math.min(pool, remaining.get(inv.id)!);
    paid.set(inv.id, paid.get(inv.id)! + take);
    pool -= take;
  }

  const out = new Map<string, InvoiceBalance>();
  let billed = 0, applied = 0, outstanding = 0, overdue = 0;
  for (const inv of invoices) {
    const p = paid.get(inv.id)!;
    let cover = p;
    const schedule: ScheduleItem[] = dueSchedule(inv).map((item) => {
      const part = Math.min(cover, item.amount);
      cover -= part;
      return { ...item, paid: part, state: part >= item.amount ? "PAID" : part > 0 ? "PARTIAL" : "UNPAID" };
    });
    const late = schedule.filter((s) => s.paid < s.amount && s.dueDate < today).map((s) => ({ dueDate: s.dueDate, amount: s.amount - s.paid }));
    const overdueAmount = late.reduce((n, x) => n + x.amount, 0);
    const out_ = inv.total - p;
    out.set(inv.id, {
      id: inv.id, total: inv.total, paid: p, outstanding: out_,
      state: inv.total === 0 ? "NO_CHARGE" : p === 0 ? "UNPAID" : p >= inv.total ? "PAID" : "PARTIAL",
      schedule, overdue: late, overdueAmount,
    });
    billed += inv.total; applied += p; outstanding += out_; overdue += overdueAmount;
  }
  return { invoices: out, billed, paymentsTotal, refunds: activeRefunds, applied, outstanding, overdue, credit: pool };
}

// ───────────────────────── Ageing ─────────────────────────

export type AgeBucket = "1-30" | "31-60" | "61-90" | "90+";
export const AGE_BUCKETS: AgeBucket[] = ["1-30", "31-60", "61-90", "90+"];

export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export const bucketFor = (daysOverdue: number): AgeBucket => (daysOverdue <= 30 ? "1-30" : daysOverdue <= 60 ? "31-60" : daysOverdue <= 90 ? "61-90" : "90+");

export function ageing(balances: InvoiceBalance[], today: string): Record<AgeBucket, Cents> {
  const out: Record<AgeBucket, Cents> = { "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const b of balances) for (const o of b.overdue) out[bucketFor(daysBetween(o.dueDate, today))] += o.amount;
  return out;
}

// ───────────────────────── Discounts ─────────────────────────

export type ChargeLine = { feeItemId: string | null; amount: Cents };
export type DiscountRule = { kind: "PERCENT" | "FIXED"; value: Cents; feeItemId: string | null };

/**
 * Discount amounts for a set of charge lines. PERCENT: value is hundredths of a percent (12.5% = 1250) of the
 * targeted charges (one fee item, or all). FIXED: a money amount. Discounts never push a line below zero and
 * are applied in order, each against what is still chargeable, so the total can never go negative.
 */
export function applyDiscounts(charges: ChargeLine[], rules: DiscountRule[]): { rule: DiscountRule; amount: Cents }[] {
  const left = charges.map((c) => ({ ...c, left: c.amount }));
  const out: { rule: DiscountRule; amount: Cents }[] = [];
  for (const rule of rules) {
    const targets = left.filter((l) => rule.feeItemId === null || l.feeItemId === rule.feeItemId);
    const base = targets.reduce((n, l) => n + l.left, 0);
    let want = rule.kind === "PERCENT" ? Math.round((base * rule.value) / 10_000) : rule.value;
    want = Math.min(want, base);
    if (want <= 0) continue;
    let remainingWant = want;
    for (const t of targets) {
      const take = Math.min(t.left, rule.kind === "PERCENT" ? Math.round((t.left * rule.value) / 10_000) : remainingWant);
      t.left -= take;
      remainingWant -= take;
    }
    // Rounding across lines can leave a cent or two: take it from the first line that still has room.
    for (const t of targets) {
      if (remainingWant <= 0) break;
      const take = Math.min(t.left, remainingWant);
      t.left -= take;
      remainingWant -= take;
    }
    out.push({ rule, amount: want - remainingWant });
  }
  return out.filter((o) => o.amount > 0);
}
