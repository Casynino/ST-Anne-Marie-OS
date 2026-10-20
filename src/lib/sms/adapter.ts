/**
 * SMS provider boundary. The school has not chosen a provider yet, so NO provider is implemented and
 * NO credentials are read here. Phase 6 adds a concrete adapter (Selcom/AzamPay/ClickPesa/…) behind this
 * interface and selects it with SMS_PROVIDER. Until then the notification processor records SMS as
 * SKIPPED ("provider not configured") — nothing is ever reported as sent or delivered.
 *
 * Status semantics for real adapters (Phase 6): `send` returns SUBMITTED when the provider ACCEPTED the
 * message — that is not delivery. DELIVERED only comes from a verified provider delivery report.
 */
export type SmsSendRequest = {
  /** E.164 number, e.g. +255712345678. */
  to: string;
  body: string;
  /** Stable id (the notification event id) so providers/webhooks can be reconciled and retries deduped. */
  reference: string;
};

export type SmsSendResult = { status: "SUBMITTED"; providerRef: string } | { status: "FAILED"; error: string; retryable: boolean };

export interface SmsAdapter {
  readonly name: string;
  isConfigured(): boolean;
  send(request: SmsSendRequest): Promise<SmsSendResult>;
}

export class NotConfiguredSmsAdapter implements SmsAdapter {
  readonly name = "none";
  isConfigured() {
    return false;
  }
  async send(): Promise<SmsSendResult> {
    return { status: "FAILED", error: "No SMS provider is configured.", retryable: false };
  }
}

let current: SmsAdapter = new NotConfiguredSmsAdapter();

export function getSmsAdapter(): SmsAdapter {
  return current;
}

/** Test seam and the hook for Phase 6 provider registration. */
export function setSmsAdapter(adapter: SmsAdapter | null) {
  current = adapter ?? new NotConfiguredSmsAdapter();
}
