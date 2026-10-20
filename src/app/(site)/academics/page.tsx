import type { Metadata } from "next";
import { getT } from "@/lib/auth/next";
import { getSite, pageMetadata } from "@/lib/site";
import { ButtonLink, CtaBand, Eyebrow, PageHero, Prose, SectionHeading } from "@/components/site/blocks";
import { Reveal } from "@/components/site/fx/reveal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return pageMetadata(await getSite(), { title: t("site.nav.academics"), path: "/academics" });
}


export default async function AcademicsPage() {
  const [site, t] = await Promise.all([getSite(), getT()]);
  if (!site) return null;
  const { text, levels } = site;
  const info = ([["learningApproach", text.learningApproach], ["curriculum", text.curriculum], ["academicSupport", text.academicSupport], ["examinations", text.examinations]] as const).filter(([, v]) => v);

  return (
    <>
      <PageHero eyebrow={t("site.programs.kicker")} title={t("site.nav.academics")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/academics", label: t("site.nav.academics") }]}>{t("site.academics.lead")}</PageHero>

      <div className="mx-auto max-w-[100rem] space-y-24 px-4 py-20 sm:px-6">
        {levels.length === 0 ? <p className="text-muted">{t("site.academics.empty")}</p> : (
          <div className="border-b border-ink">
            {levels.map((l, i) => (
              <Reveal key={l.id} className="scroll-mt-28 border-t border-ink md:grid md:grid-cols-[0.8fr_1.4fr]">
                <div id={l.slug} className="flex min-h-32 items-start gap-5 py-8 md:pr-8">
                  <span aria-hidden className="pt-2 text-sm font-semibold tabular-nums text-muted">{String(i + 1).padStart(2, "0")}</span>
                  <h2 className="display text-5xl sm:text-6xl">{l.name}</h2>
                </div>
                <div className="py-8 md:pl-8">
                  {l.summary ? <p className="text-lg text-ink/85">{l.summary}</p> : <p className="text-muted">{t("site.academics.levelDefault", { name: l.name })}</p>}
                  {l.focus && <p className="mt-4"><span className="font-semibold text-brand-800">{t("site.programs.focus")}: </span>{l.focus}</p>}
                  <div className="mt-6"><p className="eyebrow">{t("site.academics.classes")}</p><ul className="mt-3 flex flex-wrap gap-2">{l.classes.map((c) => <li key={c} className="border border-ink px-3 py-1 text-sm font-semibold text-ink">{c}</li>)}</ul></div>
                  {l.subjects.length > 0 && <div className="mt-6"><p className="eyebrow">{t("site.academics.subjects")}</p><ul className="mt-3 flex flex-wrap gap-2">{l.subjects.map((s) => <li key={s} className="border border-line px-3 py-1 text-sm text-ink/80">{s}</li>)}</ul></div>}
                </div>
              </Reveal>
            ))}
          </div>
        )}

        {info.length > 0 && (
          <section>
            <SectionHeading eyebrow={t("site.academics.approachKicker")} title={t("site.academics.approach")} />
            <div className="mt-10 grid gap-10 md:grid-cols-2">
              {info.map(([k, v], i) => <Reveal key={k} delay={(i % 2) * 90}><Eyebrow>{t(`site.academics.${k}`)}</Eyebrow><Prose className="mt-3">{v}</Prose></Reveal>)}
            </div>
          </section>
        )}

        <CtaBand title={t("site.cta.title")} actions={<><ButtonLink href="/apply" variant="sun" arrow>{t("site.nav.admissions")}</ButtonLink><ButtonLink href="/contact" variant="ghost">{t("site.nav.contact")}</ButtonLink></>} />
      </div>
    </>
  );
}
