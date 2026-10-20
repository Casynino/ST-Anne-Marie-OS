import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth/next";
import { errorResponse, jsonError, noStore } from "@/lib/http";
import { db } from "@/lib/db";
import { todayInTimezone } from "@/lib/dates";
import { getAttendanceSheet, registerOverview } from "@/server/attendance";

export const dynamic = "force-dynamic";

/**
 * Class lists for offline use. `?date=YYYY-MM-DD` (default: today in the school's timezone) returns one
 * sheet per class/stream/session the signed-in user may take attendance for. The device stores exactly
 * what is returned here — nothing else is available offline.
 */
export async function GET(request: Request) {
  const ctx = await getContext();
  if (!ctx || ctx.mustChangePassword) return jsonError(401, "Unauthorized", { code: "UNAUTHENTICATED" });
  try {
    const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { timezone: true } });
    const today = todayInTimezone(school.timezone);
    const date = new URL(request.url).searchParams.get("date") || today;
    if (date > today) return jsonError(422, "Cannot download class lists for a future date.");
    const overview = await registerOverview(ctx, date);
    const sheets = [];
    for (const row of overview.rows.filter((r) => r.canTake)) {
      for (const cell of row.cells) {
        sheets.push(await getAttendanceSheet(ctx, { classId: row.classId, streamId: row.streamId ?? undefined, sessionId: cell.sessionId, date }));
      }
    }
    return NextResponse.json(
      { downloadedAt: new Date().toISOString(), userId: ctx.userId, timezone: school.timezone, today, date, sheets: sheets.filter((s) => s.canTake) },
      { headers: noStore },
    );
  } catch (e) {
    return errorResponse(e, "attendance_roster_failed");
  }
}
