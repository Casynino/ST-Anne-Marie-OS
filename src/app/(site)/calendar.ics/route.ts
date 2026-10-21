import { baseUrl } from "@/lib/site";
import { buildIcs } from "@/lib/ics";
import { formatDateOnly, parseDateOnly, todayInTimezone } from "@/lib/dates";
import { schoolCalendar } from "@/server/calendar";
import { getPublicSchool } from "@/server/website";

/** Public calendar feed (iCalendar): term dates and public events only. Anyone can subscribe from a phone or computer calendar. */
export async function GET() {
  const school = await getPublicSchool();
  if (!school) return new Response("Not found", { status: 404 });
  const today = parseDateOnly(todayInTimezone(school.timezone)) as Date;
  const from = new Date(today.getTime() - 120 * 86_400_000);
  const to = new Date(today.getTime() + 400 * 86_400_000);
  const items = await schoolCalendar(school.id, from, to, { includeInternal: false });
  const host = new URL(baseUrl()).host;
  const body = buildIcs(`${school.name} calendar`, items.map((i) => ({ uid: `${i.id}@${host}`, title: i.title, from: i.from, to: i.to, location: i.location })));
  return new Response(body, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `inline; filename="school-calendar-${formatDateOnly(today)}.ics"`, "cache-control": "public, max-age=300, s-maxage=300" } });
}
