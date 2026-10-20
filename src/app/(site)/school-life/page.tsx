import type { Metadata } from "next";
import { getT } from "@/lib/auth/next";
import { getSite, pageMetadata } from "@/lib/site";
import { ButtonLink, CtaBand, PageHero, SectionHeading } from "@/components/site/blocks";
import { Reveal } from "@/components/site/fx/reveal";
import { Gallery } from "@/components/site/fx/gallery";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return pageMetadata(await getSite(), { title: t("site.nav.schoolLife"), path: "/school-life" });
}

export default async function SchoolLifePage() {
  const [site, t] = await Promise.all([getSite(), getT()]);
  if (!site) return null;
  const { text, images } = site;
  const empty = text.schoolLife.length === 0 && images.gallery.length === 0;
  return (
    <>
      <PageHero eyebrow={t("site.life.kicker")} title={t("site.nav.schoolLife")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/school-life", label: t("site.nav.schoolLife") }]}>{t("site.life.lead")}</PageHero>
      <div className="mx-auto max-w-[100rem] space-y-24 px-4 py-20 sm:px-6">
        {empty && <p className="text-muted">{t("site.life.empty")}</p>}

        {images.gallery.length > 0 && (
          <section>
            <SectionHeading eyebrow={t("site.gallery.kicker")} title={t("site.gallery.title")} />
            <Reveal className="mt-10"><Gallery items={images.gallery} labels={{ close: t("nav.close"), prev: t("site.gallery.prev"), next: t("site.gallery.next"), open: t("site.gallery.open") }} /></Reveal>
          </section>
        )}

        {text.schoolLife.length > 0 && (
          <section>
            <SectionHeading eyebrow={t("site.life.activitiesKicker")} title={t("site.life.activities")} />
            <ul className="mt-10 divide-y divide-line border-y border-line">
              {text.schoolLife.map((a, i) => (
                <Reveal as="li" key={a.title} className="grid gap-2 py-7 sm:grid-cols-[5rem_1fr_1.4fr] sm:gap-6">
                  <span aria-hidden className="display text-4xl text-brand-600">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="display text-2xl text-brand-900">{a.title}</h3>
                  <p className="text-muted">{a.text}</p>
                </Reveal>
              ))}
            </ul>
          </section>
        )}

        <CtaBand title={t("site.life.more")} actions={<><ButtonLink href="/news" variant="sun" arrow>{t("site.nav.newsEvents")}</ButtonLink><ButtonLink href="/events" variant="ghost">{t("site.events.all")}</ButtonLink></>} />
      </div>
    </>
  );
}
