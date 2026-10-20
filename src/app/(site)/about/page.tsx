import type { Metadata } from "next";
import { getT } from "@/lib/auth/next";
import { getSite } from "@/lib/site";
import { CtaLink, PageHero, SectionHeading } from "@/components/site/blocks";

export const metadata: Metadata = { title: "About" };

export default async function AboutPage() {
  const [site, t] = await Promise.all([getSite(), getT()]);
  if (!site) return null;
  const { text, settings, levels, school } = site;
  return (
    <>
      <PageHero kicker={t("site.about.kicker")} title={t("site.about.title")}>{school.motto}</PageHero>
      <div className="mx-auto max-w-6xl space-y-14 px-4 py-12 sm:px-6">
        {(text.about || settings.aboutImagePath) && (
          <section className="grid gap-8 lg:grid-cols-2 lg:items-start">
            {text.about && <p className="whitespace-pre-line text-lg leading-relaxed text-ink/85">{text.about}</p>}
            {settings.aboutImagePath && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={settings.aboutImagePath} alt="" width={640} height={480} loading="lazy" decoding="async" className="aspect-[4/3] w-full rounded-3xl object-cover" />
            )}
          </section>
        )}
        {levels.length > 0 && (
          <section>
            <SectionHeading kicker={t("site.levels.kicker")} title={t("site.levels.title")} />
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {levels.map((l) => (
                <article key={l.id} className="rounded-2xl border border-brand-800/10 bg-white p-6">
                  <h3 className="site-serif text-2xl font-semibold text-brand-900">{l.name}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{l.classes.join(" · ")}</p>
                </article>
              ))}
            </div>
          </section>
        )}
        <CtaLink href="/contact" variant="solid" arrow>{t("site.nav.contact")}</CtaLink>
      </div>
    </>
  );
}
