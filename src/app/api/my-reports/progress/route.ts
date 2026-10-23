import { getContext } from "@/lib/auth/next";
import { errorResponse, jsonError } from "@/lib/http";
import { parseFormat } from "@/lib/export/table";
import { respondTable } from "@/server/export-response";
import { childProgressTable } from "@/server/student-exports";

export const dynamic = "force-dynamic";

/** A parent's or student's progress report for their own child (from the PUBLISHED report cards only) as Excel, PDF or CSV. Other children give "not found". */
export async function GET(request: Request) {
  const ctx = await getContext();
  if (!ctx || ctx.mustChangePassword) return jsonError(401, "Unauthorized", { code: "UNAUTHENTICATED" });
  if (ctx.userType === "STAFF") return jsonError(403, "Forbidden", { code: "FORBIDDEN" });
  const sp = new URL(request.url).searchParams;
  const sid = sp.get("studentId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(sid)) return jsonError(404, "Student not found.");
  try {
    return await respondTable(ctx, await childProgressTable(ctx, sid), parseFormat(sp.get("format")), "my-progress");
  } catch (e) {
    return errorResponse(e, "export_failed");
  }
}
