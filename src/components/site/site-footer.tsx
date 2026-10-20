import Image from "next/image";
import Link from "next/link";
import { Clock, Mail, MapPin, MessageCircle, Navigation, Phone } from "lucide-react";
import type { Translate } from "@/lib/i18n";
import type { PublicSite } from "@/server/website";
import { initialsOf, telHref, waHref } from "@/lib/site";
import type { SiteLink } from "@/components/site/site-header";

export function SiteFooter({ t, site, links }: { t: Translate; site: PublicSite; links: SiteLink[] }) {
  const { school, contact, social, levels, images } = site;
  const hasContact = Object.values(contact).some(Boolean);
  const intro = site.text.heroSubtitle ?? school.motto;
  return (
    <footer className="bg-brand-950 text-brand-100">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1.2fr]">
        <div>
          <Link href="/" className="inline-flex items-center gap-3" aria-label={school.name}>
            {images.logo ? <Image src={images.logo.src} alt="" width={48} height={48} className="size-12 rounded-full bg-white object-contain p-0.5" /> : <span aria-hidden className="display flex size-12 items-center justify-center rounded-full bg-white text-sm font-semibold text-brand-800">{initialsOf(school.name)}</span>}
            <span className="display text-xl font-semibold text-white">{school.name}</span>
          </Link>
          {intro && <p className="mt-4 max-w-xs text-sm leading-relaxed text-brand-200">{intro}</p>}
          {(social.facebook || social.instagram || social.youtube) && (
            <ul className="mt-5 flex gap-4 text-sm font-semibold">
              {social.facebook && <li><a className="underline-offset-4 hover:text-white hover:underline" href={social.facebook} target="_blank" rel="noopener noreferrer">Facebook</a></li>}
              {social.instagram && <li><a className="underline-offset-4 hover:text-white hover:underline" href={social.instagram} target="_blank" rel="noopener noreferrer">Instagram</a></li>}
              {social.youtube && <li><a className="underline-offset-4 hover:text-white hover:underline" href={social.youtube} target="_blank" rel="noopener noreferrer">YouTube</a></li>}
            </ul>
          )}
        </div>

        <nav aria-label={t("site.footer.explore")}>
          <p className="eyebrow eyebrow-light">{t("site.footer.explore")}</p>
          <ul className="mt-4 space-y-1">
            {links.map((l) => <li key={l.href}><Link className="inline-flex min-h-9 items-center text-sm hover:text-white" href={l.href}>{l.label}</Link></li>)}
            <li><Link className="inline-flex min-h-9 items-center text-sm hover:text-white" href="/portal">{t("site.nav.portal")}</Link></li>
          </ul>
        </nav>

        <nav aria-label={t("site.footer.programmes")}>
          <p className="eyebrow eyebrow-light">{t("site.footer.programmes")}</p>
          <ul className="mt-4 space-y-1">
            {levels.map((l) => <li key={l.id}><Link className="inline-flex min-h-9 items-center text-sm hover:text-white" href={`/academics#${l.slug}`}>{l.name}</Link></li>)}
            <li><Link className="inline-flex min-h-9 items-center text-sm hover:text-white" href="/apply">{t("site.nav.admissions")}</Link></li>
            <li><Link className="inline-flex min-h-9 items-center text-sm hover:text-white" href="/apply/track">{t("site.admissions.track")}</Link></li>
          </ul>
        </nav>

        <div>
          <p className="eyebrow eyebrow-light">{t("site.contact.title")}</p>
          {hasContact ? (
            <ul className="mt-4 space-y-2.5 text-sm">
              {contact.address && <li className="flex gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-sun" aria-hidden />{contact.address}</li>}
              {contact.phone && <li className="flex gap-2"><Phone className="mt-0.5 size-4 shrink-0 text-sun" aria-hidden /><a href={telHref(contact.phone)} className="hover:text-white">{contact.phone}</a></li>}
              {contact.phone2 && <li className="flex gap-2"><Phone className="mt-0.5 size-4 shrink-0 text-sun" aria-hidden /><a href={telHref(contact.phone2)} className="hover:text-white">{contact.phone2}</a></li>}
              {contact.whatsapp && <li className="flex gap-2"><MessageCircle className="mt-0.5 size-4 shrink-0 text-sun" aria-hidden /><a href={waHref(contact.whatsapp)} target="_blank" rel="noopener noreferrer" className="hover:text-white">WhatsApp</a></li>}
              {contact.email && <li className="flex gap-2"><Mail className="mt-0.5 size-4 shrink-0 text-sun" aria-hidden /><a href={`mailto:${contact.email}`} className="break-all hover:text-white">{contact.email}</a></li>}
              {contact.hours && <li className="flex gap-2"><Clock className="mt-0.5 size-4 shrink-0 text-sun" aria-hidden />{contact.hours}</li>}
              {contact.mapUrl && <li className="flex gap-2"><Navigation className="mt-0.5 size-4 shrink-0 text-sun" aria-hidden /><a href={contact.mapUrl} target="_blank" rel="noopener noreferrer" className="hover:text-white">{t("site.contact.directions")}</a></li>}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-brand-200">{t("site.contact.empty")}</p>
          )}
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-brand-200 sm:px-6">
          <p>{t("site.footer.rights", { year: new Date().getFullYear(), name: school.name })}</p>
          <ul className="flex gap-5">
            <li><Link href="/privacy" className="hover:text-white">{t("site.footer.privacy")}</Link></li>
            <li><Link href="/login" className="hover:text-white">{t("site.nav.signIn")}</Link></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
