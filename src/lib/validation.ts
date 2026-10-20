import { z } from "zod";
import { invalid } from "@/lib/errors";
import { parseDateOnly } from "@/lib/dates";
import { normalizeEmail, normalizePhone } from "@/lib/phone";

/** Parses input with zod and throws a user-safe validation error with per-field messages. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    if (!(key in fieldErrors)) fieldErrors[key] = issue.message;
  }
  throw invalid("Please correct the highlighted fields.", fieldErrors);
}

/** Converts FormData to a plain object; empty strings become undefined so optional fields work. */
export function formToObject(form: FormData): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const key of new Set(form.keys())) {
    const values = form.getAll(key).filter((v): v is string => typeof v === "string");
    const cleaned = values.map((v) => v.trim()).filter((v) => v !== "");
    out[key] = values.length > 1 ? cleaned : cleaned[0];
  }
  return out;
}

export const text = (max = 200) => z.string().trim().min(1, "Required").max(max, `Maximum ${max} characters`);
export const optText = (max = 200) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().trim().max(max, `Maximum ${max} characters`).optional());
export const uuid = () => z.uuid("Invalid selection");
export const optUuid = () => z.preprocess((v) => (v === "" || v === null ? undefined : v), z.uuid("Invalid selection").optional());

/** yyyy-mm-dd string → UTC Date (calendar date). */
export const dateOnly = () =>
  z.string().refine((v) => parseDateOnly(v) !== null, "Enter a valid date").transform((v) => parseDateOnly(v) as Date);
export const optDateOnly = () => z.preprocess((v) => (v === "" || v === null ? undefined : v), dateOnly().optional());

export const phoneField = () =>
  z.string().trim().refine((v) => normalizePhone(v) !== null, "Enter a valid phone number").transform((v) => normalizePhone(v) as string);
export const optPhoneField = () => z.preprocess((v) => (v === "" || v === null ? undefined : v), phoneField().optional());
export const optEmailField = () =>
  z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.string().trim().refine((v) => normalizeEmail(v) !== null, "Enter a valid email address").transform((v) => normalizeEmail(v) as string).optional(),
  );

export const checkbox = () => z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
