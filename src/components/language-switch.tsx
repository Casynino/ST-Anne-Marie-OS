import { setLocaleAction } from "@/app/actions-shared";
import type { Locale } from "@/lib/i18n";

export function LanguageSwitch({ current, dark }: { current: Locale; dark?: boolean }) {
  return (
    <form action={setLocaleAction} className="inline-flex rounded-lg border border-current/20 p-0.5 text-xs font-semibold" aria-label="Language / Lugha">
      {(["EN", "SW"] as const).map((l) => (
        <button
          key={l}
          name="locale"
          value={l}
          aria-pressed={current === l}
          className={`min-h-9 min-w-10 rounded-md px-2 ${current === l ? (dark ? "bg-surface text-heading" : "bg-brand-700 text-white") : dark ? "text-brand-100 hover:bg-brand-800" : "text-muted hover:bg-canvas"}`}
        >
          {l === "EN" ? "EN" : "SW"}
        </button>
      ))}
    </form>
  );
}
