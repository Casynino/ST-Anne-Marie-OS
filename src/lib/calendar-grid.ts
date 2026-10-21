/*
 * Pure calendar helpers for the public calendar page. All dates are calendar dates ("YYYY-MM-DD", no time zone),
 * so nothing here can shift by a day.
 */

export type CalItem = { id: string; kind: "TERM_START" | "TERM_END" | "EVENT"; title: string; from: string; to: string | null; category: string | null; location: string | null; href: string | null };

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

/** "2026-10" → { year: 2026, month: 10 } (1–12); anything else → null. */
export function parseMonth(value: string | undefined): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]);
  return month >= 1 && month <= 12 && year >= 2000 && year <= 2100 ? { year, month } : null;
}

export const monthKey = (year: number, month: number) => `${year}-${pad(month)}`;

export function shiftMonth(year: number, month: number, by: number) {
  const d = utc(year, month - 1 + by, 1);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** First and last calendar day of a month. */
export function monthRange(year: number, month: number) {
  return { from: iso(utc(year, month - 1, 1)), to: iso(utc(year, month, 0)) };
}

/** Weeks (Monday first) covering the month; days outside the month are flagged. Always whole weeks of 7 days. */
export function monthGrid(year: number, month: number): { date: string; day: number; inMonth: boolean }[][] {
  const first = utc(year, month - 1, 1);
  const offset = (first.getUTCDay() + 6) % 7; // Monday = 0
  const last = utc(year, month, 0).getUTCDate();
  const total = Math.ceil((offset + last) / 7) * 7;
  const weeks: { date: string; day: number; inMonth: boolean }[][] = [];
  for (let i = 0; i < total; i++) {
    const d = utc(year, month - 1, 1 - offset + i);
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1]!.push({ date: iso(d), day: d.getUTCDate(), inMonth: d.getUTCMonth() === month - 1 });
  }
  return weeks;
}

/** Items that fall on a day (single-day items on their date, ranges on every day between from and to). */
export const itemsOn = (items: CalItem[], date: string) => items.filter((i) => i.from <= date && date <= (i.to ?? i.from));

/** Week number of a date inside a term (1 = first week), or null outside it. */
export function termWeek(startsOn: string, endsOn: string, today: string): number | null {
  if (today < startsOn || today > endsOn) return null;
  return Math.floor((Date.parse(today) - Date.parse(startsOn)) / 86_400_000 / 7) + 1;
}

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
