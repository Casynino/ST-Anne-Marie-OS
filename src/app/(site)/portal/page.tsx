import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getContext, getT } from "@/lib/auth/next";
import { homeFor } from "@/lib/auth/home";
import { getSite, pageMetadata } from "@/lib/site";
import { ButtonLink, CtaBand, PageHero } from "@/components/site/blocks";
import { Reveal } from "@/components/site/fx/reveal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { ...pageMetadata(await getSite(), { title: t("site.nav.portal"), path: "/portal" }), robots: { index: false, follow: true } };
}

export default async function PortalPage() {
  const [site, t, ctx] = await Promise.all([getSite(), getT(), getContext()]);
  if (ctx) redirect(homeFor(ctx.userType)); // already signed in: no second sign-in, no confusion
  if (!site) return null;
  const { contact } = site;
  return (
    <>
      <PageHero eyebrow={t("site.portal.title")} title={t("site.nav.portal")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/portal", label: t("site.nav.portal") }]}>{t("site.portal.lead")}</PageHero>
      <div className="mx-auto max-w-[100rem] px-4 py-16 sm:px-6">
        <ul className="grid max-w-4xl border-t border-ink sm:grid-cols-3 sm:divide-x sm:divide-ink/25">
          {(["parents", "students", "staff"] as const).map((k, i) => (
            <Reveal as="li" key={k} delay={i * 80} className="border-b border-ink/25 px-1 py-8 sm:px-8 sm:first:pl-0"><span aria-hidden className="display text-5xl text-brand-600">{String(i + 1).padStart(2, "0")}</span><h2 className="display mt-3 text-3xl">{t(`site.portal.${k}`)}</h2></Reveal>
          ))}
        </ul>
        <div className="mt-12"><CtaBand title={t("site.portal.signInTitle")} actions={<><ButtonLink href="/login" variant="sun" arrow>{t("site.nav.signIn")}</ButtonLink><ButtonLink href="/contact" variant="ghost">{contact.phone ? t("site.portal.needHelp") : t("site.nav.contact")}</ButtonLink></>}>{t("site.portal.signInBody")}</CtaBand></div>
        <p className="mt-6 text-sm text-muted">{t("site.portal.noAccount")}</p>
      </div>
    </>
  );
}
