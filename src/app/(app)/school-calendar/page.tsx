import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { calendarFor } from "@/server/calendar";
import { getSchoolBasics } from "@/server/settings";
import { todayInTimezone, parseDateOnly } from "@/lib/dates";
import { EventCalendar } from "@/components/calendar/event-calendar";
import { CountTabs } from "@/components/lifecycle/parts";
import { EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "School calendar" };
const TYPES = ["term", "events", "internal"] as const;

/** The school calendar for one year as event cards: the next three events first, then every month; filter by term dates, school events or staff-only. */
export default async function StaffCalendarPage({ searchParams }: { searchParams: Promise<{ year?: string; type?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  const sp = await searchParams;
  const school = await getSchoolBasics(ctx.schoolId);
  const today = todayInTimezone(school.timezone);
  const year = Number(sp.year) >= 2000 && Number(sp.year) <= 2100 ? Number(sp.year) : Number(today.slice(0, 4));
  const type = (TYPES as readonly string[]).includes(sp.type ?? "") ? (sp.type as (typeof TYPES)[number]) : undefined;
  const all = await calendarFor(ctx, parseDateOnly(`${year}-01-01`)!, parseDateOnly(`${year}-12-31`)!);
  const count = { term: all.filter((i) => i.kind !== "EVENT").length, events: all.filter((i) => i.kind === "EVENT" && i.isPublic).length, internal: all.filter((i) => i.kind === "EVENT" && !i.isPublic).length };
  const items = all.filter((i) => (type === "term" ? i.kind !== "EVENT" : type === "events" ? i.kind === "EVENT" && i.isPublic : type === "internal" ? i.kind === "EVENT" && !i.isPublic : true));
  const href = (y: number, ty?: string) => `/school-calendar?year=${y}${ty ? `&type=${ty}` : ""}`;
  return (
    <>
      <PageHeader
        title={`${t("cal.title")} ${year}`}
        subtitle={t("cal.subtitle")}
        actions={<span className="flex gap-4 text-sm">{[year - 1, year, year + 1].map((y) => <a key={y} href={href(y, type)} className={y === year ? "font-semibold text-ink" : "font-medium text-link hover:underline"}>{y}</a>)}</span>}
      />
      <CountTabs items={[
        { href: href(year), label: t("cal.filter.all"), count: all.length, active: !type },
        { href: href(year, "term"), label: t("cal.filter.term"), count: count.term, active: type === "term" },
        { href: href(year, "events"), label: t("cal.filter.events"), count: count.events, active: type === "events" },
        { href: href(year, "internal"), label: t("cal.filter.internal"), count: count.internal, active: type === "internal" },
      ]} />
      {items.length === 0 ? <EmptyState>{t("cal.empty")}</EmptyState> : <EventCalendar items={items} today={today} locale={ctx.locale} t={t} upcoming={!type || year === Number(today.slice(0, 4))} />}
    </>
  );
}
