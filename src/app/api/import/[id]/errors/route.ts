import { getContext } from "@/lib/auth/next";
import { errorResponse, jsonError } from "@/lib/http";
import { importErrorReport } from "@/server/import";

export const dynamic = "force-dynamic";

/** Downloadable report of every row that could not be imported (permission-checked, school-scoped, audited). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx || ctx.mustChangePassword) return jsonError(401, "Unauthorized", { code: "UNAUTHENTICATED" });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonError(404, "Import not found.");
  try {
    const { fileName, csv } = await importErrorReport(ctx, id);
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${fileName}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    return errorResponse(e, "import_report_failed");
  }
}
