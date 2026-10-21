import { setLocaleAction } from "@/app/actions-shared";
import type { Locale } from "@/lib/i18n";

/** `pill` is the rounded segmented control used in the public website header. */
export function LanguageSwitch({ current, dark, pill }: { current: Locale; dark?: boolean; pill?: boolean }) {
  return (
    <form action={setLocaleAction} className={`inline-flex border border-current/20 p-0.5 text-xs font-semibold ${pill ? "rounded-full" : "rounded-lg"}`} aria-label="Language / Lugha">
      {(["EN", "SW"] as const).map((l) => (
        <button
          key={l}
          name="locale"
          value={l}
          aria-pressed={current === l}
          className={`min-h-9 min-w-10 px-2 ${pill ? "rounded-full text-[13px]" : "rounded-md"} ${current === l ? (dark ? "bg-surface text-heading" : "bg-brand-700 text-white") : dark ? "text-brand-100 hover:bg-brand-800" : "text-muted hover:bg-canvas"}`}
        >
          {l === "EN" ? "EN" : "SW"}
        </button>
      ))}
    </form>
  );
}
