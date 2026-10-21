import Image from "next/image";
import Link from "next/link";
import type { Translate } from "@/lib/i18n";
import type { PublicSite } from "@/server/website";
import { initialsOf, telHref, waHref } from "@/lib/site";
import type { SiteLink } from "@/components/site/site-header";
import { ButtonLink } from "@/components/site/blocks";

const LINK = "inline-flex min-h-9 items-center text-[15px] text-white/80 transition-colors hover:text-sun";
const ROW = "grid grid-cols-[6.5rem_1fr] gap-3 py-3";

/** The foot of every page: an invitation, then where to go and how to reach the school, in the school's deep green. */
export function SiteFooter({ t, site, links }: { t: Translate; site: PublicSite; links: SiteLink[] }) {
  const { school, contact, social, levels, images, settings } = site;
  const hasContact = Object.values(contact).some(Boolean);
  const intro = site.text.heroSubtitle ?? school.motto;
  const open = settings.applicationsOpen;
  return (
    <footer className="site-deep bg-brand-950 text-white">
      <div className="border-b-4 border-sun bg-brand-800">
        <div className="mx-auto flex max-w-[100rem] flex-wrap items-center justify-between gap-6 px-4 py-10 sm:px-8">
          <p className="display max-w-2xl text-3xl text-white sm:text-4xl">{t("site.cta.title")}</p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href={open ? "/apply/form" : "/apply"} variant="sun" arrow>{open ? t("site.hero.apply") : t("site.nav.admissions")}</ButtonLink>
            <ButtonLink href="/contact" variant="ghost">{t("site.nav.contact")}</ButtonLink>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-[100rem] gap-x-12 gap-y-12 px-4 py-16 sm:px-8 sm:grid-cols-2 lg:grid-cols-[1.2fr_0.8fr_0.8fr_1.4fr]">
        <div>
          <Link href="/" className="inline-flex items-center gap-4" aria-label={school.name}>
            {images.logo ? <Image src={images.logo.src} alt="" width={64} height={64} className="size-16 shrink-0 rounded-full bg-white object-contain" /> : <span aria-hidden className="display flex size-14 shrink-0 items-center justify-center rounded-full bg-white text-base text-brand-800">{initialsOf(school.name)}</span>}
            <span className="display text-2xl text-white">{school.name}</span>
          </Link>
          {intro && <p className="mt-5 max-w-xs text-[15px] leading-relaxed text-white/70">{intro}</p>}
          {(social.facebook || social.instagram || social.youtube) && (
            <ul className="mt-5 flex flex-wrap gap-3 text-sm font-bold">
              {social.facebook && <li><a className="rounded-md border border-white/30 px-4 py-2 hover:border-sun hover:text-sun" href={social.facebook} target="_blank" rel="noopener noreferrer">Facebook</a></li>}
              {social.instagram && <li><a className="rounded-md border border-white/30 px-4 py-2 hover:border-sun hover:text-sun" href={social.instagram} target="_blank" rel="noopener noreferrer">Instagram</a></li>}
              {social.youtube && <li><a className="rounded-md border border-white/30 px-4 py-2 hover:border-sun hover:text-sun" href={social.youtube} target="_blank" rel="noopener noreferrer">YouTube</a></li>}
            </ul>
          )}
        </div>

        <nav aria-label={t("site.footer.explore")}>
          <p className="eyebrow">{t("site.footer.explore")}</p>
          <ul className="mt-4">
            {links.map((l) => <li key={l.href}><Link className={LINK} href={l.href}>{l.label}</Link></li>)}
            <li><Link className={LINK} href="/calendar">{t("site.nav.calendar")}</Link></li>
            <li><Link className={LINK} href="/search">{t("site.nav.search")}</Link></li>
            <li><Link className={LINK} href="/portal">{t("site.nav.portal")}</Link></li>
          </ul>
        </nav>

        <nav aria-label={t("site.footer.programmes")}>
          <p className="eyebrow">{t("site.footer.programmes")}</p>
          <ul className="mt-4">
            {levels.map((l) => <li key={l.id}><Link className={LINK} href={`/academics#${l.slug}`}>{l.name}</Link></li>)}
            <li><Link className={LINK} href="/apply">{t("site.nav.admissions")}</Link></li>
            <li><Link className={LINK} href="/apply/visit">{t("site.nav.visit")}</Link></li>
            <li><Link className={LINK} href="/apply/track">{t("site.admissions.track")}</Link></li>
          </ul>
        </nav>

        <div>
          <p className="eyebrow">{t("site.contact.title")}</p>
          {hasContact ? (
            <dl className="mt-3 divide-y divide-white/15 text-[15px] text-white/90">
              {contact.address && <div className={ROW}><dt className="text-white/55">{t("site.contact.address")}</dt><dd>{contact.address}</dd></div>}
              {contact.phone && <div className={ROW}><dt className="text-white/55">{t("site.contact.phone")}</dt><dd><a href={telHref(contact.phone)} className="hover:text-sun">{contact.phone}</a></dd></div>}
              {contact.phone2 && <div className={ROW}><dt className="text-white/55">{t("site.contact.phone")}</dt><dd><a href={telHref(contact.phone2)} className="hover:text-sun">{contact.phone2}</a></dd></div>}
              {contact.whatsapp && <div className={ROW}><dt className="text-white/55">WhatsApp</dt><dd><a href={waHref(contact.whatsapp)} target="_blank" rel="noopener noreferrer" className="hover:text-sun">{contact.whatsapp}</a></dd></div>}
              {contact.email && <div className={ROW}><dt className="text-white/55">{t("site.contact.email")}</dt><dd><a href={`mailto:${contact.email}`} className="break-all hover:text-sun">{contact.email}</a></dd></div>}
              {contact.hours && <div className={ROW}><dt className="text-white/55">{t("site.contact.hours")}</dt><dd>{contact.hours}</dd></div>}
              {contact.mapUrl && <div className={ROW}><dt className="text-white/55">{t("site.contact.directions")}</dt><dd><a href={contact.mapUrl} target="_blank" rel="noopener noreferrer" className="hover:text-sun">→</a></dd></div>}
            </dl>
          ) : (
            <p className="mt-4 text-[15px] text-white/70">{t("site.contact.empty")}</p>
          )}
        </div>
      </div>

      <div className="border-t border-white/15">
        <div className="mx-auto flex max-w-[100rem] flex-wrap items-center justify-between gap-x-8 gap-y-3 px-4 py-6 text-[13px] text-white/60 sm:px-8">
          <p>{t("site.footer.rights", { year: new Date().getFullYear(), name: school.name })}</p>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            <li><Link href="/privacy" className="hover:text-white">{t("site.footer.privacy")}</Link></li>
            <li><Link href="/login" className="hover:text-white">{t("site.nav.signIn")}</Link></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
