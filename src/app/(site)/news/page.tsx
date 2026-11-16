import Link from "next/link";
import type { Metadata } from "next";
import { getLocale, getT } from "@/lib/auth/next";
import { getSite, pageMetadata } from "@/lib/site";
import { listNewsCategories, listPublicNews, resolveSiteImages } from "@/server/website";
import { PageHero } from "@/components/site/blocks";
import { NewsCard } from "@/components/site/news-card";
import { Reveal } from "@/components/site/fx/reveal";
import { Pagination } from "@/components/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return pageMetadata(await getSite(), { title: t("site.nav.newsEvents"), path: "/news" });
}

export default async function NewsPage({ searchParams }: { searchParams: Promise<{ page?: string; category?: string }> }) {
  const [site, t, locale, sp] = await Promise.all([getSite(), getT(), getLocale(), searchParams]);
  if (!site) return null;
  const page = Math.max(1, Number(sp.page) || 1);
  const category = sp.category?.slice(0, 40);
  const [{ items, total, pageSize }, categories] = await Promise.all([listPublicNews(site.school.id, { page, limit: 9, category }), listNewsCategories(site.school.id)]);
  const covers = await resolveSiteImages(items.map((n) => n.coverImage));
  const chip = (active: boolean) => `inline-flex min-h-10 items-center rounded-full border-2 px-5 text-sm font-bold transition-colors ${active ? "border-link bg-brand-700 text-white" : "border-line text-ink/80 hover:border-link hover:text-link"}`;

  return (
    <>
      <PageHero eyebrow={t("site.news.kicker")} title={t("site.nav.newsEvents")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/news", label: t("site.nav.newsEvents") }]} />
      <div className="mx-auto max-w-[100rem] px-4 py-16 sm:px-6">
        <div className="flex flex-wrap items-center gap-2" role="navigation" aria-label={t("site.news.filter")}>
          <Link href="/news" className={chip(!category)} aria-current={!category ? "page" : undefined}>{t("site.news.tabNews")}</Link>
          <Link href="/events" className={chip(false)}>{t("site.news.tabEvents")}</Link>
          {categories.length > 0 && <span aria-hidden className="mx-2 h-6 w-px bg-surface/30" />}
          {categories.map((c) => <Link key={c} href={`/news?category=${encodeURIComponent(c)}`} className={chip(category === c)} aria-current={category === c ? "page" : undefined}>{c}</Link>)}
        </div>

        {items.length === 0 ? (
          <p className="mt-12 text-muted">{t("site.news.empty")}</p>
        ) : (
          <ul className="mt-10 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((n, i) => <Reveal as="li" key={n.id} delay={(i % 3) * 80}><NewsCard post={n} cover={n.coverImage ? covers.get(n.coverImage) : undefined} locale={locale} /></Reveal>)}
          </ul>
        )}
        <Pagination page={page} pageSize={pageSize} total={total} basePath="/news" params={{ category }} t={t} />
      </div>
    </>
  );
}
