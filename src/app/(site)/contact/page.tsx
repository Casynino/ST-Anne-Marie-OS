import type { Metadata } from "next";
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
    c.address && { label: t("site.contact.address"), value: c.address },
    c.phone && { label: t("site.contact.phone"), value: c.phone, href: telHref(c.phone) },
    c.phone2 && { label: t("site.contact.phone"), value: c.phone2, href: telHref(c.phone2) },
    c.whatsapp && { label: "WhatsApp", value: c.whatsapp, href: waHref(c.whatsapp), external: true },
    c.email && { label: t("site.contact.email"), value: c.email, href: `mailto:${c.email}` },
    c.hours && { label: t("site.contact.hours"), value: c.hours },
  ].filter(Boolean) as { label: string; value: string; href?: string; external?: boolean }[];

  return (
    <>
      <PageHero eyebrow={t("site.contact.kicker")} title={t("site.contact.title")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/contact", label: t("site.nav.contact") }]}>{t("site.contact.lead")}</PageHero>
      <div className="mx-auto grid max-w-[100rem] gap-14 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          {items.length === 0 ? <p className="text-muted">{t("site.contact.empty")}</p> : (
            <dl className="divide-y divide-line border-y border-line text-lg">
              {items.map((i) => (
                <div key={i.label + i.value} className="grid gap-1 py-4 sm:grid-cols-[8rem_1fr]">
                  <dt className="pt-1 text-xs font-bold uppercase tracking-[.16em] text-muted">{i.label}</dt>
                  <dd className="min-w-0 break-words">{i.href ? <a className="font-semibold hover:underline" href={i.href} {...(i.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{i.value}</a> : i.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {c.mapUrl && <div className="mt-6"><ButtonLink href={c.mapUrl} external variant="outline" arrow>{t("site.contact.directions")}</ButtonLink></div>}
        </div>
        <Reveal className="border border-line bg-surface p-6 sm:p-9"><h2 className="display mb-6 text-4xl">{t("site.form.title")}</h2><ContactForm t={t} idPrefix="contact" /></Reveal>
      </div>
    </>
  );
}
