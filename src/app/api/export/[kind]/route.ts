import { getContext } from "@/lib/auth/next";
import { errorResponse, jsonError } from "@/lib/http";
import { parseFormat } from "@/lib/export/table";
import { admissionsTable, attendanceTable, studentsTable, resultsTable } from "@/server/exports";
import { deskTable } from "@/server/admission-desk";
import { respondTable } from "@/server/export-response";

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
    else return jsonError(404, "Unknown export.");
    return await respondTable(ctx, table, parseFormat(sp.get("format")), kind);
  } catch (e) {
    return errorResponse(e, "export_failed");
  }
}
