import type { Metadata } from "next";
import { Clock, Mail, MapPin, MessageCircle, Navigation, Phone } from "lucide-react";
import { getT } from "@/lib/auth/next";
import { getSite, pageMetadata, telHref, waHref } from "@/lib/site";
import { ButtonLink, PageHero } from "@/components/site/blocks";
import { ContactForm } from "@/components/site/contact-form";
import { Reveal } from "@/components/site/fx/reveal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return pageMetadata(await getSite(), { title: t("site.nav.contact"), path: "/contact" });
}

export default async function ContactPage() {
  const [site, t] = await Promise.all([getSite(), getT()]);
  if (!site) return null;
  const c = site.contact;
  const items = [
    c.address && { icon: MapPin, label: t("site.contact.address"), value: c.address },
    c.phone && { icon: Phone, label: t("site.contact.phone"), value: c.phone, href: telHref(c.phone) },
    c.phone2 && { icon: Phone, label: t("site.contact.phone"), value: c.phone2, href: telHref(c.phone2) },
    c.whatsapp && { icon: MessageCircle, label: "WhatsApp", value: c.whatsapp, href: waHref(c.whatsapp), external: true },
    c.email && { icon: Mail, label: t("site.contact.email"), value: c.email, href: `mailto:${c.email}` },
    c.hours && { icon: Clock, label: t("site.contact.hours"), value: c.hours },
  ].filter(Boolean) as { icon: typeof MapPin; label: string; value: string; href?: string; external?: boolean }[];

  return (
    <>
      <PageHero eyebrow={t("site.contact.kicker")} title={t("site.contact.title")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/contact", label: t("site.nav.contact") }]}>{t("site.contact.lead")}</PageHero>
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          {items.length === 0 ? <p className="text-muted">{t("site.contact.empty")}</p> : (
            <ul className="space-y-3">
              {items.map((i, n) => (
                <Reveal as="li" key={i.label + i.value} delay={n * 50} className="flex gap-4 rounded-2xl border border-line bg-white p-5">
                  <i.icon className="mt-1 size-5 shrink-0 text-brand-600" aria-hidden />
                  <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wider text-muted">{i.label}</p>{i.href ? <a className="break-words text-lg font-semibold text-brand-900 hover:text-brand-700 hover:underline" href={i.href} {...(i.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{i.value}</a> : <p className="break-words text-lg font-semibold text-brand-900">{i.value}</p>}</div>
                </Reveal>
              ))}
            </ul>
          )}
          {c.mapUrl && <div className="mt-6"><ButtonLink href={c.mapUrl} external variant="soft" arrow><Navigation className="size-4" aria-hidden />{t("site.contact.directions")}</ButtonLink></div>}
        </div>
        <Reveal className="rounded-3xl border border-line bg-white p-6 shadow-[var(--shadow-card)] sm:p-8"><h2 className="display mb-6 text-3xl text-brand-950">{t("site.form.title")}</h2><ContactForm t={t} idPrefix="contact" /></Reveal>
      </div>
    </>
  );
}
