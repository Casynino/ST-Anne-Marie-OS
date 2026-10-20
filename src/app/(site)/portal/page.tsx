import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GraduationCap, ShieldCheck, Users } from "lucide-react";
import { getContext, getT } from "@/lib/auth/next";
import { homeFor } from "@/lib/auth/home";
import { getSite, pageMetadata } from "@/lib/site";
import { ButtonLink, PageHero } from "@/components/site/blocks";
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
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <ul className="grid gap-4 sm:grid-cols-3">
          {([["parents", Users], ["students", GraduationCap], ["staff", ShieldCheck]] as const).map(([k, Icon], i) => (
            <Reveal as="li" key={k} delay={i * 80} className="rounded-3xl border border-line bg-white p-6"><Icon className="size-8 text-brand-600" aria-hidden /><h2 className="mt-4 text-xl font-bold text-brand-900">{t(`site.portal.${k}`)}</h2></Reveal>
          ))}
        </ul>
        <div className="mt-10 rounded-3xl bg-brand-700 p-8 text-white sm:p-10">
          <h2 className="display text-3xl">{t("site.portal.signInTitle")}</h2>
          <p className="mt-3 max-w-xl text-brand-100">{t("site.portal.signInBody")}</p>
          <div className="mt-6 flex flex-wrap gap-3"><ButtonLink href="/login" variant="sun" arrow>{t("site.nav.signIn")}</ButtonLink><ButtonLink href="/contact" variant="ghost">{contact.phone ? t("site.portal.needHelp") : t("site.nav.contact")}</ButtonLink></div>
        </div>
        <p className="mt-6 text-sm text-muted">{t("site.portal.noAccount")}</p>
      </div>
    </>
  );
}
