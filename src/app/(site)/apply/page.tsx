import Link from "next/link";
import type { Metadata } from "next";
import { Check } from "lucide-react";
import { getT } from "@/lib/auth/next";
import { getSite, pageMetadata, telHref } from "@/lib/site";
import { ButtonLink, PageHero, SectionHeading } from "@/components/site/blocks";
import { Reveal } from "@/components/site/fx/reveal";
import { ContactForm } from "@/components/site/contact-form";

export async function generateMetadata(): Promise<Metadata> {
  const [site, t] = await Promise.all([getSite(), getT()]);
  return pageMetadata(site, { title: t("site.nav.admissions"), path: "/apply", description: site?.text.admissionsIntro });
}

export default async function AdmissionsPage() {
  const [site, t] = await Promise.all([getSite(), getT()]);
  if (!site) return null;
  const { text, settings, levels, contact } = site;
  const open = settings.applicationsOpen;

  return (
    <>
      <PageHero eyebrow={t("site.how.kicker")} title={t("site.admissions.title")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/apply", label: t("site.nav.admissions") }]}>{text.admissionsIntro ?? t("site.admissions.default")}</PageHero>

      <div className="mx-auto max-w-[100rem] space-y-24 px-4 py-20 sm:px-6">
        <section>
          <SectionHeading eyebrow={t("site.admissions.processKicker")} title={t("site.how.title")} />
          <ol className="mt-10 grid gap-x-10 gap-y-8 md:grid-cols-3">
            {([1, 2, 3] as const).map((n, i) => (
              <Reveal as="li" key={n} delay={i * 90} className="border-t border-line pt-4">
                <span aria-hidden className="display text-7xl text-link">{n}</span>
                <h3 className="display mt-3 text-3xl">{t(`site.how.${n}.title`)}</h3>
                <p className="mt-2 max-w-xs text-ink/75">{t(`site.how.${n}.body`)}</p>
              </Reveal>
            ))}
          </ol>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {open ? <ButtonLink href="/apply/form" arrow>{t("site.hero.apply")}</ButtonLink> : <p className="rounded-2xl bg-sun/10 px-4 py-3 text-sm font-medium text-heading">{t("site.hero.closed")}</p>}
            <ButtonLink href="/apply/track" variant="outline">{t("site.admissions.track")}</ButtonLink>
          </div>
          <p className="mt-4 max-w-2xl text-sm text-muted">{t("site.admissions.disclaimer")}</p>
        </section>

        {levels.length > 0 && (
          <section>
            <SectionHeading eyebrow={t("site.programs.kicker")} title={t("site.admissions.levels")} />
            <ul className="mt-8 grid border-t border-line sm:grid-cols-2 lg:grid-cols-4">
              {levels.map((l) => <li key={l.id} className="border-b border-line"><Link href={`/academics#${l.slug}`} className="block px-1 py-5 hover:bg-surface sm:px-4"><p className="display text-3xl">{l.name}</p><p className="mt-1 text-sm text-muted">{l.classes.join(" · ")}</p></Link></li>)}
            </ul>
          </section>
        )}

        {text.requirements.length > 0 && (
          <section id="requirements" className="scroll-mt-28">
            <SectionHeading eyebrow={t("site.admissions.requirementsKicker")} title={t("site.admissions.requirements")} />
            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
              {text.requirements.map((r) => <Reveal as="li" key={r} className="flex gap-3 rounded-2xl border border-line bg-surface p-4"><Check className="mt-0.5 size-5 shrink-0 text-link" aria-hidden /><span>{r}</span></Reveal>)}
            </ul>
          </section>
        )}

        {text.feesNote && (
          <section id="fees" className="scroll-mt-28 rounded-3xl border border-line bg-surface p-8 sm:p-10">
            <h2 className="display text-3xl text-heading">{t("site.admissions.fees")}</h2>
            <p className="mt-4 max-w-3xl whitespace-pre-line text-lg text-ink/85">{text.feesNote}</p>
          </section>
        )}

        {text.faqs.length > 0 && (
          <section id="faq" className="scroll-mt-28">
            <SectionHeading eyebrow={t("site.admissions.faqKicker")} title={t("site.admissions.faq")} />
            <div className="mt-8 max-w-3xl divide-y divide-line rounded-3xl border border-line bg-surface">
              {text.faqs.map((f) => (
                <details key={f.q} className="group p-5 sm:px-7">
                  <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold text-heading [&::-webkit-details-marker]:hidden">{f.q}<span aria-hidden className="text-2xl text-link transition-transform duration-200 group-open:rotate-45">+</span></summary>
                  <p className="mt-3 whitespace-pre-line leading-relaxed text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        <section className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <SectionHeading eyebrow={t("site.admissions.inquiryKicker")} title={t("site.admissions.inquiry")}>{t("site.admissions.inquiryLead")}</SectionHeading>
            {contact.phone && <p className="mt-6 text-lg">{t("site.admissions.prefer")} <a className="font-semibold text-link hover:underline" href={telHref(contact.phone)}>{contact.phone}</a></p>}
          </div>
          <div className="rounded-3xl border border-line bg-surface p-6 shadow-[var(--shadow-card)] sm:p-8"><ContactForm t={t} idPrefix="admissions" /></div>
        </section>
      </div>
    </>
  );
}
