import { describe, expect, it } from "vitest";
import { centsOf, decimalOf, formatMoney, parseAmount } from "@/lib/finance/money";
import { ageing, applyDiscounts, bucketFor, computeLedger, daysBetween, dueSchedule, type LedgerInvoice, type LedgerPayment } from "@/lib/finance/ledger";

const inv = (id: string, total: number, issue = "2026-01-10", due = "2026-02-10", instalments: LedgerInvoice["instalments"] = []): LedgerInvoice => ({ id, issueDate: issue, dueDate: due, total, instalments });
const pay = (id: string, amount: number, on = "2026-01-15", target: string | null = null): LedgerPayment => ({ id, amount, receivedOn: on, targetInvoiceId: target });

describe("money", () => {
  it("parses plain amounts and rejects everything else", () => {
    expect(parseAmount("150000")).toBe(15_000_000);
    expect(parseAmount("150,000")).toBe(15_000_000);
    expect(parseAmount("1 250.5")).toBe(125_050);
    expect(parseAmount("1,250,000")).toBe(125_000_000);
    expect(parseAmount("0.07")).toBe(7);
    expect(parseAmount(12.3)).toBe(1230);
    for (const bad of ["", "abc", "-5", "1e3", "1.234", "1.2.3", "5,", "1,25", "1,2345", "12,50", "TZS 5", "0x10", String(1e15)]) expect(parseAmount(bad)).toBeNull();
  });
  it("round-trips through the database representation without floating point drift", () => {
    expect(centsOf("1234.50")).toBe(123450);
    expect(centsOf("0.10")).toBe(10);
    expect(centsOf("0.3")).toBe(30);
    expect(centsOf(null)).toBe(0);
    expect(centsOf("-12.05")).toBe(-1205);
    expect(decimalOf(123450)).toBe("1234.50");
    expect(decimalOf(5)).toBe("0.05");
    expect(centsOf(decimalOf(99_999_999_999))).toBe(99_999_999_999);
    // The classic float trap: 0.1 + 0.2
    expect(centsOf("0.1") + centsOf("0.2")).toBe(centsOf("0.3"));
  });
  it("formats whole amounts without decimals", () => {
    expect(formatMoney(15_000_000)).toBe("TZS 150,000");
    expect(formatMoney(12_345_050)).toBe("TZS 123,450.50");
    expect(formatMoney(-500)).toBe("-TZS 5");
  });
});

describe("ledger allocation", () => {
  it("pays the oldest invoice first and keeps partial payments partial", () => {
    const l = computeLedger([inv("b", 100_00, "2026-05-01", "2026-06-01"), inv("a", 100_00)], [pay("p1", 150_00)], 0, "2026-03-01");
    expect(l.invoices.get("a")).toMatchObject({ paid: 100_00, outstanding: 0, state: "PAID" });
    expect(l.invoices.get("b")).toMatchObject({ paid: 50_00, outstanding: 50_00, state: "PARTIAL" });
    expect(l.credit).toBe(0);
    expect(l.outstanding).toBe(50_00);
  });

  it("never over-allocates: surplus is unapplied credit", () => {
    const l = computeLedger([inv("a", 100_00)], [pay("p1", 70_00), pay("p2", 70_00)], 0, "2026-03-01");
    expect(l.invoices.get("a")!.paid).toBe(100_00);
    expect(l.credit).toBe(40_00);
  });

  it("a payment aimed at one invoice pays it first; the unusable rest flows oldest-first", () => {
    const l = computeLedger([inv("old", 100_00, "2026-01-01", "2026-02-01"), inv("new", 60_00, "2026-04-01", "2026-05-01")], [pay("p", 100_00, "2026-04-02", "new")], 0, "2026-06-01");
    expect(l.invoices.get("new")).toMatchObject({ paid: 60_00, state: "PAID" });
    expect(l.invoices.get("old")).toMatchObject({ paid: 40_00, state: "PARTIAL" });
  });

  it("a payment received before the invoice exists still counts once the invoice is issued", () => {
    const l = computeLedger([inv("later", 80_00, "2026-09-01", "2026-09-30")], [pay("early", 50_00, "2026-08-01")], 0, "2026-09-05");
    expect(l.invoices.get("later")).toMatchObject({ paid: 50_00, outstanding: 30_00 });
  });

  it("keeps zero-charge, unpaid, partial and paid distinct", () => {
    const l = computeLedger([inv("free", 0), inv("unpaid", 10_00, "2026-02-01", "2026-03-01"), inv("part", 10_00, "2026-03-01", "2026-04-01"), inv("done", 10_00, "2026-04-01", "2026-05-01")], [], 0, "2026-01-01");
    expect(l.invoices.get("free")!.state).toBe("NO_CHARGE");
    expect(l.invoices.get("unpaid")!.state).toBe("UNPAID");
    const l2 = computeLedger([inv("free", 0), inv("part", 10_00), inv("done", 10_00, "2026-02-01")], [pay("p", 15_00)], 0, "2026-01-01");
    expect(l2.invoices.get("part")!.state).toBe("PAID"); // older one is paid first
    expect(l2.invoices.get("done")!.state).toBe("PARTIAL");
    expect(l2.invoices.get("free")!.state).toBe("NO_CHARGE"); // a zero invoice is never "paid"
  });

  it("refunds leave the pool but can never reduce what invoices already used", () => {
    const l = computeLedger([inv("a", 100_00)], [pay("p", 130_00)], 30_00, "2026-03-01");
    expect(l.invoices.get("a")!.paid).toBe(100_00);
    expect(l.credit).toBe(0);
  });

  it("reversing a payment (removing it from the facts) makes the invoice owe again", () => {
    const facts = [inv("a", 100_00)];
    expect(computeLedger(facts, [pay("p1", 100_00)], 0, "2026-03-01").invoices.get("a")!.state).toBe("PAID");
    expect(computeLedger(facts, [], 0, "2026-03-01").invoices.get("a")!.state).toBe("UNPAID");
  });

  it("conserves money and never over-allocates (randomised)", () => {
    let seed = 12345;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let run = 0; run < 400; run++) {
      const invoices = Array.from({ length: 1 + rnd(5) }, (_, i) => inv(`i${i}`, rnd(500_00), `2026-0${1 + rnd(9)}-1${rnd(9)}`, `2026-1${rnd(3)}-2${rnd(8)}`));
      const payments = Array.from({ length: rnd(7) }, (_, i) => pay(`p${i}`, 1 + rnd(400_00), `2026-0${1 + rnd(9)}-0${1 + rnd(8)}`, rnd(3) === 0 ? invoices[rnd(invoices.length)]!.id : null));
      const total = payments.reduce((n, p) => n + p.amount, 0);
      const base = computeLedger(invoices, payments, 0, "2027-01-01");
      const refunds = rnd(2) ? rnd(base.credit + 1) : 0; // refunds can only take unapplied credit
      const l = computeLedger(invoices, payments, refunds, "2027-01-01");
      for (const b of l.invoices.values()) {
        expect(b.paid).toBeLessThanOrEqual(b.total);
        expect(b.paid).toBeGreaterThanOrEqual(0);
        expect(b.outstanding).toBe(b.total - b.paid);
      }
      expect(l.applied + l.credit).toBe(total - refunds); // money is conserved
      expect(l.applied).toBe(base.applied); // taking credit never reduces what invoices already used
      // Same facts in a different input order give the same answer.
      const l2 = computeLedger([...invoices].reverse(), [...payments].reverse(), refunds, "2027-01-01");
      expect(l2.credit).toBe(l.credit);
      for (const [id, b] of l.invoices) expect(l2.invoices.get(id)!.paid).toBe(b.paid);
    }
  });
});

describe("instalments, overdue and ageing", () => {
  it("covers instalments in order and flags only the unpaid, past-due parts", () => {
    const i = inv("a", 300_00, "2026-01-01", "2026-03-31", [{ dueDate: "2026-02-01", amount: 100_00 }, { dueDate: "2026-03-01", amount: 100_00 }, { dueDate: "2026-04-01", amount: 100_00 }]);
    const l = computeLedger([i], [pay("p", 150_00, "2026-02-02")], 0, "2026-03-15");
    const b = l.invoices.get("a")!;
    expect(b.schedule.map((s) => s.state)).toEqual(["PAID", "PARTIAL", "UNPAID"]);
    expect(b.overdue).toEqual([{ dueDate: "2026-03-01", amount: 50_00 }]); // 3rd instalment is not due yet
    expect(b.overdueAmount).toBe(50_00);
  });
  it("without a plan the whole outstanding amount is due on the due date", () => {
    const l = computeLedger([inv("a", 100_00, "2026-01-01", "2026-02-01")], [pay("p", 30_00)], 0, "2026-02-02");
    expect(l.invoices.get("a")!.overdueAmount).toBe(70_00);
    expect(computeLedger([inv("a", 100_00, "2026-01-01", "2026-02-01")], [], 0, "2026-02-01").invoices.get("a")!.overdueAmount).toBe(0); // due today is not yet overdue
  });
  it("instalments are capped at the total and an uncovered rest is due on the invoice due date", () => {
    expect(dueSchedule({ total: 150_00, dueDate: "2026-05-01", instalments: [{ dueDate: "2026-02-01", amount: 100_00 }, { dueDate: "2026-03-01", amount: 100_00 }] })).toEqual([{ dueDate: "2026-02-01", amount: 100_00 }, { dueDate: "2026-03-01", amount: 50_00 }]);
    expect(dueSchedule({ total: 200_00, dueDate: "2026-05-01", instalments: [{ dueDate: "2026-02-01", amount: 100_00 }] })).toEqual([{ dueDate: "2026-02-01", amount: 100_00 }, { dueDate: "2026-05-01", amount: 100_00 }]);
  });
  it("buckets arrears by days overdue", () => {
    expect([1, 30, 31, 60, 61, 90, 91, 400].map(bucketFor)).toEqual(["1-30", "1-30", "31-60", "31-60", "61-90", "61-90", "90+", "90+"]);
    expect(daysBetween("2026-01-31", "2026-03-01")).toBe(29);
    const l = computeLedger([inv("a", 100_00, "2026-01-01", "2026-01-31"), inv("b", 50_00, "2026-01-02", "2026-03-20")], [], 0, "2026-04-05");
    expect(ageing([...l.invoices.values()], "2026-04-05")).toEqual({ "1-30": 50_00, "31-60": 0, "61-90": 100_00, "90+": 0 });
  });
});

describe("discounts", () => {
  const charges = [{ feeItemId: "tuition", amount: 100_000_00 }, { feeItemId: "bus", amount: 20_000_00 }];
  it("percent of the whole invoice or of one fee item", () => {
    expect(applyDiscounts(charges, [{ kind: "PERCENT", value: 1000, feeItemId: null }]).map((d) => d.amount)).toEqual([12_000_00]); // 10% of 120,000
    expect(applyDiscounts(charges, [{ kind: "PERCENT", value: 5000, feeItemId: "bus" }]).map((d) => d.amount)).toEqual([10_000_00]);
  });
  it("fixed amounts are capped at what can still be charged and the total never goes negative", () => {
    const d = applyDiscounts(charges, [{ kind: "FIXED", value: 90_000_00, feeItemId: null }, { kind: "FIXED", value: 90_000_00, feeItemId: null }]);
    expect(d.map((x) => x.amount)).toEqual([90_000_00, 30_000_00]);
    expect(d.reduce((n, x) => n + x.amount, 0)).toBe(120_000_00);
    expect(applyDiscounts(charges, [{ kind: "FIXED", value: 5_000_00, feeItemId: "uniform" }])).toEqual([]); // nothing to discount
  });
  it("a 100% scholarship gives a zero-total invoice, not a negative one", () => {
    const total = charges.reduce((n, c) => n + c.amount, 0) - applyDiscounts(charges, [{ kind: "PERCENT", value: 10_000, feeItemId: null }]).reduce((n, d) => n + d.amount, 0);
    expect(total).toBe(0);
  });
});
