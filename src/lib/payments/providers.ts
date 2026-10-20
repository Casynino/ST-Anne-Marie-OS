import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { parseAmount } from "@/lib/finance/money";

/*
 * Payment provider interface. No provider has been chosen and no credentials exist, so every adapter is
 * "not configured" until PAYMENTS_<PROVIDER>_WEBHOOK_SECRET is set; an unconfigured provider's endpoint refuses
 * everything. Inbound notifications are authenticated with HMAC-SHA256 over the exact raw body (hex digest in the
 * X-Signature header, optionally prefixed "sha256="). The payload mapping below is the neutral format the school's
 * integration (or a small gateway in front of the provider) must deliver; when a provider is chosen and its
 * documentation and credentials are supplied, its adapter overrides `verify` and `parse` here, nowhere else.
 * Starting a payment (STK push / checkout) is deliberately not implemented: without credentials it cannot be
 * done honestly, and no success is ever simulated.
 */

export type NormalizedEvent = {
  providerEventId: string;
  status: "SUCCESS" | "FAILED" | "PENDING";
  amountCents: number | null;
  currency: string | null;
  reference: string | null;
  msisdn: string | null;
  occurredAt: Date | null;
};

type HeaderLike = { get(name: string): string | null };

export type PaymentProvider = {
  key: string;
  name: string;
  method: "MOBILE_MONEY" | "BANK";
  configured: boolean;
  verify(rawBody: string, headers: HeaderLike): boolean;
  parse(body: unknown): NormalizedEvent;
};

const eventSchema = z.object({
  eventId: z.string().trim().min(1).max(100),
  status: z.string().trim().transform((s) => s.toUpperCase()).pipe(z.enum(["SUCCESS", "FAILED", "PENDING"])),
  amount: z.union([z.string(), z.number()]).optional(),
  currency: z.string().trim().max(8).optional(),
  reference: z.string().trim().max(100).optional(),
  msisdn: z.string().trim().max(20).optional(),
  occurredAt: z.string().optional(),
});

export function parseNeutralEvent(body: unknown): NormalizedEvent {
  const e = eventSchema.parse(body);
  const amount = e.amount === undefined ? null : parseAmount(e.amount);
  const at = e.occurredAt ? new Date(e.occurredAt) : null;
  return {
    providerEventId: e.eventId, status: e.status, amountCents: amount, currency: e.currency ? e.currency.toUpperCase() : null,
    reference: e.reference || null, msisdn: e.msisdn || null, occurredAt: at && !Number.isNaN(at.getTime()) ? at : null,
  };
}

export function signBody(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

export function verifySignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const given = header.trim().replace(/^sha256=/i, "").toLowerCase();
  const expected = signBody(secret, rawBody);
  if (given.length !== expected.length || !/^[0-9a-f]+$/.test(given)) return false;
  return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
}

const DEFINITIONS: { key: string; name: string; method: "MOBILE_MONEY" | "BANK" }[] = [
  { key: "selcom", name: "Selcom", method: "MOBILE_MONEY" },
  { key: "azampay", name: "AzamPay", method: "MOBILE_MONEY" },
  { key: "clickpesa", name: "ClickPesa", method: "MOBILE_MONEY" },
  { key: "bank", name: "Bank notifications", method: "BANK" },
];

export const secretEnvName = (key: string) => `PAYMENTS_${key.toUpperCase()}_WEBHOOK_SECRET`;

export function getProviders(env: Record<string, string | undefined> = process.env): PaymentProvider[] {
  return DEFINITIONS.map((d) => {
    const secret = env[secretEnvName(d.key)]?.trim() ?? "";
    const configured = secret.length >= 16;
    return {
      ...d, configured,
      verify: (raw, headers) => configured && verifySignature(secret, raw, headers.get("x-signature")),
      parse: parseNeutralEvent,
    };
  });
}

export const getProvider = (key: string, env?: Record<string, string | undefined>) => getProviders(env).find((p) => p.key === key);
