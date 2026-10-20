import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { isSameOrigin, jsonError, noStore } from "@/lib/http";
import { submitAttendance } from "@/server/attendance";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;
const envelope = z.object({ deviceId: z.string().max(80).optional(), ops: z.array(z.unknown()).min(1).max(25) });

/**
 * Offline sync endpoint. Each operation carries a client-generated UUID and is applied at most once
 * (replays return the stored outcome). Results per operation:
 *  APPLIED  – server has it (also for exact replays)      → client may mark "synced"
 *  CONFLICT – kept for review, server data NOT overwritten  → client shows "conflict"
 *  REJECTED – invalid/forbidden; will not succeed as-is     → client shows "failed" with the reason
 *  RETRY    – transient server problem                      → client keeps it queued
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Forbidden");
  const ctx = await getContext();
  if (!ctx || ctx.mustChangePassword) return jsonError(401, "Please sign in again to sync.", { code: "UNAUTHENTICATED" });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return jsonError(413, "Request too large");

  let body: z.infer<typeof envelope>;
  try {
    body = envelope.parse(await request.json());
  } catch {
    return jsonError(400, "Invalid request");
  }

  const results = [];
  for (const raw of body.ops) {
    const opId = typeof (raw as { clientOpId?: unknown })?.clientOpId === "string" ? (raw as { clientOpId: string }).clientOpId : null;
    try {
      const res = await submitAttendance(ctx, { ...(raw as object), deviceId: body.deviceId });
      results.push({ opId, outcome: res.outcome, code: res.code, replay: res.replay, registerStatus: res.registerStatus });
    } catch (e) {
      if (e instanceof AppError) {
        results.push({ opId, outcome: "REJECTED", code: e.code, reason: e.fieldErrors?.entries ?? e.code, message: e.message });
      } else {
        console.error(JSON.stringify({ level: "error", msg: "attendance_sync_failed", userId: ctx.userId, error: e instanceof Error ? e.message : String(e) }));
        results.push({ opId, outcome: "RETRY", code: "SERVER_ERROR" });
      }
    }
  }
  return NextResponse.json({ results }, { headers: noStore });
}
