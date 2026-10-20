import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth/next";
import { errorResponse, jsonError } from "@/lib/http";
import { isLocale } from "@/lib/i18n";
import { getInvoice } from "@/server/invoices";
import { getMyInvoiceId } from "@/server/portal";
import { invoicePdf } from "@/server/finance-pdf";

export const dynamic = "force-dynamic";

/** Invoice PDF. Staff need fees.read; parents and students get only live invoices of their own children. Never cached. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx || ctx.mustChangePassword) return jsonError(401, "Unauthorized", { code: "UNAUTHENTICATED" });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonError(404, "Invoice not found.");
  const lang = new URL(request.url).searchParams.get("lang");
  const locale = isLocale(lang) ? lang : ctx.locale;
  try {
    let number: string;
    if (ctx.userType === "STAFF") number = (await getInvoice(ctx, id)).invoice.number;
    else { await getMyInvoiceId(ctx, id); number = id; }
    const bytes = await invoicePdf(ctx.schoolId, id, locale);
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Length": String(bytes.length), "Content-Disposition": `inline; filename="${number.replace(/[^A-Za-z0-9._-]+/g, "_")}.pdf"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return errorResponse(e, "invoice_pdf_failed");
  }
}
