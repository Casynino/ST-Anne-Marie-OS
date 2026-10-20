import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { calendarFor } from "@/server/calendar";
import { displayDate } from "@/lib/dates";
import { EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "School calendar" };

export default async function FamilyCalendarPage() {
  const ctx = await requireContext();
  const t = await getT();
  const from = new Date(Date.now() - 7 * 86_400_000);
  const to = new Date(Date.now() + 400 * 86_400_000);
  const items = await calendarFor(ctx, from, to);
  return (
    <>
      <PageHeader title={t("cal.title")} subtitle={t("fam.calendar.subtitle")} />
      {items.length === 0 ? <EmptyState>{t("cal.empty")}</EmptyState> : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-4 py-3">
              <span><span className="font-medium">{ctx.locale === "SW" && i.titleSw ? i.titleSw : i.title}</span>{i.location && <span className="block text-sm text-muted">{i.location}</span>}</span>
              <span className="text-sm text-muted">{displayDate(new Date(`${i.from}T00:00:00Z`), ctx.locale)}{i.to && i.to !== i.from ? ` – ${displayDate(new Date(`${i.to}T00:00:00Z`), ctx.locale)}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
