import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { displayDate } from "@/lib/dates";
import { excerptOf, type SiteImage } from "@/server/website";
import { Photo } from "@/components/site/photo";

type Post = { id: string; slug: string | null; title: string; titleSw: string | null; body: string; bodySw: string | null; excerpt: string | null; category: string | null; publishedAt: Date | null };

/** A published news item. The cover is the school's own image when supplied, otherwise a calm brand tile. */
export function NewsCard({ post, cover, locale, featured }: { post: Post; cover?: SiteImage; locale: Locale; featured?: boolean }) {
  const title = locale === "SW" && post.titleSw ? post.titleSw : post.title;
  return (
    <article className={`card-lift group relative flex h-full flex-col overflow-hidden rounded-3xl border border-line bg-white ${featured ? "md:flex-row" : ""}`}>
      <div className={`frame ${featured ? "md:w-1/2 md:shrink-0" : ""} ${cover ? "aspect-[16/10]" : featured ? "aspect-[16/6] md:aspect-auto" : "aspect-[16/6]"}`}>
        {cover ? <Photo image={cover} sizes={featured ? "(min-width: 1024px) 40vw, 100vw" : "(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 100vw"} /> : <div aria-hidden className="size-full bg-brand-700"><div className="absolute -right-6 -top-6 size-32 rounded-full bg-brand-600" /><div className="absolute bottom-0 left-5 h-16 w-12 rounded-t-full bg-sun" /></div>}
      </div>
      <div className={`flex flex-1 flex-col p-6 ${featured ? "md:justify-center md:p-10" : ""}`}>
        <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
          {post.category && <span className="rounded-full bg-brand-50 px-2.5 py-1 text-brand-800">{post.category}</span>}
          <time dateTime={post.publishedAt?.toISOString()}>{displayDate(post.publishedAt, locale)}</time>
        </p>
        <h3 className={`display mt-3 text-brand-950 ${featured ? "text-3xl md:text-4xl" : "text-2xl"}`}>
          <Link href={`/news/${post.slug ?? post.id}`} className="after:absolute after:inset-0 hover:text-brand-700">{title}</Link>
        </h3>
        <p className="mt-3 line-clamp-3 text-muted">{excerptOf(post, locale)}</p>
      </div>
    </article>
  );
}
