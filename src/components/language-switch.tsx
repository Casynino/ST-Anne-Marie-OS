import { setLocaleAction } from "@/app/actions-shared";
import type { Locale } from "@/lib/i18n";

/** `pill` is the plain text switch used on the public website and the sign-in page ("EN | SW", the current one underlined); the default is a small bordered switch for the staff area. */
export function LanguageSwitch({ current, dark, pill }: { current: Locale; dark?: boolean; pill?: boolean }) {
  if (pill) {
    return (
      <form action={setLocaleAction} className={`inline-flex items-center text-[15px] font-semibold ${dark ? "text-white" : "text-brand-800"}`} aria-label="Language / Lugha">
        {(["EN", "SW"] as const).map((l, i) => (
          <span key={l} className="inline-flex items-center">
            {i > 0 && <span aria-hidden className="mx-1 opacity-30">|</span>}
            <button name="locale" value={l} aria-pressed={current === l} className={`min-h-11 px-2 ${current === l ? "underline decoration-2 underline-offset-8" : "opacity-60 hover:opacity-100"}`}>{l}</button>
          </span>
        ))}
      </form>
    );
  }
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
          {l}
        </button>
      ))}
    </form>
  );
}
