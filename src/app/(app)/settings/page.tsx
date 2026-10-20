import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { getAdmissionSettings, getSchoolProfile } from "@/server/settings";
import { formatAdmissionNo } from "@/server/students";
import { ActionForm, Field } from "@/components/form";
import { Card, LinkButton, NoAccess, PageHeader } from "@/components/ui";
import { updateAdmissionAction, updateSchoolAction } from "./actions";

export const metadata: Metadata = { title: "School settings" };

const TIMEZONES = ["Africa/Dar_es_Salaam", "Africa/Nairobi", "Africa/Kampala", "UTC"];

export default async function SettingsPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("school.settings.read")) return <NoAccess t={t} />;
  const [school, admission] = await Promise.all([getSchoolProfile(ctx), getAdmissionSettings((await import("@/lib/db")).db, ctx.schoolId)]);
  const canEdit = ctx.permissions.has("school.settings.update");
  const preview = formatAdmissionNo(admission, new Date().getUTCFullYear(), 1);
  const tzOptions = [...new Set([school.timezone, ...TIMEZONES])].map((z) => ({ value: z, label: z }));

  return (
    <>
      <PageHeader title={t("settings.title")} subtitle={canEdit ? undefined : t("settings.readOnly")} actions={ctx.permissions.has("backup.read") ? <LinkButton href="/settings/backups" variant="secondary">{t("backup.title")}</LinkButton> : undefined} />
      <div className="space-y-5">
        <Card title={t("settings.profile")}>
          <ActionForm action={updateSchoolAction} submitLabel={t("common.save")} hideSubmit={!canEdit}>
            <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2">
              <Field name="name" label={t("settings.name")} defaultValue={school.name} required className="sm:col-span-2" />
              <Field name="motto" label={t("settings.motto")} defaultValue={school.motto} optionalLabel={t("common.optional")} className="sm:col-span-2" />
              <Field name="email" label={t("common.email")} type="email" defaultValue={school.email} optionalLabel={t("common.optional")} />
              <Field name="phone" label={t("common.phone")} type="tel" defaultValue={school.phone} optionalLabel={t("common.optional")} />
              <Field name="address" label={t("common.address")} defaultValue={school.address} optionalLabel={t("common.optional")} className="sm:col-span-2" />
              <Field name="timezone" label={t("settings.timezone")} type="select" options={tzOptions} defaultValue={school.timezone} required />
              <Field name="defaultLocale" label={t("settings.language")} type="select" options={[{ value: "EN", label: "English" }, { value: "SW", label: "Kiswahili" }]} defaultValue={school.defaultLocale} required />
              <p className="text-sm text-muted sm:col-span-2">{t("settings.currency")}: {school.currency}</p>
            </fieldset>
          </ActionForm>
        </Card>

        <Card title={t("settings.admission")}>
          <ActionForm action={updateAdmissionAction} submitLabel={t("common.save")} hideSubmit={!canEdit}>
            <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2">
              <Field name="prefix" label={t("settings.admission.prefix")} defaultValue={admission.prefix} required />
              <Field name="seqPadding" label={t("settings.admission.padding")} type="number" min={1} max={8} defaultValue={admission.seqPadding} required />
              <Field name="pattern" label={t("settings.admission.pattern")} defaultValue={admission.pattern} hint={t("settings.admission.pattern.hint")} required className="sm:col-span-2" />
              <Field name="resetYearly" type="checkbox" label={t("settings.admission.reset")} defaultValue={admission.resetYearly} className="sm:col-span-2" />
              <p className="text-sm text-muted sm:col-span-2">{t("settings.admission.preview")}: <strong className="text-ink">{preview}</strong></p>
            </fieldset>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
