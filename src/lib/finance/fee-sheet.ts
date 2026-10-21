/*
 * The fee structure laid out as the school's paper fee table: one row per fee item, one column per term, a total per term and for the year.
 * A line with no term is charged in every term; a line with a term number is charged in that term only. Pure: whole cents, no I/O.
 */

export type FeeSheetLine = { feeItemId: string; name: string; amountCents: number; termSequence: number | null };
export type FeeSheetTerm = { sequence: number; name: string };
export type FeeSheetRow = { name: string; cells: number[]; totalCents: number };
export type FeeSheetTable = { terms: FeeSheetTerm[]; rows: FeeSheetRow[]; termTotals: number[]; yearTotalCents: number };

export function feeSheetTable(lines: FeeSheetLine[], yearTerms: FeeSheetTerm[], fallbackTermName: (sequence: number) => string): FeeSheetTable {
  const terms = [...yearTerms].sort((a, b) => a.sequence - b.sequence);
  // A line may name a term the year does not list (a term deleted later): it still gets a column so no amount is ever dropped.
  for (const seq of [...new Set(lines.map((l) => l.termSequence).filter((x): x is number => x !== null))].sort((a, b) => a - b)) {
    if (!terms.some((t) => t.sequence === seq)) terms.push({ sequence: seq, name: fallbackTermName(seq) });
  }
  const order: string[] = [];
  const names = new Map<string, string>();
  for (const l of lines) if (!names.has(l.feeItemId)) { order.push(l.feeItemId); names.set(l.feeItemId, l.name); }
  const rows: FeeSheetRow[] = order.map((id) => {
    const mine = lines.filter((l) => l.feeItemId === id);
    const cells = terms.map((t) => mine.filter((l) => l.termSequence === null || l.termSequence === t.sequence).reduce((n, l) => n + l.amountCents, 0));
    return { name: names.get(id)!, cells, totalCents: cells.reduce((n, c) => n + c, 0) };
  });
  const termTotals = terms.map((_, i) => rows.reduce((n, r) => n + r.cells[i]!, 0));
  return { terms, rows, termTotals, yearTotalCents: termTotals.reduce((n, c) => n + c, 0) };
}
