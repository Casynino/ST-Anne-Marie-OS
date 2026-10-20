import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { baseUrl } from "@/lib/site";
import { getPublicSchool, listPublicEvents, listPublicNews } from "@/server/website";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = baseUrl();
  const pages = ["", "/about", "/academics", "/apply", "/apply/form", "/school-life", "/news", "/events", "/contact", "/privacy"].map((p) => ({ url: `${base}${p}` }));
  const school = await getPublicSchool();
  if (!school) return pages;
  const [news, events] = await Promise.all([listPublicNews(school.id, { limit: 200 }), listPublicEvents(school.id, school.timezone, { limit: 200 })]);
  return [
    ...pages,
    ...news.items.map((n) => ({ url: `${base}/news/${n.slug ?? n.id}`, lastModified: n.updatedAt })),
    ...events.map((e) => ({ url: `${base}/events/${e.id}`, lastModified: e.updatedAt })),
  ];
}
