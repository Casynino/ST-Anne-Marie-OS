"use client";

import { AlertTriangle, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { en } from "@/lib/i18n/en";
import type { MessageKey, Translate } from "@/lib/i18n";
import type { QueuedOp } from "@/lib/offline/store";

const has = (k: string): k is MessageKey => k in en;
const NO_RETRY = new Set(["ROSTER_CHANGED", "INCOMPLETE", "EMPTY_ROSTER", "FORBIDDEN"]);

const TONE = {
  queued: "border-line bg-white text-ink",
  syncing: "border-line bg-white text-ink",
  synced: "border-ok/30 bg-green-50 text-ok",
  failed: "border-bad/30 bg-red-50 text-bad",
  conflict: "border-warn/30 bg-amber-50 text-warn",
} as const;

/** One outbox entry with an honest state. "Synced" is shown only when the server confirmed it. */
export function OpStatus({ op, t, onRetry, onDiscard, showLabel }: { op: QueuedOp; t: Translate; onRetry: () => void; onDiscard: () => void; showLabel?: boolean }) {
  const Icon = { queued: Clock, syncing: Loader2, synced: CheckCircle2, failed: XCircle, conflict: AlertTriangle }[op.state];
  const detail =
    op.state === "queued" ? t("off.savedLocally")
    : op.state === "synced" ? t("off.savedSynced")
    : op.state === "conflict" ? (has(`off.conflict.${op.lastCode}`) ? t(`off.conflict.${op.lastCode}` as MessageKey) : t("off.conflict.generic"))
    : op.state === "failed" ? (op.lastCode && has(`off.reason.${op.lastCode}`) ? t(`off.reason.${op.lastCode}` as MessageKey) : t("off.reason.generic", { message: op.lastMessage ?? op.lastCode ?? "" }))
    : "";
  const retryable = op.state === "failed" && !(op.lastCode && NO_RETRY.has(op.lastCode));
  return (
    <div role="status" className={`mb-3 rounded-lg border px-3 py-2 text-sm ${TONE[op.state]}`}>
      <p className="flex items-center gap-2 font-semibold">
        <Icon className={`size-4 shrink-0 ${op.state === "syncing" ? "animate-spin" : ""}`} aria-hidden />
        {t(`off.state.${op.state}`)}
        {showLabel && <span className="font-normal text-muted"> · {op.label}</span>}
      </p>
      {detail && <p className="mt-1 text-sm">{detail}</p>}
      {op.state === "queued" && op.lastCode === "NETWORK" && <p className="mt-1 text-sm text-muted">{t("off.offline.hint")}</p>}
      {(op.state === "failed" || op.state === "conflict" || op.state === "queued" || op.state === "synced") && (
        <div className="mt-2 flex flex-wrap gap-2">
          {retryable && (
            <button type="button" onClick={onRetry} className="min-h-11 rounded-lg border border-current px-3 text-sm font-medium">
              {t("off.retry")}
            </button>
          )}
          {(op.state === "failed" || op.state === "conflict" || op.state === "synced") && (
            <button
              type="button"
              onClick={() => (op.state === "failed" && !window.confirm(t("off.discard.confirm")) ? undefined : onDiscard())}
              className="min-h-11 rounded-lg border border-line bg-white px-3 text-sm font-medium text-ink"
            >
              {op.state === "failed" ? t("off.discard") : t("common.confirm")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
