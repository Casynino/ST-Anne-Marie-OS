import type { Metadata } from "next";
import { getT } from "@/lib/auth/next";
import { ActionForm, Field } from "@/components/form";
import { PageHero } from "@/components/site/blocks";
import { trackApplicationAction } from "../actions";

export const metadata: Metadata = { title: "Application status", robots: { index: false } };

export default async function TrackPage() {
  const t = await getT();
  return (
    <>
      <PageHero photo={false} title={t("apply.track.title")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/apply", label: t("site.nav.admissions") }, { href: "/apply/track", label: t("apply.track.title") }]}>{t("apply.track.intro")}</PageHero>
      <div className="mx-auto max-w-[100rem] px-4 py-10 sm:px-6">
        <div className="max-w-xl border border-line bg-surface p-6">
          <ActionForm action={trackApplicationAction} submitLabel={t("apply.track.button")}>
            <Field name="applicationNo" label={t("apply.track.number")} placeholder="APP/2026/0001" required autoComplete="off" />
            <Field name="phone" label={t("apply.track.phone")} type="tel" required />
          </ActionForm>
        </div>
      </div>
    </>
  );
}
