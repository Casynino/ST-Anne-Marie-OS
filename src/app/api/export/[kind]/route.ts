import { getContext } from "@/lib/auth/next";
import { errorResponse, jsonError } from "@/lib/http";
import { parseFormat } from "@/lib/export/table";
import { admissionsTable, attendanceTable, studentsTable, resultsTable } from "@/server/exports";
import { deskTable } from "@/server/admission-desk";
import { respondTable } from "@/server/export-response";
import { returningFilterFromParams } from "@/server/annual-registration";
import { studentAttendanceTable, studentFeesTable, studentMarksTable, studentSummaryTable } from "@/server/student-exports";
import { annualFeesTable, progressionTable, registrationTable, yearSummaryTable } from "@/server/year-exports";

export const dynamic = "force-dynamic";

/** Students, class results, class attendance and admissions as CSV, Excel or PDF. Permission and scope are those of the matching screen. */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await getContext();
  if (!ctx || ctx.mustChangePassword) return jsonError(401, "Unauthorized", { code: "UNAUTHENTICATED" });
  if (ctx.userType !== "STAFF") return jsonError(403, "Forbidden", { code: "FORBIDDEN" });
  const { kind } = await params;
  const sp = new URL(request.url).searchParams;
  const g = (k: string) => sp.get(k) || undefined;
  try {
    let table;
    if (kind === "students") table = await studentsTable(ctx, { q: g("q"), classId: g("classId"), streamId: g("streamId"), status: g("status") });
    else if (kind === "results") table = await resultsTable(ctx, { termId: g("termId") ?? "", classId: g("classId") ?? "", streamId: g("streamId"), basis: g("basis") });
    else if (kind === "attendance") table = await attendanceTable(ctx, { classId: g("classId") ?? "", streamId: g("streamId"), from: g("from") ?? "", to: g("to") ?? "" });
    else if (kind === "admissions") table = ["desk", "q", "state", "stage", "classId", "interview", "assigned", "source", "attention"].some((k) => g(k)) ? await deskTable(ctx, { q: g("q"), state: g("state"), stage: g("stage"), classId: g("classId"), from: g("from"), to: g("to"), interview: g("interview"), assigned: g("assigned"), source: g("source"), attention: g("attention") === "1" }) : await admissionsTable(ctx, { from: g("from"), to: g("to"), status: g("status") });
    else if (kind === "returning") table = await registrationTable(ctx, returningFilterFromParams(Object.fromEntries(sp.entries())));
    else if (kind === "progression") table = await progressionTable(ctx, { yearId: g("year"), classId: g("class"), q: g("q"), show: (["none", "draft", "awaiting_head", "approved", "review", "incomplete"] as const).find((x) => x === g("show")) });
    else if (kind === "annual-fees") table = await annualFeesTable(ctx, { yearId: g("year"), classId: g("class"), streamId: g("stream"), q: g("q"), state: (["cleared", "owing", "not_billed", "exception", "previous"] as const).find((x) => x === g("state")), outcome: g("outcome") === "PROMOTED" || g("outcome") === "REPEAT" ? (g("outcome") as "PROMOTED" | "REPEAT") : undefined, regStatus: (["PENDING", "REGISTERED", "ACTIVE"] as const).find((x) => x === g("reg")) });
    else if (kind === "student-summary" || kind === "student-marks" || kind === "student-attendance" || kind === "student-fees") {
      const sid = g("studentId") ?? "";
      if (!/^[0-9a-f-]{36}$/i.test(sid)) return jsonError(404, "Student not found.");
      table = await (kind === "student-summary" ? studentSummaryTable : kind === "student-marks" ? studentMarksTable : kind === "student-attendance" ? studentAttendanceTable : studentFeesTable)(ctx, sid);
    }
    else if (kind === "year-summary") table = await yearSummaryTable(ctx);
    else return jsonError(404, "Unknown export.");
    return await respondTable(ctx, table, parseFormat(sp.get("format")), kind);
  } catch (e) {
    return errorResponse(e, "export_failed");
  }
}
