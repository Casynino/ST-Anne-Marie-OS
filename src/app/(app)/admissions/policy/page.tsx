import type { Metadata } from "next";
import { paymentSetup } from "@/server/application-fee";
import { requireContext, getT } from "@/lib/auth/next";
import { db } from "@/lib/db";
import { getAdmissionPolicy } from "@/server/admission-policy";
import { DOCUMENT_TYPES } from "@/server/documents";
import { getSchoolBasics } from "@/server/settings";
import { AdmissionsNav } from "@/components/admissions/subnav";
import { ActionForm, Field } from "@/components/form";
import { Card, NoAccess, PageHeader } from "@/components/ui";
import { updatePolicyAction } from "../actions";

export const metadata: Metadata = { title: "Admission rules and fees" };

export default async function PolicyPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("school.settings.read")) return <NoAccess t={t} />;
  const [p, school, setup, levels] = await Promise.all([getAdmissionPolicy(db, ctx.schoolId), getSchoolBasics(ctx.schoolId), paymentSetup(ctx.schoolId), db.academicLevel.findMany({ where: { schoolId: ctx.schoolId }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } })]);
  const edit = ctx.permissions.has("school.settings.update");
  return (
    <>
      <PageHeader title={t("adm.policy.title")} subtitle={t("adm.policy.sub")} />
      <AdmissionsNav ctx={ctx} t={t} current="/admissions/policy" />
      <Card>
        {p.admissionFeeCents === 0 && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-warn">{t("adm.policy.noFeeWarn")}</p>}
        <ActionForm action={updatePolicyAction} submitLabel={edit ? t("common.save") : undefined} hideSubmit={!edit} className="max-w-2xl space-y-5">
          <Field name="requireInterview" type="checkbox" label={t("adm.policy.requireInterview")} defaultValue={p.requireInterview} />
          {levels.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("adm.policy.assessment")}</legend>
              <p className="text-sm text-muted">{t("adm.policy.assessment.hint")}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {levels.map((l) => <Field key={l.id} name={`assessment_${l.id}`} type="select" label={l.name} defaultValue={p.assessmentByLevel[l.id] ?? ""} placeholder={t("adm.policy.assessment.default")} options={(["NONE", "INTERVIEW", "EXAM", "BOTH"] as const).map((r) => ({ value: r, label: t(`adm.policy.assessment.${r}` as "adm.policy.assessment.NONE") }))} />)}
              </div>
            </fieldset>
          )}
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t("adm.policy.requiredDocs")}</legend>
            <p className="mb-1 text-sm text-muted">{t("adm.policy.requiredDocs.hint")}</p>
            <div className="grid gap-1 sm:grid-cols-2">
              {DOCUMENT_TYPES.map((d) => (
                <label key={d} className="flex min-h-11 cursor-pointer items-center gap-3 text-base">
                  <input type="checkbox" name="requiredDocTypes" value={d} defaultChecked={p.requiredDocTypes.includes(d)} className="size-5 rounded border-line accent-brand-700" />
                  {t(`doc.type.${d}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t("adm.policy.transferDocs")}</legend>
            <p className="mb-1 text-sm text-muted">{t("adm.policy.transferDocs.hint")}</p>
            <div className="grid gap-1 sm:grid-cols-2">
              {DOCUMENT_TYPES.map((d) => (
                <label key={d} className="flex min-h-11 cursor-pointer items-center gap-3 text-base">
                  <input type="checkbox" name="transferDocTypes" value={d} defaultChecked={p.transferDocTypes.includes(d)} className="size-5 rounded border-line accent-brand-700" />
                  {t(`doc.type.${d}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <Field name="applicationFee" label={`${t("adm.policy.appFee")} (${school.currency})`} defaultValue={p.applicationFeeCents / 100} hint={t("adm.policy.appFee.hint")} />
          {p.applicationFeeCents > 0 && !setup.ready && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-warn">{t("adm.policy.appFee.notReady")}</p>}
          {setup.sandbox && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-warn">{t("adm.policy.appFee.sandbox")}</p>}
          <Field name="applicationPhotoRequired" type="checkbox" label={t("adm.policy.photo")} defaultValue={p.applicationPhotoRequired} />
          <Field name="admissionFee" label={`${t("adm.policy.fee")} (${school.currency})`} defaultValue={p.admissionFeeCents / 100} hint={t("adm.policy.fee.hint")} />
          <Field name="requirePaymentBeforeEnrol" type="checkbox" label={t("adm.policy.requirePayment")} defaultValue={p.requirePaymentBeforeEnrol} />
          <Field name="paymentNeedsSecondPerson" type="checkbox" label={t("adm.policy.second")} defaultValue={p.paymentNeedsSecondPerson} />
          <Field name="offerValidDays" type="number" label={t("adm.policy.offerDays")} defaultValue={p.offerValidDays} min={0} max={365} hint={t("adm.policy.offerDays.hint")} />
          <Field name="offerNeedsApproval" type="checkbox" label={t("adm.policy.approval")} defaultValue={p.offerNeedsApproval} />
          <Field name="interviewMinutes" type="number" label={t("adm.policy.minutes")} defaultValue={p.interviewMinutes} min={5} max={480} />
          <div>
            <Field name="allowDirectRegistration" type="checkbox" label={t("adm.policy.direct")} defaultValue={p.allowDirectRegistration} />
            <p className="text-sm text-muted">{t("adm.policy.direct.hint")}</p>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
