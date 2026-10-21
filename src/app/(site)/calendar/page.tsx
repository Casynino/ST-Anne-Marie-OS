import Link from "next/link";
import type { Metadata } from "next";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Rss } from "lucide-react";
import { getLocale, getT } from "@/lib/auth/next";
import { getSite, pageMetadata } from "@/lib/site";
import { schoolCalendar } from "@/server/calendar";
import { parseDateOnly, todayInTimezone } from "@/lib/dates";
import { itemsOn, monthGrid, monthKey, monthRange, parseMonth, shiftMonth, type CalItem } from "@/lib/calendar-grid";
import { ButtonLink, PageHero } from "@/components/site/blocks";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return pageMetadata(await getSite(), { title: t("site.cal.title"), path: "/calendar" });
}

const TONE = { TERM_START: "bg-brand-100 text-brand-900 ring-brand-300", TERM_END: "bg-brand-100 text-brand-900 ring-brand-300", EVENT: "bg-sun/35 text-[#3d3700] ring-sun/70" } as const;

/** The school's public calendar: term dates and public events as a month grid (a list on phones), with a feed people can subscribe to. */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string; cat?: string }> }) {
  const [site, t, locale, sp] = await Promise.all([getSite(), getT(), getLocale(), searchParams]);
  if (!site) return null;
  const today = todayInTimezone(site.school.timezone);
  const cur = parseMonth(sp.m) ?? { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  const grid = monthGrid(cur.year, cur.month);
  const from = parseDateOnly(grid[0]![0]!.date) as Date;
  const to = parseDateOnly(grid[grid.length - 1]![6]!.date) as Date;
  const raw = await schoolCalendar(site.school.id, from, to, { includeInternal: false });
  const all: CalItem[] = raw.map((i) => ({ id: i.id, kind: i.kind, title: locale === "SW" && i.titleSw ? i.titleSw : i.title, from: i.from, to: i.to, category: i.category, location: i.location, href: i.kind === "EVENT" ? `/events/${i.id}` : null }));
  const cats = [...new Set(all.map((i) => i.category).filter((c): c is string => !!c))].sort();
  const cat = sp.cat && cats.includes(sp.cat) ? sp.cat : undefined;
  const items = cat ? all.filter((i) => i.category === cat) : all;
  const { from: mFrom, to: mTo } = monthRange(cur.year, cur.month);
  const inMonth = items.filter((i) => i.from <= mTo && (i.to ?? i.from) >= mFrom);
  const prev = shiftMonth(cur.year, cur.month, -1), next = shiftMonth(cur.year, cur.month, 1);
  const href = (y: number, m: number) => `/calendar?m=${monthKey(y, m)}${cat ? `&cat=${encodeURIComponent(cat)}` : ""}`;
  const lc = locale === "SW" ? "sw-TZ" : "en-GB";
  const monthLabel = new Intl.DateTimeFormat(lc, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(cur.year, cur.month - 1, 1)));
  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(lc, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 9, 5 + i))));
  const dayLabel = (d: string) => new Intl.DateTimeFormat(lc, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(parseDateOnly(d) as Date);
  const chip = (active: boolean) => `inline-flex min-h-10 items-center rounded-full border-2 px-4 text-sm font-bold transition-colors ${active ? "border-brand-700 bg-brand-700 text-white" : "border-line text-ink/80 hover:border-brand-600 hover:text-brand-700"}`;
  const feed = "/calendar.ics";

  return (
    <>
      <PageHero eyebrow={t("site.cal.kicker")} title={t("site.cal.title")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/calendar", label: t("site.cal.title") }]}>{t("site.cal.lead")}</PageHero>
      <div className="mx-auto max-w-[100rem] px-4 pb-24 pt-10 sm:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={href(prev.year, prev.month)} aria-label={t("site.cal.prev")} className="inline-flex size-11 items-center justify-center rounded-full border-2 border-brand-700 text-brand-800 hover:bg-brand-700 hover:text-white"><ChevronLeft className="size-5" aria-hidden /></Link>
          <h2 className="display min-w-0 px-2 text-4xl capitalize text-heading sm:text-5xl" aria-live="polite">{monthLabel}</h2>
          <Link href={href(next.year, next.month)} aria-label={t("site.cal.next")} className="inline-flex size-11 items-center justify-center rounded-full border-2 border-brand-700 text-brand-800 hover:bg-brand-700 hover:text-white"><ChevronRight className="size-5" aria-hidden /></Link>
          <Link href={`/calendar${cat ? `?cat=${encodeURIComponent(cat)}` : ""}`} className="ml-auto inline-flex min-h-10 items-center rounded-full border-2 border-brand-700 px-4 text-sm font-bold text-brand-800 hover:bg-brand-700 hover:text-white">{t("site.cal.today")}</Link>
        </div>

        {cats.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2" role="navigation" aria-label={t("site.news.filter")}>
            <Link href={`/calendar?m=${monthKey(cur.year, cur.month)}`} className={chip(!cat)} aria-current={!cat ? "true" : undefined}>{t("site.cal.all")}</Link>
            {cats.map((c) => <Link key={c} href={`/calendar?m=${monthKey(cur.year, cur.month)}&cat=${encodeURIComponent(c)}`} className={chip(cat === c)} aria-current={cat === c ? "true" : undefined}>{c}</Link>)}
          </div>
        )}

        <div className="mt-8 grid gap-8 xl:grid-cols-[1fr_20rem]">
          <div className="min-w-0">
            {/* Month grid (tablet and up) */}
            <div role="grid" aria-label={monthLabel} className="hidden overflow-hidden card-y md:block">
              <div role="row" className="grid grid-cols-7 border-b border-line bg-tint text-center text-[11px] font-semibold uppercase tracking-[.18em] text-muted">
                {weekdays.map((w) => <div role="columnheader" key={w} className="py-3">{w}</div>)}
              </div>
              {grid.map((week, wi) => (
                <div role="row" key={wi} className="grid grid-cols-7 border-b border-line last:border-b-0">
                  {week.map((day) => {
                    const dayItems = itemsOn(items, day.date);
                    const isToday = day.date === today;
                    return (
                      <div role="gridcell" key={day.date} aria-label={dayLabel(day.date)} className={`min-h-[7.5rem] border-r border-line p-2 last:border-r-0 ${day.inMonth ? "" : "bg-tint/50 text-muted/60"}`}>
                        <span className={`inline-flex size-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums ${isToday ? "bg-brand-700 text-white" : day.inMonth ? "text-heading" : "text-muted/60"}`}>{day.day}</span>
                        <ul className="mt-1 space-y-1">
                          {dayItems.slice(0, 3).map((i) => {
                            const cls = `block truncate rounded-md px-1.5 py-1 text-[12px] font-medium leading-tight ring-1 ring-inset ${TONE[i.kind]}`;
                            // A multi-day item shows its title on its first day and on each Monday; the days in between are just the bar.
                            const showText = !i.to || i.to === i.from || day.date === i.from || week.indexOf(day) === 0;
                            if (!showText) return <li key={i.id + day.date} aria-hidden><span className={`${cls} select-none`}>&nbsp;</span></li>;
                            return <li key={i.id + day.date}>{i.href ? <Link href={i.href} className={`${cls} hover:brightness-125`} title={i.title}>{i.title}</Link> : <span className={cls} title={i.title}>{i.title}</span>}</li>;
                          })}
                          {dayItems.length > 3 && <li className="px-1.5 text-[11px] text-muted">{t("site.cal.more", { n: dayItems.length - 3 })}</li>}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* This month as a list (always; the only view on phones) */}
            <section aria-label={t("site.cal.list")} className="mt-8 md:mt-10">
              <h3 className="eyebrow">{t("site.cal.list")}</h3>
              {inMonth.length === 0 ? <p className="mt-5 text-muted">{t("site.cal.none")}</p> : (
                <ul className="mt-5 card-y divide-y divide-line">
                  {inMonth.map((i) => {
                    const body = (
                      <>
                        <div aria-hidden className="w-24 shrink-0 text-sm font-semibold uppercase tracking-[.08em] text-brand-700">{dayLabel(i.from < mFrom ? mFrom : i.from)}{i.to && i.to !== i.from ? <span className="block text-xs font-medium normal-case tracking-normal text-muted">→ {dayLabel(i.to)}</span> : null}</div>
                        <div className="min-w-0">
                          <p className="display text-2xl text-heading">{i.title}</p>
                          <p className="mt-0.5 flex flex-wrap gap-x-4 text-sm text-muted">{i.category && <span>{i.category}</span>}{i.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{i.location}</span>}</p>
                        </div>
                      </>
                    );
                    return <li key={i.id}>{i.href ? <Link href={i.href} className="flex gap-5 p-5 transition-colors hover:bg-tint">{body}</Link> : <div className="flex gap-5 p-5">{body}</div>}</li>;
                  })}
                </ul>
              )}
            </section>
          </div>

          <aside className="space-y-5 xl:sticky xl:top-28 xl:self-start">
            <div className="card-y p-6">
              <p className="flex items-center gap-2 text-sm font-bold text-brand-700"><CalendarDays className="size-4" aria-hidden />{t("site.cal.subscribe")}</p>
              <p className="mt-3 text-sm leading-relaxed text-muted">{t("site.cal.subscribe.body")}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <ButtonLink href={feed} variant="primary" size="sm">{t("site.cal.download")}</ButtonLink>
              </div>
              <p className="mt-4 break-all text-xs text-muted">webcal://{new URL(process.env.APP_URL ?? "http://localhost:3000").host}{feed}</p>
              <Link href="/news/rss.xml" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-ink/80 hover:text-brand-700"><Rss className="size-4" aria-hidden />{t("site.cal.rss")}</Link>
            </div>
            <div className="card-y p-6 text-sm text-muted">
              <p className="flex items-center gap-2"><span className="size-3 rounded-sm bg-brand-100 ring-1 ring-brand-300" aria-hidden />{t("site.cal.term")}</p>
              <p className="mt-2 flex items-center gap-2"><span className="size-3 rounded-sm bg-sun/40 ring-1 ring-sun/70" aria-hidden />{t("site.events.title")}</p>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
