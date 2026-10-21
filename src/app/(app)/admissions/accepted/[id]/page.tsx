import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDate } from "@/lib/dates";
import { formatMoney } from "@/lib/finance/money";
import { acceptedDetail, registeredSummary, type AcceptedDetail } from "@/server/admission-stages";
import { AdmissionsNav } from "@/components/admissions/subnav";
import { ActionForm, Field } from "@/components/form";
import { Badge, Card, DefList, EmptyState, LinkButton, NoAccess, PageHeader } from "@/components/ui";
import { enrolApplicationAction } from "../../actions";
import { ConfirmBoxes } from "../../[id]/parts";

export const metadata: Metadata = { title: "Admission and payment" };
const PAY_TONE = { VERIFIED: "ok", PENDING: "warn", REJECTED: "bad", REVERSED: "bad" } as const;

/**
 * The admission and payment view of an accepted applicant: the decision, the school fee and what Finance has verified, and what still has to
 * be true before registration. Registering shows what the family wrote on the application form (nothing is typed again, and anything can be
 * corrected first) and the class they applied for; the student gets the permanent Student ID at that moment. Once registered, this address
 * shows the Student ID and class instead of going missing.
 */
export default async function AcceptedPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("admission.read")) return <NoAccess t={t} />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let d: AcceptedDetail;
  try {
    d = await acceptedDetail(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") {
      // Registered already: show the result, never a missing page.
      const done = await registeredSummary(ctx, id);
      if (!done) notFound();
      return (
        <>
          <PageHeader title={done.name} subtitle={`${done.applicationNo} · ${t("adm.reg.registered")}`} actions={<LinkButton href={`/admissions/${id}`} variant="secondary">{t("adm.iw.details")}</LinkButton>} />
          <AdmissionsNav ctx={ctx} t={t} current="/admissions/registration" />
          <Card title={t("adm.reg.registered")}>
            <DefList items={[{ label: t("adm.reg.studentId"), value: done.admissionNo }, { label: t("adm.reg.inClass"), value: done.className ?? t("adm.reg.noClassYet") }]} />
            <p className="mt-4 text-sm"><Link href={`/students/${done.studentId}`} className="font-medium text-link hover:underline">{t("adm.reg.openStudent")}</Link>{!done.className && <> · <Link href="/admissions/placement" className="font-medium text-link hover:underline">{t("adm.nav.placement")}</Link></>}</p>
          </Card>
        </>
      );
    }
    if (e instanceof AppError) return <EmptyState>{e.message}</EmptyState>;
    throw e;
  }
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  const app = d.application;
  const ready = d.remaining.length === 0;
  const emergency = app.emergencyContact as { name?: string; phone?: string; relationship?: string } | null;
  const pl = d.placement;
  return (
    <>
      <PageHeader title={d.name} subtitle={`${d.applicationNo} · ${t(d.after === "payment" ? "adm.awaiting.title" : "adm.reg.title")}`} actions={<LinkButton href={`/admissions/${id}`} variant="secondary">{t("adm.iw.details")}</LinkButton>} />
      <AdmissionsNav ctx={ctx} t={t} current={d.after === "payment" ? "/admissions/payment" : "/admissions/registration"} />
      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <Card title={t("adm.acc.registerChecks")}>
            <ul className="space-y-2 text-sm">
              {d.items.map((i) => (
                <li key={i.key} className="flex items-start gap-2">
                  {i.ok ? <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden /> : <X className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />}
                  <span className={i.ok ? "" : "font-medium"}>{i.message}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title={t("adm.reg.confirmTitle")} actions={can("admission.create") ? <LinkButton href={`/admissions/${id}/edit`} variant="secondary">{t("adm.reg.edit")}</LinkButton> : undefined}>
            <p className="mb-4 text-sm text-muted">{t("adm.reg.confirmSub")}</p>
            <DefList items={[
              { label: t("adm.applicant"), value: [app.firstName, app.middleName, app.lastName].filter(Boolean).join(" ") },
              { label: t("student.dob"), value: displayDate(app.dateOfBirth, ctx.locale) },
              { label: t("student.gender"), value: app.gender === "MALE" ? t("student.male") : t("student.female") },
              { label: t("adm.classApplied"), value: app.className },
              { label: t("student.nationality"), value: app.nationality },
              { label: t("student.religion"), value: app.religion },
              { label: t("student.birthCert"), value: app.birthCertificateNo },
              { label: t("student.previousSchool"), value: app.previousSchool },
              { label: t("common.address"), value: app.address },
              { label: t("adm.emergency"), value: emergency?.name ? `${emergency.name} (${emergency.relationship ?? ""}) ${emergency.phone ?? ""}` : null },
            ]} />
            <h3 className="mb-1 mt-5 text-xs uppercase tracking-wide text-muted">{t("adm.guardians")}</h3>
            <ul className="divide-y divide-line text-sm">
              {app.guardians.map((g, i) => (
                <li key={i} className="py-2">
                  <p className="font-medium">{g.fullName ?? "—"}{g.relationship && <span className="font-normal text-muted"> · {t(`student.rel.${g.relationship as "FATHER"}`)}</span>}</p>
                  <p className="text-muted">{[g.phone, g.email].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
            </ul>

            {can("admission.enrol") && (
              ready ? (
                <ActionForm action={enrolApplicationAction} submitLabel={t("adm.reg.go")} className="mt-5 space-y-3 border-t border-line pt-4">
                  <input type="hidden" name="id" value={id} />
                  {pl.appliedFull && <p role="status" className="rounded-lg border border-warn/40 bg-amber-50 px-3 py-2 text-sm text-warn">{t("adm.reg.full", { class: pl.appliedClass ?? "", n: String(pl.appliedFull.count), cap: String(pl.appliedFull.capacity) })}</p>}
                  {can("student.enroll") && <Field name="placement" type="select" label={t("adm.reg.classLabel")} hint={t("adm.reg.classHint")} options={pl.options.map((o) => ({ value: o.value, label: o.label }))} defaultValue={pl.preferred} placeholder={t("adm.reg.classLater")} />}
                  {can("class.capacity_override") && <><Field name="overrideCapacity" type="checkbox" label={t("adm.enrol.override")} /><Field name="overrideReason" label={t("adm.enrol.overrideReason")} optionalLabel={t("common.optional")} /></>}
                  <ConfirmBoxes duplicate={t("student.confirmDuplicate")} sharedPhone={t("adm.confirmSharedPhone")} />
                </ActionForm>
              ) : <p className="mt-5 border-t border-line pt-4 text-sm text-muted">{t("adm.reg.blocked")}</p>
            )}
          </Card>

          <Card title={t("adm.acc.payment")} actions={d.accountStatus ? <Badge tone={d.accountStatus === "PAID" || d.accountStatus === "NOT_REQUIRED" || d.accountStatus === "WAIVED" ? "ok" : "warn"}>{t(`adm.pay.status.${d.accountStatus}` as "adm.pay.status.PAID")}</Badge> : undefined}>
            <DefList items={[
              { label: t("adm.acc.fee"), value: formatMoney(d.feeCents) },
              { label: t("adm.acc.verified"), value: formatMoney(d.verifiedCents) },
              { label: t("adm.acc.outstanding"), value: formatMoney(d.balanceCents) },
              { label: t("adm.acc.reference"), value: d.reference },
            ]} />
            {d.instructions && <div className="mt-4"><h3 className="text-xs uppercase tracking-wide text-muted">{t("adm.acc.howToPay")}</h3><p className="mt-1 whitespace-pre-line text-sm">{d.instructions}</p></div>}
            {d.payments.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead className="border-b border-line text-xs uppercase tracking-wide text-muted"><tr><th className="py-2 pr-3 font-medium">{t("adm.pay.paidOn")}</th><th className="py-2 pr-3 font-medium">{t("adm.pay.amount")}</th><th className="py-2 pr-3 font-medium">{t("common.status")}</th><th className="py-2 font-medium">{t("adm.pay.receipt")}</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {d.payments.map((p) => (
                      <tr key={p.id}><td className="py-2 pr-3">{displayDate(p.paidOn, ctx.locale)}</td><td className="py-2 pr-3 tabular-nums">{formatMoney(p.amountCents)}</td><td className="py-2 pr-3"><Badge tone={PAY_TONE[p.status as keyof typeof PAY_TONE] ?? "neutral"}>{t(`adm.pay.row.${p.status}` as "adm.pay.row.VERIFIED")}</Badge></td><td className="py-2 tabular-nums">{p.receiptNo ?? "—"}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-4 text-sm text-muted">{t("adm.acc.financeOwns")}{(can("admission.payment.record") || can("admission.payment.verify")) && <> <Link href="/finance/admissions" className="font-medium text-link hover:underline">{t("adm.acc.financeLink")}</Link></>}</p>
          </Card>
        </div>
        <Card title={t("adm.acc.decision")}>
          <DefList items={[
            { label: t("adm.acc.decided"), value: d.decidedAt ? displayDate(d.decidedAt, ctx.locale) : null },
            { label: t("adm.acc.grade"), value: d.classOffered ?? d.className },
            { label: t("adm.acc.offerNo"), value: d.letterNo },
            { label: t("adm.col.complete"), value: `${d.percent}%` },
            { label: t("adm.acc.papers"), value: d.docsRequired ? `${d.docsVerified}/${d.docsRequired}` : null },
          ]} />
        </Card>
      </div>
    </>
  );
}
