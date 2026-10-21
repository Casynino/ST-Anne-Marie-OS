import type { Metadata } from "next";
import { getT } from "@/lib/auth/next";
import { ActionForm, Field } from "@/components/form";
import { PageHero } from "@/components/site/blocks";
import { trackApplicationAction, uploadApplicantDocumentAction } from "../actions";
import { FileInput } from "@/app/(app)/admissions/[id]/parts";
import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "@/server/documents";

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
        <div className="mt-8 max-w-xl border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold">{t("apply.upload.title")}</h2>
          <p className="mb-4 mt-1 text-sm text-muted">{t("apply.upload.hint")}</p>
          <ActionForm action={uploadApplicantDocumentAction} submitLabel={t("apply.upload.button")}>
            <Field name="applicationNo" label={t("apply.track.number")} placeholder="APP/2026/0001" required autoComplete="off" />
            <Field name="phone" label={t("apply.track.phone")} type="tel" required />
            <Field name="docType" label={t("doc.type")} type="select" required options={DOCUMENT_TYPES.map((d) => ({ value: d, label: t(`doc.type.${d}`) }))} placeholder={t("common.select")} />
            <FileInput label={t("doc.file")} hint={t("doc.file.hint", { size: Math.floor(MAX_DOCUMENT_BYTES / 1024 / 1024) })} />
          </ActionForm>
        </div>
      </div>
    </>
  );
}
