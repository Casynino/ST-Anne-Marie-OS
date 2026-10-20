import { z } from "zod";
import { verifySignature } from "@/lib/payments/providers";

/*
 * SMS delivery reports. No SMS provider is chosen, so every provider here is "not connected" until
 * SMS_<PROVIDER>_WEBHOOK_SECRET is set (at least 16 characters). A report is accepted only when its HMAC-SHA256
 * signature over the raw body (hex, X-Signature) verifies. Provider-specific payloads are mapped here when a provider
 * is chosen; the neutral format below is what an integration or gateway must deliver.
 */
export const SMS_PROVIDER_KEYS = ["selcom", "azampay", "clickpesa", "gateway"] as const;
export const smsSecretEnvName = (key: string) => `SMS_${key.toUpperCase()}_WEBHOOK_SECRET`;

export function smsProviderState(key: string, env: Record<string, string | undefined> = process.env) {
  const secret = env[smsSecretEnvName(key)]?.trim() ?? "";
  return { key, configured: secret.length >= 16, secret };
}

export const deliveryReportSchema = z.object({
  providerRef: z.string().trim().min(1).max(120),
  status: z.string().trim().transform((s) => s.toUpperCase()).pipe(z.enum(["DELIVERED", "FAILED", "UNDELIVERED"])),
  reason: z.string().trim().max(200).optional(),
});

export const verifyReport = (secret: string, raw: string, header: string | null) => verifySignature(secret, raw, header);
