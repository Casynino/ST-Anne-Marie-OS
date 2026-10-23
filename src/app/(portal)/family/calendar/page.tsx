import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { calendarFor } from "@/server/calendar";
import { getSchoolBasics } from "@/server/settings";
import { todayInTimezone } from "@/lib/dates";
import { EventCalendar } from "@/components/calendar/event-calendar";
import { EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "School calendar" };

export default async function FamilyCalendarPage() {
  const ctx = await requireContext();
  const t = await getT();
  const school = await getSchoolBasics(ctx.schoolId);
  const today = todayInTimezone(school.timezone);
  const from = new Date(Date.now() - 7 * 86_400_000);
  const to = new Date(Date.now() + 400 * 86_400_000);
  const items = await calendarFor(ctx, from, to);
  return (
    <>
      <PageHeader title={t("cal.title")} subtitle={t("fam.calendar.subtitle")} />
      {items.length === 0 ? <EmptyState>{t("cal.empty")}</EmptyState> : <EventCalendar items={items} today={today} locale={ctx.locale} t={t} />}
    </>
  );
}
