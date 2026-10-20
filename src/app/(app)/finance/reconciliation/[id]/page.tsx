import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { hasAny } from "@/lib/auth/next";
import { db } from "@/lib/db";
import { displayDateTime } from "@/lib/dates";
import { centsOf } from "@/lib/finance/money";
import { loadStudentFinance } from "@/server/balances";
import { findStudentsForFinance } from "@/server/payments";
import { Badge, Card, DefList, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { FinanceNav } from "@/components/finance/subnav";
import { financePage } from "../../_lib";
import { assignEventAction, rejectEventAction } from "../../actions";

export const metadata: Metadata = { title: "Match payment" };

export default async function ReconcileEventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; studentId?: string }> }) {
  const { ctx, t, money, timezone, unmatched } = await financePage();
  if (!hasAny(ctx, ["finance.reconcile"])) return <NoAccess t={t} />;
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ev = await db.paymentEvent.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!ev) notFound();
  const amount = ev.amount === null ? null : centsOf(ev.amount);
  const open = ev.status === "UNMATCHED" && ev.providerStatus === "SUCCESS";
  const student = open && sp.studentId && /^[0-9a-f-]{36}$/i.test(sp.studentId) ? await db.student.findFirst({ where: { id: sp.studentId, schoolId: ctx.schoolId }, select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true } }) : null;
  const matches = open && !student && (sp.q ?? ev.reference) ? await findStudentsForFinance(ctx, sp.q ?? ev.reference ?? "") : [];
  const fin = student ? await loadStudentFinance(db, ctx.schoolId, student.id) : null;
  const invoices = fin ? [...fin.ledger.invoices.values()].filter((b) => b.outstanding > 0).map((b) => ({ value: b.id, label: `${fin.invoices.find((i) => i.id === b.id)!.number} · ${money(b.outstanding)}` })) : [];
  return (
    <>
      <PageHeader title={t("fin.recon.matchTitle")} subtitle={`${ev.provider} · ${ev.providerEventId}`} actions={<Link href="/finance/reconciliation" className="text-sm font-medium text-brand-800 hover:underline">{t("fin.nav.reconciliation")}</Link>} />
      <FinanceNav ctx={ctx} t={t} current="/finance/reconciliation" unmatched={unmatched} />
      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card title={t("fin.recon.notification")} className="h-fit">
          <DefList items={[
            { label: t("fin.pdf.amount"), value: amount === null ? "—" : <strong className="text-lg tabular-nums">{money(amount)}</strong> },
            { label: t("fin.recon.reported"), value: ev.providerStatus },
            { label: t("fin.pdf.reference"), value: ev.reference },
            { label: t("fin.recon.payer"), value: ev.msisdn },
            { label: t("fin.pdf.date"), value: displayDateTime(ev.receivedAt, timezone) },
            { label: t("fin.recon.why"), value: ev.note },
            { label: t("marks.status"), value: <Badge tone={ev.status === "POSTED" ? "ok" : ev.status === "UNMATCHED" ? "warn" : "neutral"}>{t(`fin.event.${ev.status}` as never)}</Badge> },
          ]} />
        </Card>
        {!open ? (
          <EmptyState>{ev.status === "UNMATCHED" ? t("fin.recon.cannotMatch") : t("fin.recon.handled")}</EmptyState>
        ) : (
          <div className="space-y-6">
            {!student ? (
              <Card title={t("fin.payments.findStudent")}>
                <form method="get" className="flex flex-wrap items-end gap-3">
                  <Field name="q" label={t("fin.payments.findStudent")} defaultValue={sp.q ?? ev.reference ?? ""} className="min-w-56 flex-1" required />
                  <button className="min-h-11 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800">{t("common.search")}</button>
                </form>
                <ul className="mt-4 space-y-2">
                  {matches.map((s) => <li key={s.id}><Link href={`/finance/reconciliation/${ev.id}?studentId=${s.id}`} className="flex min-h-14 items-center justify-between rounded-xl border border-line px-4 hover:border-brand-400"><span className="font-medium">{[s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ")}</span><span className="text-sm text-muted">{s.admissionNo}</span></Link></li>)}
                  {matches.length === 0 && <li className="text-sm text-muted">{t("common.noResults")}</li>}
                </ul>
              </Card>
            ) : (
              <Card title={`${t("fin.recon.assign")}: ${[student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ")}`}>
                <p className="mb-3 text-sm text-muted">{t("fin.recon.willRecord", { amount: money(amount ?? 0), admission: student.admissionNo })}</p>
                <ActionForm action={assignEventAction} submitLabel={t("fin.recon.assign")} confirm={t("fin.recon.assignConfirm", { amount: money(amount ?? 0) })}>
                  <input type="hidden" name="eventId" value={ev.id} />
                  <input type="hidden" name="studentId" value={student.id} />
                  {invoices.length > 0 && <Field name="targetInvoiceId" type="select" label={t("fin.payments.aimAt")} options={invoices} placeholder={t("fin.payments.oldestFirst")} />}
                </ActionForm>
                <Link href={`/finance/reconciliation/${ev.id}`} className="mt-3 inline-flex min-h-11 items-center text-sm text-muted hover:text-ink">{t("fin.recon.otherStudent")}</Link>
              </Card>
            )}
            <Card title={t("fin.recon.rejectTitle")}>
              <ActionForm action={rejectEventAction} submitLabel={t("fin.refunds.reject")} tone="danger" confirm={t("fin.recon.rejectConfirm")}>
                <input type="hidden" name="eventId" value={ev.id} />
                <Field name="reason" type="textarea" rows={2} label={t("marks.reason")} required hint={t("fin.recon.rejectHint")} />
              </ActionForm>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
