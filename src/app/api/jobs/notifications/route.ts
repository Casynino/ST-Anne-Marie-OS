import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { jsonError, noStore } from "@/lib/http";
import { markStaleSubmissionsUnknown, processPendingEvents } from "@/server/notifications";

export const dynamic = "force-dynamic";

/** Worker trigger for the notification outbox (cron). Requires `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return jsonError(503, "CRON_SECRET is not configured");
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return jsonError(401, "Unauthorized");
  const result = await processPendingEvents({ limit: 200 });
  const unknown = await markStaleSubmissionsUnknown();
  return NextResponse.json({ ...result, markedUnknown: unknown }, { headers: noStore });
}
