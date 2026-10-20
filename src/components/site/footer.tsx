import Link from "next/link";
import { Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import type { Translate } from "@/lib/i18n";
import { telHref, waHref } from "@/lib/site";
import type { SiteLink } from "@/components/site/site-nav";

type Contact = { phone?: string; phone2?: string; email?: string; address?: string; hours?: string; whatsapp?: string };

export function SiteFooter({ t, name, motto, contact, links, social }: { t: Translate; name: string; motto?: string | null; contact: Contact; links: SiteLink[]; social: { facebook?: string; instagram?: string } }) {
  const hasContact = Object.values(contact).some(Boolean);
  return (
    <footer className="border-t border-white/10 bg-night text-brand-100">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-3">
        <div>
          <p className="site-serif text-2xl text-white">{name}</p>
          {motto && <p className="mt-2 max-w-xs text-sm leading-relaxed text-brand-200">{motto}</p>}
          <div className="mt-4 flex gap-3 text-sm">
            {social.facebook && <a className="underline-offset-4 hover:underline" href={social.facebook} rel="noopener noreferrer" target="_blank">Facebook</a>}
            {social.instagram && <a className="underline-offset-4 hover:underline" href={social.instagram} rel="noopener noreferrer" target="_blank">Instagram</a>}
          </div>
        </div>
        <div>
          <p className="site-mono text-xs font-semibold uppercase text-glow">{t("site.footer.links")}</p>
          <ul className="mt-3 space-y-1">
            {links.map((l) => <li key={l.href}><Link className="inline-flex min-h-9 items-center text-sm hover:text-white" href={l.href}>{l.label}</Link></li>)}
            <li><Link className="inline-flex min-h-9 items-center text-sm hover:text-white" href="/login">{t("site.nav.signIn")}</Link></li>
          </ul>
        </div>
        <div>
          <p className="site-mono text-xs font-semibold uppercase text-glow">{t("site.contact.title")}</p>
          {hasContact ? (
            <ul className="mt-3 space-y-2 text-sm">
              {contact.address && <li className="flex gap-2"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />{contact.address}</li>}
              {contact.phone && <li className="flex gap-2"><Phone className="mt-0.5 size-4 shrink-0" aria-hidden /><a href={telHref(contact.phone)} className="hover:text-white">{contact.phone}</a></li>}
              {contact.phone2 && <li className="flex gap-2"><Phone className="mt-0.5 size-4 shrink-0" aria-hidden /><a href={telHref(contact.phone2)} className="hover:text-white">{contact.phone2}</a></li>}
              {contact.whatsapp && <li className="flex gap-2"><MessageCircle className="mt-0.5 size-4 shrink-0" aria-hidden /><a href={waHref(contact.whatsapp)} rel="noopener noreferrer" target="_blank" className="hover:text-white">WhatsApp</a></li>}
              {contact.email && <li className="flex gap-2"><Mail className="mt-0.5 size-4 shrink-0" aria-hidden /><a href={`mailto:${contact.email}`} className="break-all hover:text-white">{contact.email}</a></li>}
              {contact.hours && <li className="flex gap-2"><Clock className="mt-0.5 size-4 shrink-0" aria-hidden />{contact.hours}</li>}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-brand-200">{t("site.contact.empty")}</p>
          )}
        </div>
      </div>
      <div className="border-t border-white/10 px-4 py-5 text-center text-xs text-brand-200">{t("site.footer.rights", { year: new Date().getFullYear(), name })}</div>
    </footer>
  );
}
