import type { Metadata } from "next";
import { getT } from "@/lib/auth/next";
import { getSite, pageMetadata, telHref } from "@/lib/site";
import { ButtonLink, PageHero } from "@/components/site/blocks";
import { ContactForm } from "@/components/site/contact-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return pageMetadata(await getSite(), { title: t("site.visit.title"), path: "/apply/visit" });
}

/** Asking to visit the school: saved as an enquiry with the topic "Visit", handled in the staff enquiries inbox. */
export default async function VisitPage() {
  const [site, t] = await Promise.all([getSite(), getT()]);
  if (!site) return null;
  const { contact } = site;
  return (
    <>
      <PageHero eyebrow={t("site.visit.kicker")} title={t("site.visit.title")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/apply", label: t("site.nav.admissions") }, { href: "/apply/visit", label: t("site.visit.title") }]}>{t("site.visit.lead")}</PageHero>
      <div className="mx-auto grid max-w-[100rem] gap-12 px-4 pb-24 pt-10 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="space-y-4 text-lg">
          {contact.address && <p className="text-ink/90">{contact.address}</p>}
          {contact.hours && <p className="text-muted">{contact.hours}</p>}
          {contact.phone && <p><a href={telHref(contact.phone)} className="font-bold text-brand-700 hover:underline">{contact.phone}</a></p>}
          {contact.mapUrl && <div className="pt-2"><ButtonLink href={contact.mapUrl} external variant="outline" arrow>{t("site.contact.directions")}</ButtonLink></div>}
        </div>
        <div className="card-y p-6 sm:p-9"><ContactForm t={t} idPrefix="visit" defaultTopic="Visit" messageHint={t("site.visit.hint")} /></div>
      </div>
    </>
  );
}
