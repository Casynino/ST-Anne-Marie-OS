import { baseUrl } from "@/lib/site";
import { buildRss } from "@/lib/ics";
import { excerptOf, getPublicSchool, listPublicNews } from "@/server/website";

/** Public news feed (RSS): the latest published news only. */
export async function GET() {
  const school = await getPublicSchool();
  if (!school) return new Response("Not found", { status: 404 });
  const { items } = await listPublicNews(school.id, { limit: 20 });
  const base = baseUrl();
  const body = buildRss({ title: `${school.name} news`, link: `${base}/news`, description: `Latest news from ${school.name}`, items: items.map((n) => ({ title: n.title, link: `${base}/news/${n.slug ?? n.id}`, description: excerptOf(n, "EN"), date: n.publishedAt, guid: n.id })) });
  return new Response(body, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=300, s-maxage=300" } });
}
