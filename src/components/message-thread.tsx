import type { MessageView } from "@/server/messaging";
import type { Translate } from "@/lib/i18n";
import { displayDateTime } from "@/lib/dates";

/** The conversation as a list of bubbles. Hidden messages never show their text to participants. */
export function MessageList({ messages, t, timezone, actions }: { messages: MessageView[]; t: Translate; timezone: string; actions?: (m: MessageView) => React.ReactNode }) {
  return (
    <ol className="space-y-3">
      {messages.map((m) => (
        <li key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm ${m.hidden ? "border border-dashed border-line bg-canvas text-muted" : m.mine ? "bg-brand-700 text-white" : "border border-line bg-white"}`}>
            <p className={`mb-1 text-xs ${m.mine && !m.hidden ? "text-brand-100" : "text-muted"}`}>{m.senderName} · {displayDateTime(m.createdAt, timezone)}</p>
            {m.hidden && m.body === null ? <p className="italic">{t("msg.hiddenByModerator")}</p> : <p className="whitespace-pre-line break-words">{m.body}</p>}
            {m.hidden && m.body !== null && <p className="mt-1 text-xs italic">{t("msg.hiddenNote")}{m.hiddenReason ? `: ${m.hiddenReason}` : ""}</p>}
            {m.flagged && <p className="mt-1 text-xs font-medium text-warn">{t("msg.flaggedBadge")}</p>}
            {actions?.(m)}
          </div>
        </li>
      ))}
    </ol>
  );
}
