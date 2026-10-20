import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth/next";
import { errorResponse, jsonError } from "@/lib/http";
import { isLocale } from "@/lib/i18n";
import { db } from "@/lib/db";
import { getPayment } from "@/server/payments";
import { getMyReceipt } from "@/server/portal";
import { receiptPdf } from "@/server/finance-pdf";
import { actorOf, writeAudit } from "@/server/audit";

export const dynamic = "force-dynamic";

/** Receipt PDF. Staff need fees.read; parents and students get only receipts of their own children's posted payments. Never cached. */
export async function GET(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const ctx = await getContext();
  if (!ctx || ctx.mustChangePassword) return jsonError(401, "Unauthorized", { code: "UNAUTHENTICATED" });
  const { paymentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) return jsonError(404, "Receipt not found.");
  const lang = new URL(request.url).searchParams.get("lang");
  const locale = isLocale(lang) ? lang : ctx.locale;
  try {
    let snapshot, voided: { reason: string | null } | null = null;
    if (ctx.userType === "STAFF") {
      const p = await getPayment(ctx, paymentId);
      if (!p.snapshot) return jsonError(404, "Receipt not found.");
      snapshot = p.snapshot;
      if (p.payment.receipt?.voidedAt) voided = { reason: p.payment.receipt.voidReason };
    } else {
      snapshot = (await getMyReceipt(ctx, paymentId)).snapshot;
    }
    await writeAudit(db, actorOf(ctx), { action: "receipt.download", entityType: "Payment", entityId: paymentId, summary: snapshot.number });
    const bytes = await receiptPdf(ctx.schoolId, snapshot, voided, locale);
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Length": String(bytes.length), "Content-Disposition": `inline; filename="${snapshot.number.replace(/[^A-Za-z0-9._-]+/g, "_")}.pdf"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return errorResponse(e, "receipt_pdf_failed");
  }
}
