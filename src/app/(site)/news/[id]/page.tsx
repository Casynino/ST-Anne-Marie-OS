import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getLocale, getT } from "@/lib/auth/next";
import { baseUrl, getSite, pageMetadata } from "@/lib/site";
import { excerptOf, getPublicNews, listPublicNews, resolveSiteImages } from "@/server/website";
import { displayDate } from "@/lib/dates";
import { Photo } from "@/components/site/photo";
import { NewsCard } from "@/components/site/news-card";

type Props = { params: Promise<{ id: string }> };

async function load(slug: string) {
  const site = await getSite();
  if (!site) return null;
  const post = await getPublicNews(site.school.id, slug);
  return post ? { site, post } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const [data, locale] = await Promise.all([load(id), getLocale()]);
  if (!data) return { title: "News", robots: { index: false } };
  const cover = data.post.coverImage ? (await resolveSiteImages([data.post.coverImage])).get(data.post.coverImage) : undefined;
  const title = locale === "SW" && data.post.titleSw ? data.post.titleSw : data.post.title;
  return pageMetadata(data.site, { title, path: `/news/${data.post.slug ?? data.post.id}`, description: excerptOf(data.post, locale, 160), image: cover?.src, type: "article" });
}

export default async function NewsPostPage({ params }: Props) {
  const { id } = await params;
  const [data, t, locale] = await Promise.all([load(id), getT(), getLocale()]);
  if (!data) notFound();
  const { site, post } = data;
  const title = locale === "SW" && post.titleSw ? post.titleSw : post.title;
  const body = locale === "SW" && post.bodySw ? post.bodySw : post.body;
  const url = `${baseUrl()}/news/${post.slug ?? post.id}`;
  const more = (await listPublicNews(site.school.id, { limit: 4 })).items.filter((n) => n.id !== post.id).slice(0, 2);
  const covers = await resolveSiteImages([post.coverImage, ...more.map((m) => m.coverImage)]);
  const cover = post.coverImage ? covers.get(post.coverImage) : undefined;
  const ld = { "@context": "https://schema.org", "@type": "NewsArticle", headline: title, datePublished: post.publishedAt?.toISOString(), dateModified: post.updatedAt.toISOString(), mainEntityOfPage: url, publisher: { "@type": "EducationalOrganization", name: site.school.name }, ...(cover ? { image: [`${baseUrl()}${cover.src}`] } : {}) };
  const share = [
    { label: "WhatsApp", href: `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}` },
    { label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` },
  ];

  return (
    <article>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <header className="border-t-[3px] border-ink">
        <div className="mx-auto max-w-3xl px-4 pb-10 pt-10 sm:px-6 sm:pt-14">
          <Link href="/news" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-700 hover:underline"><ArrowLeft className="size-4" aria-hidden /> {t("site.news.back")}</Link>
          <p className="mt-6 flex flex-wrap items-center gap-3 text-xs font-bold uppercase tracking-wider text-muted">
            {post.category && <span className="text-brand-700">{post.category}</span>}
            <time dateTime={post.publishedAt?.toISOString()}>{displayDate(post.publishedAt, locale)}</time>
          </p>
          <h1 className="display mt-4 text-[2.6rem] sm:text-7xl">{title}</h1>
        </div>
        {cover && <div className="mx-auto max-w-5xl px-4 sm:px-6"><div className="frame print aspect-[16/9]"><Photo image={cover} sizes="(min-width: 1024px) 64rem, 100vw" priority /></div></div>}
      </header>
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="whitespace-pre-line text-[1.2rem] leading-[1.75] text-ink/90 first-letter:float-left first-letter:mr-3 first-letter:font-[family-name:var(--font-display)] first-letter:text-7xl first-letter:leading-[.85] first-letter:text-brand-700">{body}</div>
        <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-ink pt-6">
          <span className="text-sm font-semibold text-muted">{t("site.news.share")}</span>
          {share.map((s) => <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center border border-ink/40 px-4 text-sm font-semibold text-ink hover:border-ink">{s.label}</a>)}
        </div>
      </div>
      {more.length > 0 && (
        <section className="border-t border-ink bg-white"><div className="mx-auto max-w-[100rem] px-4 py-16 sm:px-6"><h2 className="display text-4xl">{t("site.news.more")}</h2>
          <ul className="mt-8 grid gap-x-8 gap-y-10 sm:grid-cols-2">{more.map((n) => <li key={n.id}><NewsCard post={n} cover={n.coverImage ? covers.get(n.coverImage) : undefined} locale={locale} /></li>)}</ul></div></section>
      )}
    </article>
  );
}
