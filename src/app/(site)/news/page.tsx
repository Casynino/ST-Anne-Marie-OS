import Link from "next/link";
import type { Metadata } from "next";
import { getLocale, getT } from "@/lib/auth/next";
import { getSite } from "@/lib/site";
import { listPublicNews } from "@/server/website";
import { displayDate } from "@/lib/dates";
import { PageHero } from "@/components/site/blocks";
import { Pagination } from "@/components/ui";

export const metadata: Metadata = { title: "News" };

export default async function NewsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const [site, t, locale, sp] = await Promise.all([getSite(), getT(), getLocale(), searchParams]);
  if (!site) return null;
  const page = Math.max(1, Number(sp.page) || 1);
  const { items, total, pageSize } = await listPublicNews(site.school.id, { page, limit: 9 });
  return (
    <>
      <PageHero kicker={t("site.news.kicker")} title={t("site.news.title")} />
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        {items.length === 0 ? <p className="text-muted">{t("site.news.empty")}</p> : (
          <ul className="divide-y divide-brand-800/10 border-y border-brand-800/10">
            {items.map((n) => (
              <li key={n.id}>
                <Link href={`/news/${n.id}`} className="group block py-6">
                  <p className="text-sm text-muted">{displayDate(n.publishedAt, locale)}</p>
                  <h2 className="site-serif mt-1 text-2xl font-semibold text-brand-900 group-hover:underline">{locale === "SW" && n.titleSw ? n.titleSw : n.title}</h2>
                  <p className="mt-2 line-clamp-2 text-muted">{locale === "SW" && n.bodySw ? n.bodySw : n.body}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Pagination page={page} pageSize={pageSize} total={total} basePath="/news" params={{}} t={t} />
      </div>
    </>
  );
}
