import type { Metadata } from "next";
import { getT } from "@/lib/auth/next";
import { getSite, pageMetadata } from "@/lib/site";
import { ButtonLink, Eyebrow, PageHero, Prose } from "@/components/site/blocks";
import { Reveal } from "@/components/site/fx/reveal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return pageMetadata(await getSite(), { title: t("site.sl.title"), path: "/student-life" });
}

/** The practical side of the school day. Every block is the school's own text and appears only when the school has written it. */
export default async function StudentLifePage() {
  const [site, t] = await Promise.all([getSite(), getT()]);
  if (!site) return null;
  const { text } = site;
  const blocks = ([["uniform", text.uniform], ["transport", text.transport], ["meals", text.meals], ["health", text.health]] as const).filter(([, v]) => v);
  const empty = blocks.length === 0 && text.clubs.length === 0;
  return (
    <>
      <PageHero eyebrow={t("site.sl.kicker")} title={t("site.sl.title")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/student-life", label: t("site.sl.title") }]}>{t("site.sl.lead")}</PageHero>
      <div className="mx-auto max-w-[100rem] space-y-24 px-4 pb-24 pt-10 sm:px-8">
        {empty && <p className="text-muted">{t("site.sl.empty")}</p>}
        {text.clubs.length > 0 && (
          <section id="clubs" className="scroll-mt-28">
            <Eyebrow>{t("site.sl.clubs")}</Eyebrow>
            <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {text.clubs.map((c, i) => (
                <Reveal as="li" key={c.title} delay={(i % 3) * 80} className="card-y p-7">
                  <span aria-hidden className="display text-4xl text-brand-600">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="display mt-3 text-3xl text-heading">{c.title}</h3>
                  {c.text && <p className="mt-2 text-muted">{c.text}</p>}
                </Reveal>
              ))}
            </ul>
          </section>
        )}
        {blocks.length > 0 && (
          <section className="grid gap-x-12 gap-y-14 md:grid-cols-2">
            {blocks.map(([k, v], i) => (
              <Reveal key={k} delay={(i % 2) * 90} className="scroll-mt-28 border-t border-line pt-6">
                <div id={k}><h2 className="display text-4xl text-heading">{t(`site.sl.${k}`)}</h2><Prose className="mt-4">{v}</Prose></div>
              </Reveal>
            ))}
          </section>
        )}
        <div className="flex flex-wrap gap-3"><ButtonLink href="/school-life" variant="outline" arrow>{t("site.nav.schoolLife")}</ButtonLink><ButtonLink href="/calendar" variant="ghost">{t("site.nav.calendar")}</ButtonLink></div>
      </div>
    </>
  );
}
