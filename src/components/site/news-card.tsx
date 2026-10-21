import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { displayDate } from "@/lib/dates";
import { excerptOf, type SiteImage } from "@/server/website";
import { Photo } from "@/components/site/photo";

type Post = { id: string; slug: string | null; title: string; titleSw: string | null; body: string; bodySw: string | null; excerpt: string | null; category: string | null; publishedAt: Date | null };

/** A published news item: the school's own picture (if any), a dateline, a headline and a few lines. */
export function NewsCard({ post, cover, locale, featured }: { post: Post; cover?: SiteImage; locale: Locale; featured?: boolean }) {
  const title = locale === "SW" && post.titleSw ? post.titleSw : post.title;
  return (
    <article className={`group relative flex h-full flex-col overflow-hidden rounded-[1.75rem] border border-line bg-surface transition-[border-color,transform] duration-500 hover:-translate-y-1 hover:border-sun/50 ${featured ? "md:flex-row" : ""}`}>
      {cover && (
        <div className={`frame ${cover.height > cover.width ? "aspect-[4/5]" : "aspect-[3/2]"} ${featured ? "md:aspect-auto md:w-1/2 md:shrink-0" : ""}`}>
          <Photo image={cover} sizes={featured ? "(min-width: 1024px) 40vw, 100vw" : "(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 100vw"} />
        </div>
      )}
      <div className={`flex flex-1 flex-col p-6 sm:p-7 ${featured ? "md:justify-center md:p-10" : ""}`}>
        <p className="flex flex-wrap items-center gap-x-3 text-[11px] font-semibold uppercase tracking-[.2em] text-muted">
          {post.category && <span className="text-sun">{post.category}</span>}
          <time dateTime={post.publishedAt?.toISOString()}>{displayDate(post.publishedAt, locale)}</time>
        </p>
        <h3 className={`display mt-4 text-heading ${featured ? "text-4xl md:text-5xl" : "text-[1.9rem]"}`}>
          <Link href={`/news/${post.slug ?? post.id}`} className="after:absolute after:inset-0">{title}</Link>
        </h3>
        <p className="mt-3 line-clamp-3 text-muted">{excerptOf(post, locale)}</p>
      </div>
    </article>
  );
}
