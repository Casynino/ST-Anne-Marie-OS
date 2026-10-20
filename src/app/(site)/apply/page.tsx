import Link from "next/link";
import type { Metadata } from "next";
import { Check } from "lucide-react";
import { getT } from "@/lib/auth/next";
import { getSite } from "@/lib/site";
import { CtaLink, PageHero, SectionHeading } from "@/components/site/blocks";

export const metadata: Metadata = { title: "Admissions" };

export default async function AdmissionsPage() {
  const [site, t] = await Promise.all([getSite(), getT()]);
  if (!site) return null;
  const { text, settings } = site;
  const hasDetail = text.admissionsIntro || text.requirements.length > 0 || text.feesNote || text.faqs.length > 0;
  return (
    <>
      <PageHero kicker={t("site.how.kicker")} title={t("site.admissions.title")}>{text.admissionsIntro ?? (hasDetail ? undefined : t("site.admissions.default"))}</PageHero>
      <div className="mx-auto max-w-6xl space-y-14 px-4 py-12 sm:px-6">
        <section>
          <SectionHeading title={t("site.how.title")} />
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {([1, 2, 3] as const).map((n) => (
              <li key={n} className="rounded-2xl border border-brand-800/10 bg-white p-6">
                <span className="site-serif flex size-10 items-center justify-center rounded-full bg-accent-50 text-lg font-semibold text-accent-700">{n}</span>
                <h3 className="mt-4 text-lg font-semibold text-brand-900">{t(`site.how.${n}.title`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{t(`site.how.${n}.body`)}</p>
              </li>
            ))}
          </ol>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            {settings.applicationsOpen ? <CtaLink href="/apply/form" variant="accent" arrow>{t("site.nav.apply")}</CtaLink> : <p className="text-sm text-muted">{t("site.hero.closed")}</p>}
            <Link href="/apply/track" className="inline-flex min-h-11 items-center font-semibold text-brand-800 hover:underline">{t("site.admissions.track")}</Link>
          </div>
        </section>

        {text.requirements.length > 0 && (
          <section>
            <SectionHeading title={t("site.admissions.requirements")} />
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {text.requirements.map((r) => (
                <li key={r} className="flex gap-3 rounded-2xl border border-brand-800/10 bg-white p-4"><Check className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden /><span>{r}</span></li>
              ))}
            </ul>
          </section>
        )}

        {text.feesNote && (
          <section>
            <SectionHeading title={t("site.admissions.fees")} />
            <p className="mt-4 max-w-3xl whitespace-pre-line text-base leading-relaxed text-ink/85">{text.feesNote}</p>
          </section>
        )}

        {text.faqs.length > 0 && (
          <section>
            <SectionHeading title={t("site.admissions.faq")} />
            <div className="mt-6 max-w-3xl divide-y divide-brand-800/10 rounded-2xl border border-brand-800/10 bg-white">
              {text.faqs.map((f) => (
                <details key={f.q} className="group p-5">
                  <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-4 font-semibold text-brand-900 [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span aria-hidden className="text-xl text-accent transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 whitespace-pre-line leading-relaxed text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
