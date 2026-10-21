import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth/next";
import { errorResponse, jsonError } from "@/lib/http";
import { isLocale } from "@/lib/i18n";
import { db } from "@/lib/db";
import { actorOf, writeAudit } from "@/server/audit";
import { offerLetterPdf } from "@/server/admission-pdf";

export const dynamic = "force-dynamic";

/** The admission offer as a printable letter (`?lang=EN|SW`). Staff with admission.read only. Never cached; each download is audited. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx || ctx.mustChangePassword) return jsonError(401, "Unauthorized", { code: "UNAUTHENTICATED" });
  if (ctx.userType !== "STAFF") return jsonError(403, "Forbidden", { code: "FORBIDDEN" });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonError(404, "Application not found.");
  const lang = new URL(request.url).searchParams.get("lang");
  try {
    const bytes = await offerLetterPdf(ctx, id, isLocale(lang) ? lang : ctx.locale);
    await writeAudit(db, actorOf(ctx), { action: "admission.offer_letter_download", entityType: "Application", entityId: id });
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Length": String(bytes.length), "Content-Disposition": 'inline; filename="offer-letter.pdf"', "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return errorResponse(e, "offer_letter_pdf_failed");
  }
}
