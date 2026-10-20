import Link from "next/link";
import type { Metadata } from "next";
import { MapPin } from "lucide-react";
import { getLocale, getT } from "@/lib/auth/next";
import { getSite, pageMetadata } from "@/lib/site";
import { listPublicEvents } from "@/server/website";
import { displayDate } from "@/lib/dates";
import { PageHero } from "@/components/site/blocks";
import { Reveal } from "@/components/site/fx/reveal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return pageMetadata(await getSite(), { title: t("site.events.title"), path: "/events" });
}

export default async function EventsPage() {
  const [site, t, locale] = await Promise.all([getSite(), getT(), getLocale()]);
  if (!site) return null;
  const events = await listPublicEvents(site.school.id, site.school.timezone);
  const chip = (active: boolean) => `inline-flex min-h-10 items-center rounded-full border px-5 text-sm font-semibold transition-colors ${active ? "border-sun bg-sun text-[#10200f]" : "border-line text-ink/80 hover:border-sun/60 hover:text-white"}`;
  return (
    <>
      <PageHero eyebrow={t("site.events.kicker")} title={t("site.events.title")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/news", label: t("site.nav.newsEvents") }, { href: "/events", label: t("site.events.title") }]} />
      <div className="mx-auto max-w-[100rem] px-4 py-16 sm:px-6">
        <div className="flex gap-2" role="navigation" aria-label={t("site.news.filter")}>
          <Link href="/news" className={chip(false)}>{t("site.news.tabNews")}</Link>
          <Link href="/events" className={chip(true)} aria-current="page">{t("site.news.tabEvents")}</Link>
        </div>
        {events.length === 0 ? <p className="mt-12 text-muted">{t("site.events.empty")}</p> : (
          <ul className="mt-10 max-w-4xl space-y-4">
            {events.map((e, i) => {
              const title = locale === "SW" && e.titleSw ? e.titleSw : e.title;
              const month = displayDate(e.startsOn, locale).split(" ")[1];
              return (
                <Reveal as="li" key={e.id} delay={(i % 4) * 60}>
                  <Link href={`/events/${e.id}`} className="index-row group flex gap-6 rounded-[1.5rem] border border-line bg-surface p-5 transition-[border-color,transform] duration-500 hover:-translate-y-0.5 hover:border-sun/50 sm:p-6">
                    <div aria-hidden className="w-20 shrink-0 self-start rounded-2xl border border-white/10 bg-white/5 py-3 text-center"><span className="display block text-5xl leading-none text-heading">{e.startsOn.getUTCDate()}</span><span className="mt-1 block text-[11px] font-semibold uppercase tracking-[.16em] text-sun">{month}</span></div>
                    <div className="min-w-0">
                      {e.category && <p className="text-xs font-bold uppercase tracking-wider text-link">{e.category}</p>}
                      <h2 className="display text-3xl text-heading group-hover:text-sun">{title}</h2>
                      <p className="mt-1 text-sm text-muted">{displayDate(e.startsOn, locale)}{e.endsOn ? ` – ${displayDate(e.endsOn, locale)}` : ""}</p>
                      {e.location && <p className="mt-1 flex items-center gap-1.5 text-sm text-muted"><MapPin className="size-4" aria-hidden />{e.location}</p>}
                    </div>
                  </Link>
                </Reveal>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
