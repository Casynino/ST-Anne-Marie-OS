import Image from "next/image";
import Link from "next/link";
import type { Translate } from "@/lib/i18n";
import type { PublicSite } from "@/server/website";
import { initialsOf, telHref, waHref } from "@/lib/site";
import type { SiteLink } from "@/components/site/site-header";

const LINK = "inline-flex min-h-9 items-center text-[15px] text-cream/80 hover:text-cream hover:underline underline-offset-4";

/** The back page: the school's name set large, then ruled lists of where to go and how to reach the school. */
export function SiteFooter({ t, site, links }: { t: Translate; site: PublicSite; links: SiteLink[] }) {
  const { school, contact, social, levels, images } = site;
  const hasContact = Object.values(contact).some(Boolean);
  const intro = site.text.heroSubtitle ?? school.motto;
  return (
    <footer className="bg-ink text-cream">
      <div className="mx-auto max-w-[100rem] px-4 pt-16 sm:px-6 sm:pt-24">
        <Link href="/" className="flex items-center gap-4" aria-label={school.name}>
          {images.logo && <Image src={images.logo.src} alt="" width={56} height={56} className="size-12 shrink-0 bg-cream object-contain p-1 sm:size-14" />}
          <span className="display text-[clamp(2.4rem,7.5vw,6.5rem)] leading-[.92] text-cream">{school.name || initialsOf(school.name)}</span>
        </Link>
        {intro && <p className="lead mt-6 max-w-2xl text-cream/70">{intro}</p>}

        <div className="mt-14 grid gap-x-10 gap-y-10 border-t border-cream/30 pt-8 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.3fr]">
          <nav aria-label={t("site.footer.explore")}>
            <p className="eyebrow eyebrow-light">{t("site.footer.explore")}</p>
            <ul className="mt-4">
              {links.map((l) => <li key={l.href}><Link className={LINK} href={l.href}>{l.label}</Link></li>)}
              <li><Link className={LINK} href="/portal">{t("site.nav.portal")}</Link></li>
            </ul>
          </nav>

          <nav aria-label={t("site.footer.programmes")}>
            <p className="eyebrow eyebrow-light">{t("site.footer.programmes")}</p>
            <ul className="mt-4">
              {levels.map((l) => <li key={l.id}><Link className={LINK} href={`/academics#${l.slug}`}>{l.name}</Link></li>)}
              <li><Link className={LINK} href="/apply">{t("site.nav.admissions")}</Link></li>
              <li><Link className={LINK} href="/apply/track">{t("site.admissions.track")}</Link></li>
            </ul>
          </nav>

          <div>
            <p className="eyebrow eyebrow-light">{t("site.contact.title")}</p>
            {hasContact ? (
              <dl className="mt-4 divide-y divide-cream/15 text-[15px]">
                {contact.address && <div className="grid grid-cols-[6.5rem_1fr] gap-3 py-2.5"><dt className="text-cream/55">{t("site.contact.address")}</dt><dd>{contact.address}</dd></div>}
                {contact.phone && <div className="grid grid-cols-[6.5rem_1fr] gap-3 py-2.5"><dt className="text-cream/55">{t("site.contact.phone")}</dt><dd><a href={telHref(contact.phone)} className="hover:underline">{contact.phone}</a></dd></div>}
                {contact.phone2 && <div className="grid grid-cols-[6.5rem_1fr] gap-3 py-2.5"><dt className="text-cream/55">{t("site.contact.phone")}</dt><dd><a href={telHref(contact.phone2)} className="hover:underline">{contact.phone2}</a></dd></div>}
                {contact.whatsapp && <div className="grid grid-cols-[6.5rem_1fr] gap-3 py-2.5"><dt className="text-cream/55">WhatsApp</dt><dd><a href={waHref(contact.whatsapp)} target="_blank" rel="noopener noreferrer" className="hover:underline">{contact.whatsapp}</a></dd></div>}
                {contact.email && <div className="grid grid-cols-[6.5rem_1fr] gap-3 py-2.5"><dt className="text-cream/55">{t("site.contact.email")}</dt><dd><a href={`mailto:${contact.email}`} className="break-all hover:underline">{contact.email}</a></dd></div>}
                {contact.hours && <div className="grid grid-cols-[6.5rem_1fr] gap-3 py-2.5"><dt className="text-cream/55">{t("site.contact.hours")}</dt><dd>{contact.hours}</dd></div>}
                {contact.mapUrl && <div className="grid grid-cols-[6.5rem_1fr] gap-3 py-2.5"><dt className="text-cream/55">{t("site.contact.directions")}</dt><dd><a href={contact.mapUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">→</a></dd></div>}
              </dl>
            ) : (
              <p className="mt-4 text-[15px] text-cream/70">{t("site.contact.empty")}</p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-14 border-t border-cream/30">
        <div className="mx-auto flex max-w-[100rem] flex-wrap items-center justify-between gap-x-8 gap-y-3 px-4 py-6 text-[13px] text-cream/65 sm:px-6">
          <p>{t("site.footer.rights", { year: new Date().getFullYear(), name: school.name })}</p>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {social.facebook && <li><a className="hover:text-cream hover:underline" href={social.facebook} target="_blank" rel="noopener noreferrer">Facebook</a></li>}
            {social.instagram && <li><a className="hover:text-cream hover:underline" href={social.instagram} target="_blank" rel="noopener noreferrer">Instagram</a></li>}
            {social.youtube && <li><a className="hover:text-cream hover:underline" href={social.youtube} target="_blank" rel="noopener noreferrer">YouTube</a></li>}
            <li><Link href="/privacy" className="hover:text-cream hover:underline">{t("site.footer.privacy")}</Link></li>
            <li><Link href="/login" className="hover:text-cream hover:underline">{t("site.nav.signIn")}</Link></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
