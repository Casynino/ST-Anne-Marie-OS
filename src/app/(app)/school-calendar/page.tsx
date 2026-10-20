import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { calendarFor } from "@/server/calendar";
import { displayDate, parseDateOnly } from "@/lib/dates";
import { Badge, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "School calendar" };

export default async function StaffCalendarPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  const sp = await searchParams;
  const year = Number(sp.year) >= 2000 && Number(sp.year) <= 2100 ? Number(sp.year) : new Date().getUTCFullYear();
  const items = await calendarFor(ctx, parseDateOnly(`${year}-01-01`)!, parseDateOnly(`${year}-12-31`)!);
  const months = new Map<string, typeof items>();
  for (const i of items) (months.get(i.from.slice(0, 7)) ?? months.set(i.from.slice(0, 7), []).get(i.from.slice(0, 7))!).push(i);
  return (
    <>
      <PageHeader title={t("cal.title")} subtitle={t("cal.subtitle")} actions={<span className="flex gap-3 text-sm"><a className="font-medium text-brand-800 hover:underline" href={`/school-calendar?year=${year - 1}`}>{year - 1}</a><strong>{year}</strong><a className="font-medium text-brand-800 hover:underline" href={`/school-calendar?year=${year + 1}`}>{year + 1}</a></span>} />
      {items.length === 0 ? <EmptyState>{t("cal.empty")}</EmptyState> : [...months].map(([m, list]) => (
        <section key={m} className="mb-6">
          <h2 className="mb-2 text-base font-semibold">{displayDate(parseDateOnly(`${m}-01`)!, ctx.locale).replace(/^\d+\s/, "")}</h2>
          <ul className="space-y-2">
            {list.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-4 py-3">
                <span><span className="font-medium">{ctx.locale === "SW" && i.titleSw ? i.titleSw : i.title}</span>{i.location && <span className="block text-sm text-muted">{i.location}</span>}</span>
                <span className="flex items-center gap-2 text-sm text-muted">{!i.isPublic && <Badge>{t("cal.internal")}</Badge>}{displayDate(parseDateOnly(i.from)!, ctx.locale)}{i.to && i.to !== i.from ? ` – ${displayDate(parseDateOnly(i.to)!, ctx.locale)}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
