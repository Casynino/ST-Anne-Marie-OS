import type { MetadataRoute } from "next";
import { getPublicSchool, listPublicNews } from "@/server/website";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const pages = ["", "/about", "/apply", "/apply/form", "/news", "/calendar", "/contact"].map((p) => ({ url: `${base}${p}` }));
  const school = await getPublicSchool();
  if (!school) return pages;
  const news = await listPublicNews(school.id, { limit: 50 });
  return [...pages, ...news.items.map((n) => ({ url: `${base}/news/${n.id}`, lastModified: n.updatedAt }))];
}
