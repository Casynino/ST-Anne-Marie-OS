import type { Metadata } from "next";
import { getT } from "@/lib/auth/next";
import { getSite, pageMetadata } from "@/lib/site";
import { PageHero } from "@/components/site/blocks";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return pageMetadata(await getSite(), { title: t("site.footer.privacy"), path: "/privacy" });
}

/** Describes what THIS website actually does with data. The school should review the wording with its own advisers. */
export default async function PrivacyPage() {
  const [site, t] = await Promise.all([getSite(), getT()]);
  if (!site) return null;
  const sections = ["collect", "use", "access", "cookies", "rights"] as const;
  return (
    <>
      <PageHero photo={false} eyebrow={t("site.footer.privacy")} title={t("site.privacy.title")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/privacy", label: t("site.footer.privacy") }]}>{t("site.privacy.lead", { name: site.school.name })}</PageHero>
      <div className="mx-auto max-w-[100rem] px-4 py-16 sm:px-6"><div className="max-w-3xl space-y-10">
        {sections.map((s) => (
          <section key={s}><h2 className="display border-t border-ink pt-4 text-3xl">{t(`site.privacy.${s}.title`)}</h2><p className="mt-3 text-lg leading-relaxed text-ink/85">{t(`site.privacy.${s}.body`)}</p></section>
        ))}
        {(site.contact.email || site.contact.phone) && <p className="bg-cream-deep p-5 text-ink/85">{t("site.privacy.contact")} {site.contact.email ?? site.contact.phone}</p>}
      </div></div>
    </>
  );
}
