import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth/next";
import { errorResponse, jsonError } from "@/lib/http";
import { isLocale } from "@/lib/i18n";
import { db } from "@/lib/db";
import { actorOf, writeAudit } from "@/server/audit";
import { applicationFormPdf } from "@/server/application-pdf";

export const dynamic = "force-dynamic";

/** The online application as a printable form (`?lang=EN|SW`). The family that applied, or staff who read admissions. Never cached; each download is audited. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx || ctx.mustChangePassword) return jsonError(401, "Unauthorized", { code: "UNAUTHENTICATED" });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonError(404, "Application not found.");
  const lang = new URL(request.url).searchParams.get("lang");
  try {
    const bytes = await applicationFormPdf(ctx, id, isLocale(lang) ? lang : ctx.locale);
    await writeAudit(db, actorOf(ctx), { action: "admission.application_form_download", entityType: "ApplicationDraft", entityId: id });
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Length": String(bytes.length), "Content-Disposition": 'inline; filename="application-form.pdf"', "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return errorResponse(e, "application_form_pdf_failed");
  }
}
