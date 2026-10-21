import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireContext, getLocale, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { getOfficeDraft } from "@/server/office-application";
import { listApplyClasses } from "@/server/public-applications";
import { RELATIONSHIPS } from "@/server/guardians";
import { ActionForm, Field } from "@/components/form";
import { ApplicationFields } from "@/components/site/application-fields";
import { EntryTypeProvider } from "@/components/site/entry-type";
import { LinkButton, NoAccess, PageHeader } from "@/components/ui";
import { updateOfficeDraftAction } from "../../../actions";

export const metadata: Metadata = { title: "Change application" };

/** Corrects an application filled in at the office, while it is still waiting for its fee. The same questions as the form it was filled in on. */
export default async function EditOfficeDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  if (!ctx.permissions.has("admission.create")) return <NoAccess t={t} />;
  const d = await getOfficeDraft(ctx, id).catch((e) => (e instanceof AppError && e.code === "NOT_FOUND" ? null : Promise.reject(e)));
  if (!d) notFound();
  if (d.status !== "AWAITING_PAYMENT") redirect(`/admissions/drafts/${id}`);
  const classes = await listApplyClasses(ctx.schoolId, locale);
  const classOptions = classes.map((c) => ({ value: c.id, label: `${c.level} — ${c.name}` }));
  const relOptions = RELATIONSHIPS.map((r) => ({ value: r, label: t(`student.rel.${r}` as "student.rel.FATHER") }));
  return (
    <>
      <PageHeader title={t("adm.draft.edit.title")} subtitle={t("adm.draft.edit.sub")} actions={<LinkButton href={`/admissions/drafts/${id}`} variant="secondary">{t("common.cancel")}</LinkButton>} />
      <div className="max-w-4xl">
        <ActionForm action={updateOfficeDraftAction} submitLabel={t("common.save")} className="space-y-6">
          <input type="hidden" name="id" value={id} />
          <EntryTypeProvider defaultKind={d.form.entryType === "TRANSFER" ? "TRANSFER" : "NEW"}>
            <ApplicationFields t={t} classOptions={classOptions} relOptions={relOptions} d={d.form} emailRequired={false} variant="portal" />
          </EntryTypeProvider>
          <div className="space-y-2 rounded-2xl border border-line bg-surface p-5"><Field name="consent" type="checkbox" label={t("apply.consent")} required defaultValue /></div>
        </ActionForm>
      </div>
    </>
  );
}
