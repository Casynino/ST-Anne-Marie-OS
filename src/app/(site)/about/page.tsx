import type { Metadata } from "next";
import { getT } from "@/lib/auth/next";
import { getSite, pageMetadata } from "@/lib/site";
import { ButtonLink, CtaBand, Eyebrow, PageHero, PhotoSlot, Print, Prose, SectionHeading } from "@/components/site/blocks";
import { Reveal } from "@/components/site/fx/reveal";
import { Gallery } from "@/components/site/fx/gallery";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return pageMetadata(await getSite(), { title: t("site.nav.about"), path: "/about" });
}

export default async function AboutPage() {
  const [site, t] = await Promise.all([getSite(), getT()]);
  if (!site) return null;
  const { text, images, school, levels, contact } = site;
  const aboutPhoto = images.about;
  const statements = ([["vision", text.vision], ["mission", text.mission]] as const).filter(([, v]) => v);
  // "At a glance": only what the school's own records say (its motto, address, levels and phone).
  const glance = [
    school.motto ? { label: t("site.about.glance.motto"), value: school.motto } : null,
    contact.address ? { label: t("site.about.glance.where"), value: contact.address } : null,
    levels.length > 0 ? { label: t("site.about.glance.levels"), value: levels.map((l) => l.name).join(" · ") } : null,
    contact.phone ? { label: t("site.about.glance.call"), value: contact.phone } : null,
  ].filter((g): g is { label: string; value: string } => !!g);

  return (
    <>
      <PageHero eyebrow={t("site.about.kicker")} title={t("site.about.title")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/about", label: t("site.nav.about") }]}>{school.motto}</PageHero>

      {glance.length > 0 && (
        <section aria-label={t("site.about.glance")} className="border-b border-line bg-surface">
          <dl className="mx-auto grid max-w-[100rem] divide-y divide-line px-4 sm:grid-cols-2 sm:divide-x sm:divide-y-0 sm:px-6 lg:grid-cols-4">
            {glance.map((g) => (
              <div key={g.label} className="py-6 sm:px-6 sm:first:pl-0">
                <dt className="eyebrow">{g.label}</dt>
                <dd className="display mt-2 text-xl leading-snug text-heading sm:text-2xl">{g.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <div className="mx-auto max-w-[100rem] space-y-24 px-4 py-20 sm:px-6">
        {(text.about || aboutPhoto) && (
          <section className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
            <div>{text.about ? <Reveal><Prose className="space-y-5 text-xl leading-relaxed">{text.about}</Prose></Reveal> : <p className="text-muted">{t("site.about.empty")}</p>}</div>
            <Reveal className="mx-auto w-full max-w-sm lg:max-w-none">
              {aboutPhoto ? <Print image={aboutPhoto} sizes="(min-width: 1024px) 36vw, 80vw" ratio="aspect-[4/5]" /> : <PhotoSlot label={t("site.photo.pending")} className="aspect-[4/5]" />}
            </Reveal>
          </section>
        )}

        {statements.length > 0 && (
          <section id="vision" className="scroll-mt-28 grid gap-6 md:grid-cols-2">
            {statements.map(([k, v], i) => (
              <Reveal key={k} delay={i * 100} className={`p-8 sm:p-12 ${i === 0 ? "bg-brand-800 text-white" : "bg-sun text-[#10200f]"}`}>
                <p className="eyebrow !text-current opacity-80">{t(`site.about.${k}`)}</p>
                <p className="display mt-4 text-2xl leading-snug sm:text-3xl">{v}</p>
              </Reveal>
            ))}
          </section>
        )}

        {text.strengths.length > 0 && (
          <section id="expect" className="scroll-mt-28">
            <SectionHeading eyebrow={t("site.about.expectKicker")} title={t("site.about.expect")} />
            <ol className="mt-10 grid gap-5 sm:grid-cols-2">
              {text.strengths.map((s, i) => (
                <Reveal as="li" key={s.title} delay={(i % 2) * 80} className="flex gap-5 border border-line bg-surface p-6">
                  <span aria-hidden className="display grid size-12 shrink-0 place-items-center bg-brand-700 text-lg text-white">{i + 1}</span>
                  <div><h3 className="display text-2xl text-heading">{s.title}</h3>{s.text && <p className="mt-1.5 text-muted">{s.text}</p>}</div>
                </Reveal>
              ))}
            </ol>
          </section>
        )}

        {levels.length > 0 && (
          <section id="levels" className="scroll-mt-28">
            <SectionHeading eyebrow={t("site.about.levelsKicker")} title={t("site.about.levels")} />
            <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {levels.map((l, i) => (
                <Reveal as="li" key={l.id} delay={(i % 4) * 70} className="border-t-4 border-sun bg-surface p-6 shadow-[var(--shadow-card)]">
                  <h3 className="display text-2xl text-heading">{l.name}</h3>
                  {l.classes.length > 0 ? <p className="mt-3 text-muted"><span className="font-semibold text-ink">{t("site.about.classes")}: </span>{l.classes.join(", ")}</p> : <p className="mt-3 text-muted">{t("site.about.classesSoon")}</p>}
                </Reveal>
              ))}
            </ul>
            <p className="mt-6"><a href="/academics" className="font-semibold text-link underline underline-offset-4">{t("site.nav.academics")}</a></p>
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
          <section id="values" className="scroll-mt-28">
            <SectionHeading eyebrow={t("site.about.valuesKicker")} title={t("site.about.values")} />
            <ol className="mt-10 divide-y divide-line border-y border-line">
              {text.values.map((v, i) => (
                <Reveal as="li" key={v.title} className="grid gap-2 py-7 sm:grid-cols-[5rem_1fr_1.4fr] sm:items-baseline sm:gap-6">
                  <span aria-hidden className="display text-4xl text-link">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="display text-2xl text-heading">{v.title}</h3>
                  <p className="text-muted">{v.text}</p>
                </Reveal>
              ))}
            </ol>
          </section>
        )}

        {text.history && (
          <section id="history" className="scroll-mt-28 grid gap-10 lg:grid-cols-[0.6fr_1.4fr]">
            <SectionHeading eyebrow={t("site.about.historyKicker")} title={t("site.about.history")} />
            <Reveal><Prose>{text.history}</Prose></Reveal>
          </section>
        )}

        {text.leadership.length > 0 && (
          <section id="leadership" className="scroll-mt-28">
            <SectionHeading eyebrow={t("site.about.leadershipKicker")} title={t("site.about.leadership")} />
            <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {text.leadership.map((p) => <Reveal as="li" key={p.title} className="rounded-3xl border border-line bg-surface p-6"><p className="display text-xl text-heading">{p.title}</p>{p.text && <p className="mt-1 text-muted">{p.text}</p>}</Reveal>)}
            </ul>
          </section>
        )}

        {text.facilities && (
          <section id="facilities" className="scroll-mt-28 grid gap-10 lg:grid-cols-[0.6fr_1.4fr]">
            <SectionHeading eyebrow={t("site.life.kicker")} title={t("site.about.facilities")} />
            <Reveal><Prose>{text.facilities}</Prose></Reveal>
          </section>
        )}

        {text.safeguarding && (
          <section id="safeguarding" className="scroll-mt-28 grid gap-10 lg:grid-cols-[0.6fr_1.4fr]">
            <SectionHeading eyebrow={t("site.nav.about")} title={t("site.about.safeguarding")} />
            <Reveal><Prose>{text.safeguarding}</Prose></Reveal>
          </section>
        )}

        {images.gallery.length > 0 && (
          <section>
            <SectionHeading eyebrow={t("site.life.kicker")} title={t("site.about.environment")} />
            <Reveal className="mt-10"><Gallery items={images.gallery.slice(0, 6)} labels={{ close: t("nav.close"), prev: t("site.gallery.prev"), next: t("site.gallery.next"), open: t("site.gallery.open") }} /></Reveal>
          </section>
        )}

        <CtaBand title={t("site.cta.title")} actions={<><ButtonLink href="/apply" variant="sun" arrow>{t("site.nav.admissions")}</ButtonLink><ButtonLink href="/contact" variant="ghost">{t("site.nav.contact")}</ButtonLink></>}>{levels.length > 0 ? levels.map((l) => l.name).join(" · ") : null}</CtaBand>
      </div>
    </>
  );
}
