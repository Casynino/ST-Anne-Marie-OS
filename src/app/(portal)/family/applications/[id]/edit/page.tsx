import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireContext, getLocale, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { getApplicationReview } from "@/server/application-draft";
import { listApplyClasses } from "@/server/public-applications";
import { RELATIONSHIPS } from "@/server/guardians";
import { ActionForm } from "@/components/form";
import { ApplicationFields } from "@/components/site/application-fields";
import { EntryTypeProvider } from "@/components/site/entry-type";
import { LinkButton, PageHeader } from "@/components/ui";
import { updateApplicationAction } from "../../actions";

export const metadata: Metadata = { title: "Change application" };

/** The family corrects what it entered, before paying. The same questions as the public form. */
export default async function EditApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const a = await getApplicationReview(ctx, id).catch((e) => (e instanceof AppError && e.code === "NOT_FOUND" ? null : Promise.reject(e)));
  if (!a) notFound();
  if (a.draftStatus !== "AWAITING_PAYMENT") redirect(`/family/applications/${id}`);
  const classes = await listApplyClasses(ctx.schoolId, locale);
  const classOptions = classes.map((c) => ({ value: c.id, label: `${c.level} — ${c.name}` }));
  const relOptions = RELATIONSHIPS.map((r) => ({ value: r, label: t(`student.rel.${r}` as "student.rel.FATHER") }));
  return (
    <>
      <PageHeader title={t("apf.edit.title")} subtitle={t("apf.edit.sub")} actions={<LinkButton href={`/family/applications/${id}`} variant="secondary">{t("common.cancel")}</LinkButton>} />
      <div className="max-w-4xl">
        <ActionForm action={updateApplicationAction} submitLabel={t("common.save")} className="space-y-6">
          <input type="hidden" name="id" value={id} />
          <EntryTypeProvider defaultKind={a.form.entryType === "TRANSFER" ? "TRANSFER" : "NEW"}>
            <ApplicationFields t={t} classOptions={classOptions} relOptions={relOptions} d={a.form} emailRequired={false} variant="portal" />
          </EntryTypeProvider>
        </ActionForm>
      </div>
    </>
  );
}
