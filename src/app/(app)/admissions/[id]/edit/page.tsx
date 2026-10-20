import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { getApplication, OPEN_STATUSES } from "@/server/admissions";
import { listClasses } from "@/server/academics";
import { ActionForm, Field, IfConflict } from "@/components/form";
import { StudentDetailsFields } from "@/components/student-form";
import { Card, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { guardianLabels } from "@/components/guardian-labels";
import { updateApplicationAction } from "../../actions";

export const metadata: Metadata = { title: "Edit application" };

export default async function EditApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("admission.create")) return <NoAccess t={t} />;
  const { id } = await params;
  let app: Awaited<ReturnType<typeof getApplication>>;
  try {
    app = await getApplication(ctx, id);
  } catch (e) {
    if (e instanceof AppError) return <EmptyState>{e.message}</EmptyState>;
    throw e;
  }
  if (!(OPEN_STATUSES as readonly string[]).includes(app.status)) return <EmptyState>{t("adm.closed")}</EmptyState>;
  const classes = ctx.permissions.has("academic.read") ? (await listClasses(ctx)).filter((c) => c.isActive) : [];
  const labels = await guardianLabels(false);
  const stored = app.guardians as { guardianId?: string; fullName?: string; phone?: string; email?: string; relationship?: string }[];

  return (
    <>
      <PageHeader title={t("adm.edit")} subtitle={app.applicationNo} />
      <ActionForm action={updateApplicationAction} submitLabel={t("common.save")} className="space-y-5">
        <input type="hidden" name="id" value={id} />
        <Card title={t("adm.details")}>
          <StudentDetailsFields t={t} canEditMedical={false} d={app} />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field name="classAppliedId" label={t("adm.classApplied")} type="select" defaultValue={app.classAppliedId} options={classes.map((c) => ({ value: c.id, label: c.name }))} placeholder={t("common.select")} optionalLabel={t("common.optional")} />
            <Field name="assessmentNotes" label={t("adm.assessmentNotes")} type="textarea" rows={2} defaultValue={app.assessmentNotes} optionalLabel={t("common.optional")} />
          </div>
        </Card>
        <Card title={t("adm.guardians")}>
          <div className="space-y-4">
            {stored.map((g, i) =>
              g.guardianId ? (
                <p key={i} className="text-sm text-muted">{t("adm.guardianEditNote")}</p>
              ) : (
                <div key={i} className="grid gap-3 sm:grid-cols-2">
                  <Field name={`g${i + 1}_fullName`} label={labels.fullName} defaultValue={g.fullName} required />
                  <Field name={`g${i + 1}_phone`} label={labels.phone} type="tel" defaultValue={g.phone} required />
                  <Field name={`g${i + 1}_email`} label={labels.email} type="email" defaultValue={g.email} optionalLabel={labels.optional} />
                  <Field name={`g${i + 1}_relationship`} label={labels.relationship} type="select" defaultValue={g.relationship} options={labels.relationships} placeholder={labels.select} required />
                </div>
              ),
            )}
          </div>
        </Card>
        <IfConflict><Field name="confirmDuplicate" type="checkbox" label={t("adm.confirmDuplicate")} /></IfConflict>
      </ActionForm>
    </>
  );
}
