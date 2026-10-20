import type { Metadata } from "next";
import { Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { getT } from "@/lib/auth/next";
import { getSite, telHref, waHref } from "@/lib/site";
import { PageHero } from "@/components/site/blocks";

export const metadata: Metadata = { title: "Contact" };

export default async function ContactPage() {
  const [site, t] = await Promise.all([getSite(), getT()]);
  if (!site) return null;
  const c = site.contact;
  const items = [
    c.address && { icon: MapPin, label: t("site.contact.address"), value: c.address },
    c.phone && { icon: Phone, label: t("site.contact.phone"), value: c.phone, href: telHref(c.phone) },
    c.phone2 && { icon: Phone, label: t("site.contact.phone"), value: c.phone2, href: telHref(c.phone2) },
    c.whatsapp && { icon: MessageCircle, label: t("site.contact.whatsapp"), value: c.whatsapp, href: waHref(c.whatsapp), external: true },
    c.email && { icon: Mail, label: t("site.contact.email"), value: c.email, href: `mailto:${c.email}` },
    c.hours && { icon: Clock, label: t("site.contact.hours"), value: c.hours },
  ].filter(Boolean) as { icon: typeof MapPin; label: string; value: string; href?: string; external?: boolean }[];
  return (
    <>
      <PageHero kicker={t("site.contact.kicker")} title={t("site.contact.title")} />
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        {items.length === 0 ? (
          <p className="text-muted">{t("site.contact.empty")}</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {items.map((i) => (
              <li key={i.label + i.value} className="flex gap-4 rounded-2xl border border-brand-800/10 bg-white p-5">
                <i.icon className="mt-1 size-5 shrink-0 text-accent" aria-hidden />
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">{i.label}</p>
                  {i.href ? <a className="break-words text-lg font-medium text-brand-900 hover:underline" href={i.href} {...(i.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{i.value}</a> : <p className="break-words text-lg font-medium text-brand-900">{i.value}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
