import type { CalendarItem } from "@/server/calendar";
import type { Translate } from "@/lib/i18n";
import { GRADIENT, type GradientTone } from "@/components/dash/parts";

const DAY = 86_400_000;
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Colour tells the kinds apart (and the legend names them); every card still says what it is in text. */
const toneOf = (i: CalendarItem): GradientTone => (i.kind === "TERM_START" ? "green" : i.kind === "TERM_END" ? "orange" : i.isPublic ? "teal" : "violet");

function parts(i: CalendarItem, locale: "EN" | "SW") {
  const lang = locale === "SW" ? "sw" : "en-GB";
  const start = utc(i.from), end = i.to && i.to > i.from ? utc(i.to) : null;
  const wd = (d: Date) => new Intl.DateTimeFormat(lang, { weekday: "short", timeZone: "UTC" }).format(d).replace(".", "").toUpperCase();
  const mon = (d: Date) => new Intl.DateTimeFormat(lang, { month: "short", timeZone: "UTC" }).format(d).replace(".", "");
  const sameMonth = end ? start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear() : true;
  const shortRange = end ? (end.getTime() - start.getTime()) / DAY < 7 && sameMonth : false;
  return {
    start, end,
    weekday: end && shortRange ? `${wd(start)}–${wd(end)}` : wd(start),
    day: end && sameMonth ? `${start.getUTCDate()}–${end.getUTCDate()}` : String(start.getUTCDate()),
    monthShort: mon(start),
    until: end && !sameMonth ? `${end.getUTCDate()} ${mon(end)} ${end.getUTCFullYear()}` : null,
  };
}

function status(i: CalendarItem, today: string, t: Translate): { text: string; past: boolean; now: boolean } {
  const last = i.to ?? i.from;
  if (last < today) return { text: t("cal.done"), past: true, now: false };
  if (i.from <= today) return { text: i.from === today && !i.to ? t("cal.today") : t("cal.now"), past: false, now: true };
  const n = Math.round((utc(i.from).getTime() - utc(today).getTime()) / DAY);
  return { text: n === 1 ? t("cal.tomorrow") : n <= 60 ? t("cal.inDays", { n }) : "", past: false, now: false };
}

const titleOf = (i: CalendarItem, locale: "EN" | "SW") => (locale === "SW" && i.titleSw ? i.titleSw : i.title);

/** The three things coming next, as big cards with the day in large type. */
function Upcoming({ items, today, locale, t }: { items: CalendarItem[]; today: string; locale: "EN" | "SW"; t: Translate }) {
  const next = items.filter((i) => (i.to ?? i.from) >= today).slice(0, 3);
  if (next.length === 0) return null;
  return (
    <section aria-label={t("cal.upcoming")} className="mb-8">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-[.1em] text-muted">{t("cal.upcoming")}</h2>
      <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]">
        {next.map((i) => {
          const p = parts(i, locale), s = status(i, today, t);
          return (
            <li key={i.id} className={`flex min-h-36 flex-col justify-between rounded-xl bg-gradient-to-br p-4 text-white shadow-[var(--shadow-card)] ${GRADIENT[toneOf(i)]}`}>
              <div className="flex items-start justify-between gap-3">
                <span className="text-xs font-semibold tracking-[.12em] text-white/85">{p.weekday} · {p.monthShort.toUpperCase()}</span>
                {s.text && <span className="rounded-md bg-white/20 px-2 py-0.5 text-[11px] font-medium">{s.text}</span>}
              </div>
              <div>
                <p className="text-5xl font-bold leading-none tabular-nums tracking-tight">{p.day}</p>
                <p className="mt-2 text-base font-semibold leading-snug">{titleOf(i, locale)}</p>
                {(i.location || p.until) && <p className="mt-0.5 text-sm text-white/85">{[i.location, p.until ? t("cal.until", { date: p.until }) : null].filter(Boolean).join(" · ")}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The school calendar as event cards (like a printed "upcoming events" poster): a white date tile with the weekday and the day, and beside it a
 * coloured card with what happens and where. A strip of the next three events comes first, then every month in order, with a legend for the colours.
 * Past events are dimmed, today and events happening now are marked. Nothing is invented: only term dates and the school's own events appear.
 */
export function EventCalendar({ items, today, locale, t, upcoming = true, monthFormat }: { items: CalendarItem[]; today: string; locale: "EN" | "SW"; t: Translate; upcoming?: boolean; monthFormat?: (d: Date) => string }) {
  const lang = locale === "SW" ? "sw" : "en-GB";
  const monthLabel = monthFormat ?? ((d: Date) => new Intl.DateTimeFormat(lang, { month: "long", year: "numeric", timeZone: "UTC" }).format(d));
  const months = new Map<string, CalendarItem[]>();
  for (const i of items) { const k = i.from.slice(0, 7); months.set(k, [...(months.get(k) ?? []), i]); }
  const pastMonths = [...months].filter(([, list]) => list.every((i) => (i.to ?? i.from) < today));
  const Month = ({ m, list }: { m: string; list: CalendarItem[] }) => (
    <section className="mb-8">
      <h2 className="mb-3"><span className="inline-block rounded-md bg-sun px-3 py-1 text-sm font-bold uppercase tracking-[.06em] text-[#14281d]">{monthLabel(utc(`${m}-01`))}</span></h2>
      <ul className="grid gap-3 lg:grid-cols-2">
        {list.map((i) => {
          const p = parts(i, locale), s = status(i, today, t);
          return (
            <li key={i.id} className={`flex overflow-hidden rounded-xl shadow-[var(--shadow-card)] ${s.past ? "opacity-70" : ""} ${s.now ? "ring-2 ring-sun" : ""}`}>
              <div className="flex w-24 shrink-0 flex-col items-center justify-center bg-white px-2 py-3 text-center">
                <span className="text-[11px] font-bold tracking-[.1em] text-[#0a7048]">{p.weekday}</span>
                <span className="text-3xl font-extrabold leading-tight tabular-nums text-[#0b3d2a]">{p.day}</span>
              </div>
              <div className={`min-w-0 flex-1 bg-gradient-to-br px-4 py-3 text-white ${GRADIENT[toneOf(i)]}`}>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-base font-semibold leading-snug">{titleOf(i, locale)}</p>
                  {s.text && <span className="shrink-0 text-[11px] font-medium text-white/85">{s.text}</span>}
                </div>
                {(i.location || p.until || !i.isPublic) && (
                  <p className="mt-0.5 text-sm text-white/85">{[i.location, p.until ? t("cal.until", { date: p.until }) : null, !i.isPublic ? t("cal.internal") : null].filter(Boolean).join(" · ")}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
  const legend: [GradientTone, string][] = [["green", t("cal.legend.start")], ["orange", t("cal.legend.end")], ["teal", t("cal.legend.events")], ["violet", t("cal.legend.internal")]];
  const present = new Set(items.map(toneOf));
  return (
    <>
      {upcoming && <Upcoming items={items} today={today} locale={locale} t={t} />}
      <ul className="mb-6 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted" aria-label={t("cal.legend")}>
        {legend.filter(([tone]) => present.has(tone)).map(([tone, label]) => <li key={tone} className="flex items-center gap-2"><span aria-hidden className={`size-3 rounded-sm bg-gradient-to-br ${GRADIENT[tone]}`} />{label}</li>)}
      </ul>
      {[...months].filter(([, list]) => !list.every((i) => (i.to ?? i.from) < today)).map(([m, list]) => <Month key={m} m={m} list={list} />)}
      {pastMonths.length > 0 && (
        <details className="mb-6">
          <summary className="mb-4 min-h-10 cursor-pointer py-2 text-sm font-medium text-link hover:underline">{t("cal.earlier", { n: pastMonths.reduce((n, [, l]) => n + l.length, 0) })}</summary>
          {pastMonths.map(([m, list]) => <Month key={m} m={m} list={list} />)}
        </details>
      )}
    </>
  );
}
