import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth/next";
import { errorResponse, jsonError } from "@/lib/http";
import { isLocale } from "@/lib/i18n";
import { db } from "@/lib/db";
import { actorOf, writeAudit } from "@/server/audit";
import { joiningPdf } from "@/server/joining-pdf";

export const dynamic = "force-dynamic";

/**
 * The joining instructions of an accepted applicant as a printable letter (`?lang=EN|SW`). Staff who read admissions use the application id; the
 * family that applied uses the id of their own application. Never cached; each download is audited.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx || ctx.mustChangePassword) return jsonError(401, "Unauthorized", { code: "UNAUTHENTICATED" });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonError(404, "Application not found.");
  const lang = new URL(request.url).searchParams.get("lang");
  try {
    const bytes = await joiningPdf(ctx, id, isLocale(lang) ? lang : ctx.locale);
    await writeAudit(db, actorOf(ctx), { action: "admission.joining_download", entityType: "Application", entityId: id });
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Length": String(bytes.length), "Content-Disposition": 'inline; filename="joining-instructions.pdf"', "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return errorResponse(e, "joining_pdf_failed");
  }
}
