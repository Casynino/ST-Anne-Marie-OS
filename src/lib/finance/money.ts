import { z } from "zod";

/**
 * Money is handled as integer cents (1 TZS = 100 cents) everywhere in code and stored as DECIMAL(14,2).
 * Floating-point money is never added up: values are converted to cents once, at the edges.
 */
export type Cents = number;

export const MAX_CENTS = 1_000_000_000_000 * 100; // 1 trillion: far beyond any school figure, still exact in a double

const AMOUNT = /^\d+(\.\d{1,2})?$/;
const GROUPED = /^\d{1,3}([ ,]\d{3})+(\.\d{1,2})?$/; // 1,250,000 or 1 250 000: separators only between groups of three

/** Parses user input such as "150000", "150,000" or "1 250.50" into cents. Returns null when it is not a plain amount. */
export function parseAmount(input: string | number): Cents | null {
  let text = typeof input === "number" ? (Number.isFinite(input) ? String(input) : "") : input.trim();
  if (GROUPED.test(text)) text = text.replace(/[ ,]/g, "");
  if (!AMOUNT.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return cents <= MAX_CENTS ? cents : null;
}

/** Cents from a database DECIMAL (Prisma Decimal, string or number). */
export function centsOf(value: { toString(): string } | number | string | null | undefined): Cents {
  if (value === null || value === undefined) return 0;
  const [whole = "0", frac = ""] = String(value).split(".");
  const neg = whole.startsWith("-");
  const c = Math.abs(Number(whole)) * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
  return neg ? -c : c;
}

/** Decimal string for the database, e.g. 123450 -> "1234.50". */
export function decimalOf(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Display: whole amounts without decimals, otherwise two decimals, with thousands separators. */
export function formatMoney(cents: Cents, currency = "TZS"): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const body = whole.toLocaleString("en-US") + (frac ? `.${String(frac).padStart(2, "0")}` : "");
  return `${cents < 0 ? "-" : ""}${currency} ${body}`;
}

/** zod field: a positive amount in the school currency, returned as cents. */
export const positiveAmount = (label = "Amount") =>
  z
    .union([z.string(), z.number()])
    .transform((v, ctx) => {
      const c = typeof v === "string" && v.trim() === "" ? null : parseAmount(v);
      if (c === null) ctx.addIssue({ code: "custom", message: `${label} must be a number such as 150000 or 1250.50` });
      else if (c <= 0) ctx.addIssue({ code: "custom", message: `${label} must be more than zero` });
      return c ?? 0;
    });
