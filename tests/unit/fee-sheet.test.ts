import { describe, expect, it } from "vitest";
import { feeSheetTable } from "@/lib/finance/fee-sheet";

const terms = [{ sequence: 2, name: "Term 2" }, { sequence: 1, name: "Term 1" }, { sequence: 3, name: "Term 3" }];
const fb = (n: number) => `Term ${n}`;

describe("fee sheet table", () => {
  it("charges a line without a term in every term and a line with a term only in that term", () => {
    const t = feeSheetTable([
      { feeItemId: "a", name: "Tuition", amountCents: 30_000_000, termSequence: null },
      { feeItemId: "b", name: "Admission", amountCents: 2_000_000, termSequence: 1 },
    ], terms, fb);
    expect(t.terms.map((x) => x.sequence)).toEqual([1, 2, 3]);
    expect(t.rows[0]).toEqual({ name: "Tuition", cells: [30_000_000, 30_000_000, 30_000_000], totalCents: 90_000_000 });
    expect(t.rows[1]).toEqual({ name: "Admission", cells: [2_000_000, 0, 0], totalCents: 2_000_000 });
    expect(t.termTotals).toEqual([32_000_000, 30_000_000, 30_000_000]);
    expect(t.yearTotalCents).toBe(92_000_000);
  });

  it("adds an item's lines together and keeps the order the lines were entered in", () => {
    const t = feeSheetTable([
      { feeItemId: "b", name: "Bus", amountCents: 5_000_000, termSequence: null },
      { feeItemId: "a", name: "Tuition", amountCents: 10_000_000, termSequence: null },
      { feeItemId: "b", name: "Bus", amountCents: 1_000_000, termSequence: 2 },
    ], terms, fb);
    expect(t.rows.map((r) => r.name)).toEqual(["Bus", "Tuition"]);
    expect(t.rows[0]!.cells).toEqual([5_000_000, 6_000_000, 5_000_000]);
  });

  it("never drops an amount whose term is not listed for the year", () => {
    const t = feeSheetTable([{ feeItemId: "a", name: "Exam", amountCents: 1_000_000, termSequence: 5 }], [{ sequence: 1, name: "Term 1" }], fb);
    expect(t.terms.map((x) => x.name)).toEqual(["Term 1", "Term 5"]);
    expect(t.yearTotalCents).toBe(1_000_000);
  });

  it("has an empty table for no lines", () => {
    const t = feeSheetTable([], terms, fb);
    expect(t.rows).toEqual([]);
    expect(t.yearTotalCents).toBe(0);
  });
});
