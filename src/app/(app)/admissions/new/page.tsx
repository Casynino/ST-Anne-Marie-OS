import type { Metadata } from "next";
import { requireContext, getLocale, getT } from "@/lib/auth/next";
import { formatMoney } from "@/lib/finance/money";
import { db } from "@/lib/db";
import { getAdmissionPolicy } from "@/server/admission-policy";
import { applicationFeeInfo } from "@/server/application-fee";
import { listApplyClasses } from "@/server/public-applications";
import { RELATIONSHIPS } from "@/server/guardians";
import { ActionForm, Field, FileField } from "@/components/form";
import { ApplicationFields } from "@/components/site/application-fields";
import { EntryTypeProvider, WhenTransfer } from "@/components/site/entry-type";
import { NoAccess, PageHeader } from "@/components/ui";
import { AdmissionsNav } from "@/components/admissions/subnav";
import { createOfficeApplicationAction } from "../actions";
import { displayDateTime } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { openWindows } from "@/server/interview-days";

export const metadata: Metadata = { title: "New application" };

/**
 * An application filled in at the office is the same form as the online one (same questions, same checks, same application fee). The photo and
 * papers can be added now or later. With an application fee the form is printed for the family, who pay and come back with the receipt.
 */
export default async function NewApplicationPage() {
  const ctx = await requireContext();
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  if (!ctx.permissions.has("admission.create")) return <NoAccess t={t} />;
  const [classes, policy, fee, windows, school] = await Promise.all([listApplyClasses(ctx.schoolId, locale), getAdmissionPolicy(db, ctx.schoolId), applicationFeeInfo(ctx.schoolId), openWindows(ctx.schoolId), getSchoolBasics(ctx.schoolId)]);
  const classOptions = classes.map((c) => ({ value: c.id, label: `${c.level} — ${c.name}` }));
  const relOptions = RELATIONSHIPS.map((r) => ({ value: r, label: t(`student.rel.${r}` as "student.rel.FATHER") }));
  const paper = (d: string) => <FileField key={d} name={`paper_${d}`} label={t(`doc.type.${d}` as "doc.type.OTHER")} accept="application/pdf,image/jpeg,image/png,image/webp" optionalLabel={t("common.optional")} hint={t("apf.papers.hint")} />;
  return (
    <>
      <PageHeader title={t("adm.new")} subtitle={t("adm.new.office")} />
      <AdmissionsNav ctx={ctx} t={t} current="/admissions/new" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem] xl:items-start">
      <aside className="space-y-4 xl:sticky xl:top-20 xl:order-2">
        {windows.length > 0 && (
          <div className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
            <p className="font-semibold">{t("adm.win.public.title")}</p>
            <ul className="mt-1 space-y-0.5 text-muted">
              {windows.map((w) => <li key={w.id}><span className="font-medium text-ink">{w.name}</span>{w.classNames.length ? ` (${w.classNames.join(", ")})` : ""}: {t("adm.win.public.interview", { when: `${displayDateTime(w.startsAt, school.timezone, ctx.locale)}${w.venue ? `, ${w.venue}` : ""}` })}{w.full ? ` · ${t("adm.win.public.full")}` : ""}</li>)}
            </ul>
          </div>
        )}
        {fee.feeCents > 0 && <p className="rounded-lg border border-tint-2 bg-tint px-4 py-3 text-sm font-medium text-link">{t("adm.new.fee", { amount: formatMoney(fee.feeCents, fee.currency) })}</p>}
        <div className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
          <p className="font-semibold">{t("adm.new.side.steps")}</p>
          <ol className="mt-2 space-y-2 text-muted">
            {[1, 2, 3, 4].map((n) => <li key={n} className="flex gap-2.5"><span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md bg-brand-600/15 text-[11px] font-bold text-link">{n}</span><span>{t(`adm.new.step.${n}` as "adm.new.step.1")}</span></li>)}
          </ol>
        </div>
        {policy.requiredDocTypes.filter((d) => d !== "PASSPORT_PHOTO").length > 0 && (
          <div className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
            <p className="font-semibold">{t("adm.new.side.docs")}</p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-muted">{policy.requiredDocTypes.filter((d) => d !== "PASSPORT_PHOTO").map((d) => <li key={d}>{t(`doc.type.${d}` as "doc.type.OTHER")}</li>)}</ul>
            <p className="mt-2 text-xs text-muted">{t("adm.new.side.docsHint")}</p>
          </div>
        )}
      </aside>
      <div className="xl:order-1">
        <ActionForm action={createOfficeApplicationAction} submitLabel={fee.feeCents > 0 ? t("adm.new.saveFee") : t("adm.new.submit")} className="space-y-6">
          <EntryTypeProvider defaultKind="NEW">
            <ApplicationFields t={t} classOptions={classOptions} relOptions={relOptions} emailRequired={false} variant="portal" />
            <fieldset className="space-y-4 rounded-2xl border border-line bg-surface p-5">
              <legend className="px-2 text-base font-semibold">{t("apf.files.title")}</legend>
              <p className="text-sm text-muted">{t("adm.new.files.body")}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <FileField name="photo" label={t("apf.photo.title")} accept="image/jpeg,image/png,image/webp" optionalLabel={t("common.optional")} hint={t("apf.photo.hint")} />
                {policy.requiredDocTypes.filter((d) => d !== "PASSPORT_PHOTO").map(paper)}
                <WhenTransfer>{policy.transferDocTypes.filter((d) => d !== "PASSPORT_PHOTO" && !policy.requiredDocTypes.includes(d)).map(paper)}</WhenTransfer>
                <FileField name="paper_OTHER" label={t("apf.papers.other")} accept="application/pdf,image/jpeg,image/png,image/webp" optionalLabel={t("common.optional")} hint={t("apf.papers.hint")} />
              </div>
            </fieldset>
          </EntryTypeProvider>
          <div className="space-y-2 rounded-2xl border border-line bg-surface p-5">
            <Field name="consent" type="checkbox" label={t("apply.consent")} required />
            <p className="text-xs text-muted">{t("apply.privacy")}</p>
          </div>
        </ActionForm>
      </div>
      </div>
    </>
  );
}
