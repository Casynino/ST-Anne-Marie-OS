import { getContext } from "@/lib/auth/next";
import { errorResponse, jsonError } from "@/lib/http";
import { parseFormat } from "@/lib/export/table";
import { FINANCE_EXPORTS, financeTable, type FinanceExport } from "@/server/exports";
import { respondTable } from "@/server/export-response";

export const dynamic = "force-dynamic";

/** Finance reports as CSV, Excel or PDF. Each type needs the same permission as its on-screen report. */
export async function GET(request: Request) {
  const ctx = await getContext();
  if (!ctx || ctx.mustChangePassword) return jsonError(401, "Unauthorized", { code: "UNAUTHENTICATED" });
  if (ctx.userType !== "STAFF") return jsonError(403, "Forbidden", { code: "FORBIDDEN" });
  const sp = new URL(request.url).searchParams;
  const type = sp.get("type") as FinanceExport;
  if (!FINANCE_EXPORTS.includes(type)) return jsonError(400, "Unknown export type.");
  try {
    const table = await financeTable(ctx, type, { termId: sp.get("termId") || undefined, classId: sp.get("classId") || undefined, from: sp.get("from") || undefined, to: sp.get("to") || undefined });
    return await respondTable(ctx, table, parseFormat(sp.get("format")), `finance-${type}`);
  } catch (e) {
    return errorResponse(e, "finance_export_failed");
  }
}
