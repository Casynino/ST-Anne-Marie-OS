import Link from "next/link";
import type { Metadata } from "next";
import { Search } from "lucide-react";
import { getLocale, getT } from "@/lib/auth/next";
import { getSite, pageMetadata } from "@/lib/site";
import { excerptOf, searchPublicSite } from "@/server/website";
import { displayDate } from "@/lib/dates";
import { PageHero } from "@/components/site/blocks";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { ...pageMetadata(await getSite(), { title: t("site.search.title"), path: "/search" }), robots: { index: false, follow: true } };
}

const plain = (s: string) => s.replace(/\s+/g, " ").trim();

/** Words typed by the visitor are matched against the school's published news, public events and page text. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [site, t, locale, sp] = await Promise.all([getSite(), getT(), getLocale(), searchParams]);
  if (!site) return null;
  const q = (sp.q ?? "").slice(0, 60);
  const needle = q.trim().toLowerCase();
  const searched = needle.length >= 2;
  const { news, events } = searched ? await searchPublicSite(site.school.id, q) : { news: [], events: [] };
  const { text, levels } = site;

  // The fixed pages of the site, searched in memory from the school's own text.
  const pageIndex = [
    { href: "/about", title: t("site.nav.about"), body: [text.about, text.vision, text.mission, text.philosophy, text.history, text.facilities, text.safeguarding, ...text.values.map((v) => `${v.title} ${v.text}`), ...text.leadership.map((v) => `${v.title} ${v.text}`)] },
    { href: "/academics", title: t("site.nav.academics"), body: [text.learningApproach, text.curriculum, text.academicSupport, text.examinations, ...levels.map((l) => `${l.name} ${l.summary ?? ""} ${l.focus ?? ""} ${l.classes.join(" ")} ${l.subjects.join(" ")}`)] },
    { href: "/apply", title: t("site.nav.admissions"), body: [text.admissionsIntro, text.feesNote, ...text.requirements, ...text.faqs.map((f) => `${f.q} ${f.a}`)] },
    { href: "/school-life", title: t("site.nav.schoolLife"), body: text.schoolLife.map((s) => `${s.title} ${s.text}`) },
    { href: "/student-life", title: t("site.nav.studentLife"), body: [text.uniform, text.transport, text.meals, text.health, ...text.clubs.map((c) => `${c.title} ${c.text}`)] },
  ];
  const pages = searched ? pageIndex.flatMap((p) => {
    const hit = p.body.filter((b): b is string => !!b).map(plain).find((b) => b.toLowerCase().includes(needle));
    if (!hit) return [];
    const at = Math.max(0, hit.toLowerCase().indexOf(needle) - 60);
    return [{ ...p, snippet: `${at > 0 ? "…" : ""}${hit.slice(at, at + 190)}${hit.length > at + 190 ? "…" : ""}` }];
  }) : [];
  const total = news.length + events.length + pages.length;

  return (
    <>
      <PageHero photo={false} eyebrow={t("site.search.kicker")} title={t("site.search.title")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/search", label: t("site.search.title") }]} />
      <div className="mx-auto max-w-[100rem] px-4 pb-24 pt-8 sm:px-8">
        <form action="/search" method="get" role="search" className="flex max-w-2xl gap-3">
          <label htmlFor="q" className="sr-only">{t("site.search.placeholder")}</label>
          <input id="q" name="q" defaultValue={q} placeholder={t("site.search.placeholder")} autoComplete="off" maxLength={60} className="min-h-14 flex-1 rounded-full border border-line bg-surface px-6 text-lg text-ink placeholder:text-muted focus:border-sun focus:outline-none" />
          <button type="submit" className="inline-flex min-h-14 items-center gap-2 rounded-full bg-brand-700 px-7 font-bold text-white hover:bg-brand-800"><Search className="size-4" aria-hidden />{t("site.search.button")}</button>
        </form>

        <div className="mt-10 max-w-3xl" aria-live="polite">
          {!searched ? (q ? <p className="text-muted">{t("site.search.short")}</p> : null) : total === 0 ? <p className="text-lg text-muted">{t("site.search.none", { q })}</p> : <p className="text-muted">{t("site.search.results", { n: total, q })}</p>}

          {news.length > 0 && (
            <section className="mt-8"><h2 className="eyebrow">{t("site.search.news")}</h2>
              <ul className="mt-4 card-y divide-y divide-line">
                {news.map((n) => <li key={n.id}><Link href={`/news/${n.slug ?? n.id}`} className="block p-5 hover:bg-tint"><span className="display text-2xl text-heading">{locale === "SW" && n.titleSw ? n.titleSw : n.title}</span><span className="mt-1 block text-sm text-muted">{displayDate(n.publishedAt, locale)}</span><span className="mt-1 line-clamp-2 block text-muted">{excerptOf(n, locale)}</span></Link></li>)}
              </ul></section>
          )}
          {events.length > 0 && (
            <section className="mt-8"><h2 className="eyebrow">{t("site.search.events")}</h2>
              <ul className="mt-4 card-y divide-y divide-line">
                {events.map((e) => <li key={e.id}><Link href={`/events/${e.id}`} className="block p-5 hover:bg-tint"><span className="display text-2xl text-heading">{locale === "SW" && e.titleSw ? e.titleSw : e.title}</span><span className="mt-1 block text-sm text-muted">{displayDate(e.startsOn, locale)}{e.location ? ` · ${e.location}` : ""}</span></Link></li>)}
              </ul></section>
          )}
          {pages.length > 0 && (
            <section className="mt-8"><h2 className="eyebrow">{t("site.search.pages")}</h2>
              <ul className="mt-4 card-y divide-y divide-line">
                {pages.map((p) => <li key={p.href}><Link href={p.href} className="block p-5 hover:bg-tint"><span className="display text-2xl text-heading">{p.title}</span><span className="mt-1 line-clamp-2 block text-muted">{p.snippet}</span></Link></li>)}
              </ul></section>
          )}
        </div>
      </div>
    </>
  );
}
