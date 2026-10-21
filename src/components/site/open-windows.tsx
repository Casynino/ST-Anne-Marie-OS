import type { Translate } from "@/lib/i18n";
import { displayDate, displayDateTime } from "@/lib/dates";
import type { OpenWindow } from "@/server/interview-days";

/** The application windows that are open now: which classes, until when, and the interview date a family gets by applying. */
export function OpenWindows({ windows, t, locale, timezone, heading = true }: { windows: OpenWindow[]; t: Translate; locale: "EN" | "SW"; timezone: string; heading?: boolean }) {
  return (
    <section aria-labelledby="open-windows" className="border border-line bg-surface p-5 sm:p-7">
      {heading && <h2 id="open-windows" className="display text-3xl text-heading">{t("adm.win.public.title")}</h2>}
      {windows.length > 0 ? (
        <ul className="mt-4 divide-y divide-line">
          {windows.map((w) => (
            <li key={w.id} className="py-4 first:pt-0 last:pb-0">
              <p className="text-lg font-semibold text-heading">{w.name}{w.classNames.length > 0 && <span className="ml-2 text-base font-normal text-ink/75">· {w.classNames.join(", ")}</span>}</p>
              <p className="mt-1 text-sm text-ink/80">
                {w.closesOn ? `${t("adm.win.public.closes", { date: displayDate(new Date(`${w.closesOn}T00:00:00Z`), locale) })} · ` : ""}
                {t("adm.win.public.interview", { when: `${displayDateTime(w.startsAt, timezone, locale)}${w.venue ? `, ${w.venue}` : ""}` })}
              </p>
              {w.full && <p className="mt-1 text-sm text-warn">{t("adm.win.public.full")}</p>}
            </li>
          ))}
        </ul>
      ) : null}
      <p className={`${windows.length > 0 ? "mt-4 " : ""}text-sm text-muted`}>{t("adm.win.public.always")}</p>
    </section>
  );
}
