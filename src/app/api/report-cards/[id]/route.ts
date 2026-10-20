import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth/next";
import { errorResponse, jsonError } from "@/lib/http";
import { isLocale } from "@/lib/i18n";
import { getReportCard, auditDownload } from "@/server/report-cards";
import { getMyReportCard, recordMyDownload } from "@/server/portal";
import { renderCardsPdf } from "@/server/report-card-pdf";

export const dynamic = "force-dynamic";

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);

/**
 * One report card as PDF. Staff need reportcard.read; parents and students get it only when the card is
 * PUBLISHED and belongs to one of their own children. Never cached, every download is audited.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx || ctx.mustChangePassword) return jsonError(401, "Unauthorized", { code: "UNAUTHENTICATED" });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonError(404, "Report card not found.");
  const lang = new URL(request.url).searchParams.get("lang");
  const locale = isLocale(lang) ? lang : ctx.locale;
  try {
    let snapshot;
    if (ctx.userType === "STAFF") {
      snapshot = (await getReportCard(ctx, id)).snapshot;
      await auditDownload(ctx, id, snapshot.student.name);
    } else {
      snapshot = (await getMyReportCard(ctx, id)).snapshot;
      await recordMyDownload(ctx, id, snapshot.student.name);
    }
    const bytes = await renderCardsPdf(ctx.schoolId, [snapshot], locale);
    const name = safeName(`report-${snapshot.student.admissionNo}-${snapshot.term.name}-${snapshot.term.year}`) + ".pdf";
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `inline; filename="${name}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return errorResponse(e, "report_card_pdf_failed");
  }
}
