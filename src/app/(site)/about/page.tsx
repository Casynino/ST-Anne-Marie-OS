import type { Metadata } from "next";
import { getT } from "@/lib/auth/next";
import { getSite, pageMetadata } from "@/lib/site";
import { ButtonLink, Eyebrow, PageHero, PhotoSlot, Prose, SectionHeading } from "@/components/site/blocks";
import { Reveal } from "@/components/site/fx/reveal";
import { Photo } from "@/components/site/photo";
import { Gallery } from "@/components/site/fx/gallery";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return pageMetadata(await getSite(), { title: t("site.nav.about"), path: "/about" });
}

export default async function AboutPage() {
  const [site, t] = await Promise.all([getSite(), getT()]);
  if (!site) return null;
  const { text, images, school, levels } = site;
  const aboutPhoto = images.about;
  const statements = ([["vision", text.vision], ["mission", text.mission]] as const).filter(([, v]) => v);

  return (
    <>
      <PageHero eyebrow={t("site.about.kicker")} title={t("site.about.title")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/about", label: t("site.nav.about") }]}>{school.motto}</PageHero>

      <div className="mx-auto max-w-6xl space-y-24 px-4 py-20 sm:px-6">
        {(text.about || aboutPhoto) && (
          <section className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
            <div>{text.about ? <Reveal><Prose className="first-letter:display first-letter:float-left first-letter:mr-3 first-letter:text-7xl first-letter:leading-[0.9] first-letter:text-brand-700">{text.about}</Prose></Reveal> : <p className="text-muted">{t("site.about.empty")}</p>}</div>
            <Reveal className="mx-auto w-full max-w-sm lg:max-w-none">
              {aboutPhoto ? <div className="frame frame-arch aspect-[4/5] shadow-[var(--shadow-card)]"><Photo image={aboutPhoto} sizes="(min-width: 1024px) 36vw, 80vw" /></div> : <PhotoSlot label={t("site.photo.pending")} className="frame-arch aspect-[4/5]" />}
            </Reveal>
          </section>
        )}

        {statements.length > 0 && (
          <section className="grid gap-6 md:grid-cols-2">
            {statements.map(([k, v], i) => (
              <Reveal key={k} delay={i * 100} className={`rounded-3xl p-8 sm:p-10 ${i === 0 ? "bg-brand-700 text-white" : "bg-sun text-brand-950"}`}>
                <p className="eyebrow !text-current opacity-80">{t(`site.about.${k}`)}</p>
                <p className="display mt-4 text-2xl leading-snug sm:text-3xl">{v}</p>
              </Reveal>
            ))}
          </section>
        )}

        {(text.philosophy || text.learningApproach) && (
          <section className="grid gap-12 md:grid-cols-2">
            {([["philosophy", text.philosophy], ["learningApproach", text.learningApproach]] as const).filter(([, v]) => v).map(([k, v], i) => (
              <Reveal key={k} delay={i * 100}><Eyebrow>{t(`site.intro.${k}`)}</Eyebrow><Prose className="mt-4">{v}</Prose></Reveal>
            ))}
          </section>
        )}

        {text.values.length > 0 && (
          <section>
            <SectionHeading eyebrow={t("site.about.valuesKicker")} title={t("site.about.values")} />
            <ol className="mt-10 divide-y divide-line border-y border-line">
              {text.values.map((v, i) => (
                <Reveal as="li" key={v.title} className="grid gap-2 py-7 sm:grid-cols-[5rem_1fr_1.4fr] sm:items-baseline sm:gap-6">
                  <span aria-hidden className="display text-4xl text-brand-300">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="display text-2xl text-brand-900">{v.title}</h3>
                  <p className="text-muted">{v.text}</p>
                </Reveal>
              ))}
            </ol>
          </section>
        )}

        {text.history && (
          <section className="grid gap-10 lg:grid-cols-[0.6fr_1.4fr]">
            <SectionHeading eyebrow={t("site.about.historyKicker")} title={t("site.about.history")} />
            <Reveal><Prose>{text.history}</Prose></Reveal>
          </section>
        )}

        {text.leadership.length > 0 && (
          <section>
            <SectionHeading eyebrow={t("site.about.leadershipKicker")} title={t("site.about.leadership")} />
            <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {text.leadership.map((p) => <Reveal as="li" key={p.title} className="rounded-3xl border border-line bg-white p-6"><p className="display text-xl text-brand-900">{p.title}</p>{p.text && <p className="mt-1 text-muted">{p.text}</p>}</Reveal>)}
            </ul>
          </section>
        )}

        {images.gallery.length > 0 && (
          <section>
            <SectionHeading eyebrow={t("site.life.kicker")} title={t("site.about.environment")} />
            <Reveal className="mt-10"><Gallery items={images.gallery.slice(0, 6)} labels={{ close: t("nav.close"), prev: t("site.gallery.prev"), next: t("site.gallery.next"), open: t("site.gallery.open") }} /></Reveal>
          </section>
        )}

        <section className="flex flex-wrap items-center justify-between gap-6 rounded-3xl bg-cream-deep p-8 sm:p-12">
          <div><h2 className="display text-3xl text-brand-950">{t("site.cta.title")}</h2>{levels.length > 0 && <p className="mt-2 text-muted">{levels.map((l) => l.name).join(" · ")}</p>}</div>
          <div className="flex flex-wrap gap-3"><ButtonLink href="/apply" arrow>{t("site.nav.admissions")}</ButtonLink><ButtonLink href="/contact" variant="outline">{t("site.nav.contact")}</ButtonLink></div>
        </section>
      </div>
    </>
  );
}
