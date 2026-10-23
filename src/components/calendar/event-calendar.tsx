import type { ReactNode } from "react";
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

/** One event: a small coloured date tile (weekday and day) and the what-and-where beside it; quiet on the page, the tile carries the colour. */
function EventRow({ i, today, locale, t, action }: { i: CalendarItem; today: string; locale: "EN" | "SW"; t: Translate; action?: ReactNode }) {
  const p = parts(i, locale), s = status(i, today, t);
  const sub = [i.location, p.until ? t("cal.until", { date: p.until }) : null, !i.isPublic && i.kind === "EVENT" ? t("cal.internal") : null].filter(Boolean).join(" · ");
  return (
    <li className={`flex items-center gap-3 rounded-lg border bg-surface px-2.5 py-2 ${s.now ? "border-sun/70" : "border-line"} ${s.past ? "opacity-60" : ""}`}>
      <div className={`flex w-14 shrink-0 flex-col items-center justify-center rounded-md bg-gradient-to-br py-1 text-white ${GRADIENT[toneOf(i)]}`}>
        <span className="text-[9px] font-bold leading-tight tracking-[.1em] text-white/85">{p.weekday}</span>
        <span className="text-lg font-extrabold leading-tight tabular-nums">{p.day}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{titleOf(i, locale)}</p>
        {sub && <p className="truncate text-xs text-muted">{sub}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        {s.text && <span className={`text-[11px] font-medium ${s.now ? "text-sun" : "text-muted"}`}>{s.text}</span>}
        {action}
      </div>
    </li>
  );
}

/**
 * The school calendar as small event cards (like a printed "upcoming events" sheet): every month in order, a coloured date tile on each card,
 * today and what is happening now marked, past events dimmed and months that are over folded away. Nothing is invented: only term dates and
 * the school's own events appear. `action` lets a page add a small control to an event (for example Edit).
 */
export function EventCalendar({ items, today, locale, t, upcoming = true, action }: { items: CalendarItem[]; today: string; locale: "EN" | "SW"; t: Translate; upcoming?: boolean; action?: (i: CalendarItem) => ReactNode }) {
  const lang = locale === "SW" ? "sw" : "en-GB";
  const monthLabel = (d: Date) => new Intl.DateTimeFormat(lang, { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  const months = new Map<string, CalendarItem[]>();
  for (const i of items) { const k = i.from.slice(0, 7); months.set(k, [...(months.get(k) ?? []), i]); }
  const isOver = (list: CalendarItem[]) => list.every((i) => (i.to ?? i.from) < today);
  const pastMonths = [...months].filter(([, l]) => isOver(l));
  const next = upcoming ? items.filter((i) => (i.to ?? i.from) >= today).slice(0, 3) : [];
  const legend: [GradientTone, string][] = [["green", t("cal.legend.start")], ["orange", t("cal.legend.end")], ["teal", t("cal.legend.events")], ["violet", t("cal.legend.internal")]];
  const present = new Set(items.map(toneOf));
  const Month = ({ m, list }: { m: string; list: CalendarItem[] }) => (
    <section className="mb-6">
      <h2 className="mb-2"><span className="inline-block rounded-md bg-sun px-2.5 py-0.5 text-xs font-bold uppercase tracking-[.08em] text-[#14281d]">{monthLabel(utc(`${m}-01`))}</span></h2>
      <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{list.map((i) => <EventRow key={i.id} i={i} today={today} locale={locale} t={t} action={action?.(i)} />)}</ul>
    </section>
  );
  return (
    <>
      {next.length > 0 && (
        <section aria-label={t("cal.upcoming")} className="mb-5">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-[.1em] text-muted">{t("cal.upcoming")}</h2>
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{next.map((i) => <EventRow key={i.id} i={i} today={today} locale={locale} t={t} action={action?.(i)} />)}</ul>
        </section>
      )}
      <ul className="mb-5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label={t("cal.legend")}>
        {legend.filter(([tone]) => present.has(tone)).map(([tone, label]) => <li key={tone} className="flex items-center gap-1.5"><span aria-hidden className={`size-2.5 rounded-sm bg-gradient-to-br ${GRADIENT[tone]}`} />{label}</li>)}
      </ul>
      {[...months].filter(([, l]) => !isOver(l)).map(([m, l]) => <Month key={m} m={m} list={l} />)}
      {pastMonths.length > 0 && (
        <details className="mb-6">
          <summary className="mb-3 min-h-9 cursor-pointer py-1.5 text-sm font-medium text-link hover:underline">{t("cal.earlier", { n: pastMonths.reduce((n, [, l]) => n + l.length, 0) })}</summary>
          {pastMonths.map(([m, l]) => <Month key={m} m={m} list={l} />)}
        </details>
      )}
    </>
  );
}
