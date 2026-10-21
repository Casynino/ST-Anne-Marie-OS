import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth/next";
import { errorResponse, jsonError } from "@/lib/http";
import { isLocale } from "@/lib/i18n";
import { db } from "@/lib/db";
import { actorOf, writeAudit } from "@/server/audit";
import { admissionReceiptPdf } from "@/server/admission-pdf";

export const dynamic = "force-dynamic";

/** Receipt for a verified admission payment. Reprinting never records a payment. Staff with admission payment or admission read rights only. */
export async function GET(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const ctx = await getContext();
  if (!ctx || ctx.mustChangePassword) return jsonError(401, "Unauthorized", { code: "UNAUTHENTICATED" });
  if (ctx.userType !== "STAFF") return jsonError(403, "Forbidden", { code: "FORBIDDEN" });
  const { paymentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) return jsonError(404, "Receipt not found.");
  const lang = new URL(request.url).searchParams.get("lang");
  try {
    const bytes = await admissionReceiptPdf(ctx, paymentId, isLocale(lang) ? lang : ctx.locale);
    await writeAudit(db, actorOf(ctx), { action: "admission_receipt.download", entityType: "AdmissionPayment", entityId: paymentId });
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Length": String(bytes.length), "Content-Disposition": 'inline; filename="admission-receipt.pdf"', "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return errorResponse(e, "admission_receipt_pdf_failed");
  }
}
