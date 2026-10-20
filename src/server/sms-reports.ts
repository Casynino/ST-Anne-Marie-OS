import { db } from "@/lib/db";
import { SMS_PROVIDER_KEYS, deliveryReportSchema, smsProviderState, verifyReport } from "@/lib/sms/reports";

export const MAX_REPORT_BYTES = 64 * 1024;
type Reply = { status: number; body: Record<string, unknown> };

/**
 * A delivery report from the SMS provider. Verified by signature; it can only move a message that was SUBMITTED (or later
 * UNKNOWN) to DELIVERED or FAILED, and a message already DELIVERED never goes backwards. Unknown references are ignored.
 */
export async function processSmsReport(providerKey: string, rawBody: string, headers: { get(name: string): string | null }, env: Record<string, string | undefined> = process.env): Promise<Reply> {
  if (!(SMS_PROVIDER_KEYS as readonly string[]).includes(providerKey)) return { status: 404, body: { error: "Unknown provider" } };
  const p = smsProviderState(providerKey, env);
  if (!p.configured) return { status: 503, body: { error: "This provider is not configured" } };
  if (Buffer.byteLength(rawBody, "utf8") > MAX_REPORT_BYTES) return { status: 413, body: { error: "Payload too large" } };
  if (!verifyReport(p.secret, rawBody, headers.get("x-signature"))) return { status: 401, body: { error: "Invalid signature" } };
  let report;
  try {
    report = deliveryReportSchema.parse(JSON.parse(rawBody));
  } catch {
    return { status: 422, body: { error: "Unrecognised payload" } };
  }
  const delivered = report.status === "DELIVERED";
  const res = await db.notificationDelivery.updateMany({
    where: { channel: "SMS", providerRef: report.providerRef, status: { in: ["SUBMITTED", "UNKNOWN"] } },
    data: { status: delivered ? "DELIVERED" : "FAILED", detail: delivered ? "Delivery confirmed by the provider" : `Provider reported ${report.status.toLowerCase()}${report.reason ? `: ${report.reason}` : ""}` },
  });
  return { status: 200, body: { matched: res.count > 0 } };
}
