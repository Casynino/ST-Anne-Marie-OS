import { getContext } from "@/lib/auth/next";
import { jsonError } from "@/lib/http";
import { importTemplateCsv } from "@/server/import";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getContext();
  if (!ctx || ctx.mustChangePassword) return jsonError(401, "Unauthorized", { code: "UNAUTHENTICATED" });
  if (!ctx.permissions.has("student.import")) return jsonError(403, "Forbidden", { code: "FORBIDDEN" });
  return new Response(importTemplateCsv(), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="students-import-template.csv"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
