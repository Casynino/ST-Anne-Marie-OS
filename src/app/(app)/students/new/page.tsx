import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { listClasses } from "@/server/academics";
import { ActionForm, Field, IfConflict } from "@/components/form";
import { GuardianFields } from "@/components/guardian-fields";
import { guardianLabels } from "@/components/guardian-labels";
import { StudentDetailsFields } from "@/components/student-form";
import { Card, NoAccess, PageHeader } from "@/components/ui";
import { createStudentAction } from "../actions";

export const metadata: Metadata = { title: "Register student" };

export default async function NewStudentPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("student.create") || !ctx.permissions.has("guardian.manage")) return <NoAccess t={t} />;
  const canPlace = ctx.permissions.has("student.enroll");
  const classes = canPlace ? (await listClasses(ctx)).filter((c) => c.isActive) : [];
  const placementOptions = classes.flatMap((c) => (c.streams.length ? c.streams.map((s) => ({ value: `${c.id}|${s.id}`, label: `${c.name} – ${s.name}` })) : [{ value: c.id, label: c.name }]));
  const labels = await guardianLabels(ctx.permissions.has("guardian.read") || ctx.permissions.has("guardian.manage"));

  return (
    <>
      <PageHeader title={t("student.new")} subtitle={t("student.new.intro")} />
      <ActionForm action={createStudentAction} submitLabel={t("common.save")} className="space-y-5">
        <Card title={t("student.profile.details")}>
          <StudentDetailsFields t={t} showAdmissionDate canEditMedical={ctx.permissions.has("student.medical.update")} />
        </Card>
        {canPlace && (
          <Card title={t("student.placement")}>
            <Field name="placement" label={`${t("student.class")} / ${t("student.stream")}`} type="select" options={placementOptions} placeholder={t("common.select")} hint={t("student.placement.hint")} />
          </Card>
        )}
        <Card title={t("student.guardian1")}>
          <GuardianFields prefix="g1_" labels={labels} canSearch={labels.canSearch} primary />
        </Card>
        <Card title={`${t("student.guardian2")} (${t("common.optional")})`}>
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-link">{t("student.link")}</summary>
            <div className="mt-2"><GuardianFields prefix="g2_" labels={labels} canSearch={labels.canSearch} optionalBlock /></div>
          </details>
        </Card>
        <Card title={t("student.emergency")}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field name="ec1_name" label={t("student.emergency.name")} optionalLabel={t("common.optional")} />
            <Field name="ec1_relationship" label={t("student.relationship")} optionalLabel={t("common.optional")} />
            <Field name="ec1_phone" label={t("common.phone")} type="tel" optionalLabel={t("common.optional")} />
          </div>
        </Card>
        <IfConflict><Field name="confirmDuplicate" type="checkbox" label={t("student.confirmDuplicate")} /></IfConflict>
      </ActionForm>
    </>
  );
}
