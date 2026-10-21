import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth/next";
import { errorResponse, jsonError } from "@/lib/http";
import { isLocale } from "@/lib/i18n";
import { letterPdf } from "@/server/letter";

export const dynamic = "force-dynamic";

/** A message to parents as a printable school letter (`?lang=EN|SW`). Staff with comms.read only. Never cached. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx || ctx.mustChangePassword) return jsonError(401, "Unauthorized", { code: "UNAUTHENTICATED" });
  if (ctx.userType !== "STAFF") return jsonError(403, "Forbidden", { code: "FORBIDDEN" });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonError(404, "Message not found.");
  const lang = new URL(request.url).searchParams.get("lang");
  try {
    const bytes = await letterPdf(ctx, id, isLocale(lang) ? lang : ctx.locale);
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Length": String(bytes.length), "Content-Disposition": 'inline; filename="letter.pdf"', "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return errorResponse(e, "letter_pdf_failed");
  }
}
