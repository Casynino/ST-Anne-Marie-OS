import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth/next";
import { errorResponse, jsonError } from "@/lib/http";
import { isLocale } from "@/lib/i18n";
import { feeSheetPdf } from "@/server/fee-sheet";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** Fee table PDF for one academic year: `?yearId=` plus optionally `structureId=` (otherwise every active structure). Needs fees.read. Never cached. */
export async function GET(request: Request) {
  const ctx = await getContext();
  if (!ctx || ctx.mustChangePassword) return jsonError(401, "Unauthorized", { code: "UNAUTHENTICATED" });
  if (ctx.userType !== "STAFF") return jsonError(403, "Forbidden", { code: "FORBIDDEN" });
  const q = new URL(request.url).searchParams;
  const yearId = q.get("yearId") ?? "";
  const structureId = q.get("structureId");
  if (!UUID.test(yearId) || (structureId && !UUID.test(structureId))) return jsonError(400, "Choose an academic year.");
  const lang = q.get("lang");
  try {
    const bytes = await feeSheetPdf(ctx, { yearId, structureId }, isLocale(lang) ? lang : ctx.locale);
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Length": String(bytes.length), "Content-Disposition": 'inline; filename="fee-structure.pdf"', "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return errorResponse(e, "fee_sheet_pdf_failed");
  }
}
