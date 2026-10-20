import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth/next";
import { errorResponse, jsonError } from "@/lib/http";
import { isLocale } from "@/lib/i18n";
import { cardsForClass, auditDownload } from "@/server/report-cards";
import { renderCardsPdf } from "@/server/report-card-pdf";

export const dynamic = "force-dynamic";

/** All report cards of a class (and stream) in one PDF, best position first. Staff only (reportcard.read). */
export async function GET(request: Request) {
  const ctx = await getContext();
  if (!ctx || ctx.mustChangePassword) return jsonError(401, "Unauthorized", { code: "UNAUTHENTICATED" });
  if (ctx.userType !== "STAFF") return jsonError(403, "Forbidden", { code: "FORBIDDEN" });
  const sp = new URL(request.url).searchParams;
  const lang = sp.get("lang");
  try {
    const cards = await cardsForClass(ctx, { termId: sp.get("termId") ?? "", classId: sp.get("classId") ?? "", streamId: sp.get("streamId") || undefined });
    if (!cards.length) return jsonError(404, "There are no report cards to print for this class yet.");
    const bytes = await renderCardsPdf(ctx.schoolId, cards.map((c) => c.snapshot), isLocale(lang) ? lang : ctx.locale);
    await auditDownload(ctx, cards[0]!.id, `${cards[0]!.snapshot.class.name} (${cards.length} cards)`, { count: cards.length });
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `inline; filename="report-cards-${cards[0]!.snapshot.class.name.replace(/[^A-Za-z0-9]+/g, "_")}.pdf"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return errorResponse(e, "report_cards_class_pdf_failed");
  }
}
