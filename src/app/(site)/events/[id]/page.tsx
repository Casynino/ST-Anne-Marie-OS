import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, MapPin } from "lucide-react";
import { getLocale, getT } from "@/lib/auth/next";
import { baseUrl, getSite, pageMetadata } from "@/lib/site";
import { getPublicEvent, resolveSiteImages } from "@/server/website";
import { displayDate, formatDateOnly } from "@/lib/dates";
import { Photo } from "@/components/site/photo";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const [site, locale] = await Promise.all([getSite(), getLocale()]);
  const e = site ? await getPublicEvent(site.school.id, id) : null;
  if (!site || !e) return { title: "Event", robots: { index: false } };
  return pageMetadata(site, { title: locale === "SW" && e.titleSw ? e.titleSw : e.title, path: `/events/${e.id}`, description: (locale === "SW" && e.descriptionSw ? e.descriptionSw : e.description) ?? undefined });
}

export default async function EventPage({ params }: Props) {
  const { id } = await params;
  const [site, t, locale] = await Promise.all([getSite(), getT(), getLocale()]);
  if (!site) notFound();
  const e = await getPublicEvent(site.school.id, id);
  if (!e) notFound();
  const cover = e.coverImage ? (await resolveSiteImages([e.coverImage])).get(e.coverImage) : undefined;
  const title = locale === "SW" && e.titleSw ? e.titleSw : e.title;
  const description = locale === "SW" && e.descriptionSw ? e.descriptionSw : e.description;
  const ld = { "@context": "https://schema.org", "@type": "Event", name: title, startDate: formatDateOnly(e.startsOn), ...(e.endsOn ? { endDate: formatDateOnly(e.endsOn) } : {}), ...(e.location ? { location: { "@type": "Place", name: e.location } } : {}), ...(description ? { description } : {}), organizer: { "@type": "EducationalOrganization", name: site.school.name, url: baseUrl() } };
  return (
    <article>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <header className="bg-cream"><div className="mx-auto max-w-3xl px-4 pb-10 pt-10 sm:px-6 sm:pt-14">
        <Link href="/events" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-700 hover:underline"><ArrowLeft className="size-4" aria-hidden /> {t("site.events.back")}</Link>
        {e.category && <p className="mt-6 text-xs font-bold uppercase tracking-wider text-brand-700">{e.category}</p>}
        <h1 className="display mt-3 text-4xl text-brand-950 sm:text-6xl">{title}</h1>
        <ul className="mt-6 space-y-2 text-lg">
          <li className="flex items-center gap-3"><CalendarDays className="size-5 text-brand-600" aria-hidden /><span>{displayDate(e.startsOn, locale)}{e.endsOn ? ` – ${displayDate(e.endsOn, locale)}` : ""}</span></li>
          {e.location && <li className="flex items-center gap-3"><MapPin className="size-5 text-brand-600" aria-hidden />{e.location}</li>}
        </ul>
      </div>{cover && <div className="mx-auto max-w-5xl px-4 sm:px-6"><div className="frame aspect-[16/9] rounded-3xl"><Photo image={cover} sizes="(min-width: 1024px) 64rem, 100vw" priority /></div></div>}</header>
      {description && <div className="mx-auto max-w-3xl whitespace-pre-line px-4 py-12 text-lg leading-[1.8] text-ink/90 sm:px-6">{description}</div>}
    </article>
  );
}
