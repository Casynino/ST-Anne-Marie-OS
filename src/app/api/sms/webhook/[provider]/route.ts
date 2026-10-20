import { NextResponse } from "next/server";
import { MAX_REPORT_BYTES, processSmsReport } from "@/server/sms-reports";

export const dynamic = "force-dynamic";

/** SMS delivery reports from the provider. Authenticated only by an HMAC signature over the raw body; see src/lib/sms/reports.ts. */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (Number(request.headers.get("content-length") ?? "0") > MAX_REPORT_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  const raw = await request.text();
  try {
    const r = await processSmsReport(provider, raw, request.headers);
    return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "sms_report_failed", provider, error: e instanceof Error ? e.message : String(e) }));
    return NextResponse.json({ error: "Could not process the report" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405, headers: { Allow: "POST" } });
}
