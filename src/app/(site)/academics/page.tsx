import type { Metadata } from "next";
import { getT } from "@/lib/auth/next";
import { getSite, pageMetadata } from "@/lib/site";
import { ButtonLink, Eyebrow, PageHero, Prose, SectionHeading } from "@/components/site/blocks";
import { Reveal } from "@/components/site/fx/reveal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return pageMetadata(await getSite(), { title: t("site.nav.academics"), path: "/academics" });
}

const TONES = ["bg-brand-700 text-white", "bg-indigo text-white", "bg-sun text-brand-950", "bg-brand-900 text-white"] as const;

export default async function AcademicsPage() {
  const [site, t] = await Promise.all([getSite(), getT()]);
  if (!site) return null;
  const { text, levels } = site;
  const info = ([["learningApproach", text.learningApproach], ["curriculum", text.curriculum], ["academicSupport", text.academicSupport], ["examinations", text.examinations]] as const).filter(([, v]) => v);

  return (
    <>
      <PageHero eyebrow={t("site.programs.kicker")} title={t("site.nav.academics")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/academics", label: t("site.nav.academics") }]}>{t("site.academics.lead")}</PageHero>

      <div className="mx-auto max-w-6xl space-y-24 px-4 py-20 sm:px-6">
        {levels.length === 0 ? <p className="text-muted">{t("site.academics.empty")}</p> : (
          <div className="space-y-6">
            {levels.map((l, i) => (
              <Reveal key={l.id} className="scroll-mt-28 overflow-hidden rounded-3xl border border-line bg-white md:grid md:grid-cols-[0.8fr_1.4fr]">
                <div id={l.slug} className={`relative flex min-h-40 items-end overflow-hidden p-8 ${TONES[i % TONES.length]}`}>
                  <span aria-hidden className="absolute -right-8 -top-12 size-52 rounded-full bg-white/10" />
                  <span aria-hidden className="absolute bottom-0 right-10 h-24 w-16 rounded-t-full bg-white/15" />
                  <h2 className="display relative text-4xl">{l.name}</h2>
                </div>
                <div className="p-8 sm:p-10">
                  {l.summary ? <p className="text-lg text-ink/85">{l.summary}</p> : <p className="text-muted">{t("site.academics.levelDefault", { name: l.name })}</p>}
                  {l.focus && <p className="mt-4"><span className="font-semibold text-brand-800">{t("site.programs.focus")}: </span>{l.focus}</p>}
                  <div className="mt-6"><p className="eyebrow">{t("site.academics.classes")}</p><ul className="mt-3 flex flex-wrap gap-2">{l.classes.map((c) => <li key={c} className="rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-800">{c}</li>)}</ul></div>
                  {l.subjects.length > 0 && <div className="mt-6"><p className="eyebrow">{t("site.academics.subjects")}</p><ul className="mt-3 flex flex-wrap gap-2">{l.subjects.map((s) => <li key={s} className="rounded-full border border-line px-3 py-1 text-sm text-ink/80">{s}</li>)}</ul></div>}
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

        <section className="flex flex-wrap items-center justify-between gap-6 rounded-3xl bg-brand-700 p-8 text-white sm:p-12">
          <h2 className="display max-w-lg text-3xl sm:text-4xl">{t("site.cta.title")}</h2>
          <div className="flex flex-wrap gap-3"><ButtonLink href="/apply" variant="sun" arrow>{t("site.nav.admissions")}</ButtonLink><ButtonLink href="/contact" variant="ghost">{t("site.nav.contact")}</ButtonLink></div>
        </section>
      </div>
    </>
  );
}
