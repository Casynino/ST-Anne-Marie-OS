import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import { formToObject } from "@/lib/validation";
import { requireContext } from "@/lib/auth/next";
import type { AuthContext } from "@/lib/auth/context";

export type ActionState =
  | { ok: true; message?: string; data?: Record<string, string> }
  | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> }
  | null;

export type ActionResult = { message?: string; data?: Record<string, string>; redirectTo?: string } | void;

const SENSITIVE = /password/i;

function echoValues(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (SENSITIVE.test(k) || typeof v !== "string") continue;
    out[k] = v;
  }
  return out;
}

/**
 * Wraps a server action: authenticates, parses the form, runs the service, and converts
 * errors into form state. Known AppErrors are shown to the user; anything else is logged
 * server-side and replaced with a generic message so internals never leak.
 */
export async function run(
  form: FormData,
  fn: (ctx: AuthContext, input: Record<string, string | string[] | undefined>) => Promise<ActionResult>,
  opts: { allowMustChangePassword?: boolean; mapFieldErrors?: (errors: Record<string, string>) => Record<string, string> } = {},
): Promise<ActionState> {
  const ctx = await requireContext({ allowMustChangePassword: opts.allowMustChangePassword });
  const input = formToObject(form);
  let result: ActionResult;
  try {
    result = await fn(ctx, input);
  } catch (e) {
    if (e instanceof AppError) {
      const fieldErrors = e.fieldErrors && opts.mapFieldErrors ? opts.mapFieldErrors(e.fieldErrors) : e.fieldErrors;
      return { ok: false, error: e.message, code: e.code, fieldErrors, values: echoValues(input) };
    }
    console.error(JSON.stringify({ level: "error", msg: "action_failed", userId: ctx.userId, error: e instanceof Error ? e.message : String(e) }));
    return { ok: false, error: "Something went wrong. Please try again.", values: echoValues(input) };
  }
  revalidatePath("/", "layout");
  if (result && result.redirectTo) redirect(result.redirectTo);
  return { ok: true, message: result?.message, data: result?.data };
}

/** Form-input helpers for services that take typed arguments. */
export const str = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));
export const list = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []);
