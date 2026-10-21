import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { listClasses } from "@/server/academics";
import { ActionForm, Field, IfConflict } from "@/components/form";
import { GuardianFields } from "@/components/guardian-fields";
import { guardianLabels } from "@/components/guardian-labels";
import { StudentDetailsFields } from "@/components/student-form";
import { Card, NoAccess, PageHeader } from "@/components/ui";
import { createApplicationAction } from "../actions";

export const metadata: Metadata = { title: "New application" };

export default async function NewApplicationPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("admission.create")) return <NoAccess t={t} />;
  const classes = ctx.permissions.has("academic.read") ? (await listClasses(ctx)).filter((c) => c.isActive) : [];
  const labels = await guardianLabels(ctx.permissions.has("guardian.read") || ctx.permissions.has("guardian.manage"));
  return (
    <>
      <PageHeader title={t("adm.new")} subtitle={t("adm.new.intro")} />
      <ActionForm action={createApplicationAction} submitLabel={t("common.save")} className="space-y-5">
        <Card title={t("adm.details")}>
          <StudentDetailsFields t={t} canEditMedical={false} />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field name="classAppliedId" label={t("adm.classApplied")} type="select" options={classes.map((c) => ({ value: c.id, label: c.name }))} placeholder={t("common.select")} optionalLabel={t("common.optional")} />
            <Field name="submittedOn" label={t("adm.submittedOn")} type="date" hint={t("adm.submittedOn.hint")} optionalLabel={t("common.optional")} />
            <Field name="assessmentNotes" label={t("adm.assessmentNotes")} type="textarea" rows={2} optionalLabel={t("common.optional")} />
          </div>
        </Card>
        <Card title={t("student.guardian1")}>
          <GuardianFields prefix="g1_" labels={labels} canSearch={labels.canSearch} primary />
        </Card>
        <Card title={`${t("student.guardian2")} (${t("common.optional")})`}>
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-link">{t("student.link")}</summary>
            <div className="mt-2"><GuardianFields prefix="g2_" labels={labels} canSearch={labels.canSearch} optionalBlock /></div>
          </details>
        </Card>
        <IfConflict><Field name="confirmDuplicate" type="checkbox" label={t("adm.confirmDuplicate")} /></IfConflict>
      </ActionForm>
    </>
  );
}
