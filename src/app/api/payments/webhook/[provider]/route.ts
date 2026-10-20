import { NextResponse } from "next/server";
import { getRequestMeta } from "@/lib/auth/next";
import { MAX_WEBHOOK_BYTES, processProviderEvent } from "@/server/payment-events";

export const dynamic = "force-dynamic";

/**
 * Inbound payment notifications. Authenticated only by an HMAC signature over the raw body (no cookies, no CSRF
 * surface). Unknown or unconfigured providers are refused; verified events are stored once and only a successful,
 * matched one records a payment. See src/lib/payments/providers.ts.
 */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_WEBHOOK_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  const raw = await request.text();
  try {
    const reply = await processProviderEvent(provider, raw, request.headers, await getRequestMeta());
    return NextResponse.json(reply.body, { status: reply.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "payment_webhook_failed", provider, error: e instanceof Error ? e.message : String(e) }));
    return NextResponse.json({ error: "Could not process the notification" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405, headers: { Allow: "POST" } });
}
