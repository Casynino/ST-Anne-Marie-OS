import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getLocale, getT } from "@/lib/auth/next";
import { getSite } from "@/lib/site";
import { getPublicNews } from "@/server/website";
import { displayDate } from "@/lib/dates";

export const metadata: Metadata = { title: "News" };

export default async function NewsPostPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, site, t, locale] = await Promise.all([params, getSite(), getT(), getLocale()]);
  if (!site) notFound();
  const post = await getPublicNews(site.school.id, id);
  if (!post) notFound();
  const title = locale === "SW" && post.titleSw ? post.titleSw : post.title;
  const body = locale === "SW" && post.bodySw ? post.bodySw : post.body;
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Link href="/news" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-800 hover:underline"><ArrowLeft className="size-4" aria-hidden /> {t("site.news.back")}</Link>
      <p className="mt-6 text-sm text-muted">{t("site.news.published", { date: displayDate(post.publishedAt, locale) })}</p>
      <h1 className="site-serif mt-2 text-4xl font-semibold leading-tight text-brand-900 sm:text-5xl">{title}</h1>
      <div className="mt-8 whitespace-pre-line text-lg leading-relaxed text-ink/85">{body}</div>
    </article>
  );
}
