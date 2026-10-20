import type { Metadata } from "next";
import { CalendarDays, MapPin } from "lucide-react";
import { getLocale, getT } from "@/lib/auth/next";
import { getSite } from "@/lib/site";
import { listPublicEvents } from "@/server/website";
import { displayDate } from "@/lib/dates";
import { PageHero } from "@/components/site/blocks";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage() {
  const [site, t, locale] = await Promise.all([getSite(), getT(), getLocale()]);
  if (!site) return null;
  const events = await listPublicEvents(site.school.id, site.school.timezone);
  return (
    <>
      <PageHero kicker={t("site.events.kicker")} title={t("site.events.title")} />
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        {events.length === 0 ? <p className="text-muted">{t("site.events.empty")}</p> : (
          <ul className="space-y-4">
            {events.map((e) => {
              const desc = locale === "SW" && e.descriptionSw ? e.descriptionSw : e.description;
              return (
                <li key={e.id} className="rounded-2xl border border-brand-800/10 bg-white p-5">
                  <p className="flex items-center gap-2 text-sm font-medium text-accent-700"><CalendarDays className="size-4" aria-hidden />{displayDate(e.startsOn, locale)}{e.endsOn ? ` – ${displayDate(e.endsOn, locale)}` : ""}</p>
                  <h2 className="site-serif mt-1 text-2xl font-semibold text-brand-900">{locale === "SW" && e.titleSw ? e.titleSw : e.title}</h2>
                  {e.location && <p className="mt-1 flex items-center gap-2 text-sm text-muted"><MapPin className="size-4" aria-hidden />{e.location}</p>}
                  {desc && <p className="mt-3 whitespace-pre-line text-muted">{desc}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
