import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { recordServerError } from "@/server/monitor";

export const noStore = { "Cache-Control": "no-store" } as const;

/**
 * CSRF guard for cookie-authenticated JSON routes (server actions get this from Next itself).
 * Browsers always send Origin on cross-site POSTs; a mismatch is rejected. A request with no Origin
 * header (non-browser client) is also rejected because these routes are only meant for the app's own pages.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status, headers: noStore });
}

/** Maps a thrown error to an HTTP response; unexpected errors are logged and never leaked. */
export function errorResponse(e: unknown, log: string) {
  if (e instanceof AppError) {
    const status = { FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 422, CONFLICT: 409, UNAUTHENTICATED: 401, RATE_LIMITED: 429 }[e.code];
    return jsonError(status, e.message, { code: e.code, fieldErrors: e.fieldErrors });
  }
  console.error(JSON.stringify({ level: "error", msg: log, error: e instanceof Error ? e.message : String(e) }));
  void recordServerError("api", e, log); // best effort, never awaited
  return jsonError(500, "Server error");
}
