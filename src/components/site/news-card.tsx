import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { displayDate } from "@/lib/dates";
import { excerptOf, type SiteImage } from "@/server/website";
import { Photo } from "@/components/site/photo";

type Post = { id: string; slug: string | null; title: string; titleSw: string | null; body: string; bodySw: string | null; excerpt: string | null; category: string | null; publishedAt: Date | null };

/** A published news item, set like an article in a paper: the school's own picture (if any), a dateline, a headline and a few lines. */
export function NewsCard({ post, cover, locale, featured }: { post: Post; cover?: SiteImage; locale: Locale; featured?: boolean }) {
  const title = locale === "SW" && post.titleSw ? post.titleSw : post.title;
  return (
    <article className={`group relative flex h-full flex-col border-t border-ink pt-4 ${featured ? "md:flex-row md:gap-8" : ""}`}>
      {cover && (
        <div className={`frame print mb-4 ${featured ? "aspect-[3/2] md:mb-0 md:w-1/2 md:shrink-0" : "aspect-[3/2]"}`}>
          <Photo image={cover} sizes={featured ? "(min-width: 1024px) 40vw, 100vw" : "(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 100vw"} />
        </div>
      )}
      <div className={`flex flex-1 flex-col ${featured ? "md:justify-center" : ""}`}>
        <p className="flex flex-wrap items-center gap-x-3 text-xs font-bold uppercase tracking-[.16em] text-muted">
          {post.category && <span className="text-brand-700">{post.category}</span>}
          <time dateTime={post.publishedAt?.toISOString()}>{displayDate(post.publishedAt, locale)}</time>
        </p>
        <h3 className={`display mt-3 text-ink ${featured ? "text-4xl md:text-5xl" : "text-[1.7rem]"}`}>
          <Link href={`/news/${post.slug ?? post.id}`} className="after:absolute after:inset-0 group-hover:underline decoration-1 underline-offset-4">{title}</Link>
        </h3>
        <p className="mt-3 line-clamp-3 text-ink/75">{excerptOf(post, locale)}</p>
      </div>
    </article>
  );
}
