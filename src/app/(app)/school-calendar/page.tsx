import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { calendarFor } from "@/server/calendar";
import { getSchoolBasics } from "@/server/settings";
import { todayInTimezone, parseDateOnly } from "@/lib/dates";
import { EventCalendar } from "@/components/calendar/event-calendar";
import { CountTabs } from "@/components/lifecycle/parts";
import { EmptyState, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { RowAction } from "@/components/lifecycle/row-action";
import type { CalendarItem } from "@/server/calendar";
import { addCalendarEventAction, deleteCalendarEventAction, updateCalendarEventAction } from "./actions";

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
  const canManage = ctx.permissions.has("calendar.manage") || ctx.permissions.has("website.manage");
  const fields = (e?: CalendarItem) => (
    <>
      <Field name="title" label={t("cal.f.title")} defaultValue={e?.title ?? ""} required />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="startsOn" type="date" label={t("cal.f.from")} defaultValue={e?.from ?? ""} required />
        <Field name="endsOn" type="date" label={t("cal.f.to")} defaultValue={e?.to ?? ""} optionalLabel={t("common.optional")} />
      </div>
      <Field name="location" label={t("cal.f.where")} defaultValue={e?.location ?? ""} optionalLabel={t("common.optional")} />
      <Field name="isPublic" type="checkbox" label={t("cal.f.public")} hint={t("cal.f.publicHint")} defaultValue={e ? e.isPublic : false} />
      {e?.extra && <><input type="hidden" name="titleSw" value={e.titleSw ?? ""} /><input type="hidden" name="description" value={e.extra.description ?? ""} /><input type="hidden" name="descriptionSw" value={e.extra.descriptionSw ?? ""} /><input type="hidden" name="category" value={e.category ?? ""} /><input type="hidden" name="coverImage" value={e.extra.coverImage ?? ""} /></>}
    </>
  );
  const editor = (e: CalendarItem) => (
    <RowAction link label={t("common.edit")} title={t("cal.editTitle")} closeLabel={t("common.cancel")}>
      <div className="space-y-4">
        <ActionForm action={updateCalendarEventAction} submitLabel={t("common.save")} buttonClassName="btn-sm" className="space-y-3"><input type="hidden" name="id" value={e.id} />{fields(e)}</ActionForm>
        <ActionForm action={deleteCalendarEventAction} submitLabel={t("cal.delete")} tone="danger" confirm={t("cal.deleteConfirm")} inline className="border-t border-line pt-3"><input type="hidden" name="id" value={e.id} /></ActionForm>
      </div>
    </RowAction>
  );
  const href = (y: number, ty?: string) => `/school-calendar?year=${y}${ty ? `&type=${ty}` : ""}`;
  return (
    <>
      <PageHeader
        title={`${t("cal.title")} ${year}`}
        subtitle={t("cal.subtitle")}
        actions={<span className="flex items-center gap-4 text-sm">{canManage && <RowAction primary label={t("cal.add")} title={t("cal.add")} closeLabel={t("common.cancel")}><ActionForm action={addCalendarEventAction} submitLabel={t("cal.addGo")} buttonClassName="btn-sm" className="space-y-3">{fields()}</ActionForm></RowAction>}{[year - 1, year, year + 1].map((y) => <a key={y} href={href(y, type)} className={y === year ? "font-semibold text-ink" : "font-medium text-link hover:underline"}>{y}</a>)}</span>}
      />
      {ctx.permissions.has("timetable.read") && (
        <p className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm">
          <span className="font-medium text-ink">{t("cal.timetables")}</span>
          <a href="/timetable?view=class" className="font-medium text-link hover:underline">{t("learn.tt.byClass")} →</a>
          <a href="/timetable?view=teacher" className="font-medium text-link hover:underline">{t("learn.tt.byTeacher")} →</a>
          <span className="text-muted">{t("learn.tt.preparedBy")}</span>
        </p>
      )}
      <CountTabs items={[
        { href: href(year), label: t("cal.filter.all"), count: all.length, active: !type },
        { href: href(year, "term"), label: t("cal.filter.term"), count: count.term, active: type === "term" },
        { href: href(year, "events"), label: t("cal.filter.events"), count: count.events, active: type === "events" },
        { href: href(year, "internal"), label: t("cal.filter.internal"), count: count.internal, active: type === "internal" },
      ]} />
      {items.length === 0 ? <EmptyState>{t("cal.empty")}</EmptyState> : <EventCalendar items={items} today={today} locale={ctx.locale} t={t} upcoming={!type || year === Number(today.slice(0, 4))} action={canManage ? (i) => (i.kind === "EVENT" ? editor(i) : null) : undefined} />}
    </>
  );
}
