import { randomUUID } from "node:crypto";
import Link from "next/link";
import type { Metadata } from "next";
import { AppError } from "@/lib/errors";
import { hasAny } from "@/lib/auth/next";
import { tDynamic } from "@/lib/i18n";
import { db } from "@/lib/db";
import { loadStudentFinance } from "@/server/balances";
import { findStudentsForFinance } from "@/server/payments";
import { Card, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { FinanceNav } from "@/components/finance/subnav";
import { financePage } from "../../_lib";
import { recordPaymentAction } from "../../actions";

export const metadata: Metadata = { title: "Record payment" };

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<{ q?: string; studentId?: string }> }) {
  const { ctx, t, money, unmatched, timezone } = await financePage();
  if (!hasAny(ctx, ["payment.record"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  const student = sp.studentId && /^[0-9a-f-]{36}$/i.test(sp.studentId) ? await db.student.findFirst({ where: { id: sp.studentId, schoolId: ctx.schoolId }, select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true } }) : null;
  const matches = !student && sp.q ? await findStudentsForFinance(ctx, sp.q).catch((e) => { if (e instanceof AppError) return []; throw e; }) : [];
  const fin = student ? await loadStudentFinance(db, ctx.schoolId, student.id) : null;
  const open = fin ? [...fin.ledger.invoices.values()].filter((b) => b.outstanding > 0).map((b) => ({ value: b.id, label: `${fin.invoices.find((i) => i.id === b.id)!.number} · ${money(b.outstanding)}` })) : [];
  const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  return (
    <>
      <PageHeader title={t("fin.payments.record")} subtitle={t("fin.payments.recordHint")} actions={<Link href="/finance/payments" className="text-sm font-medium text-link hover:underline">{t("fin.nav.payments")}</Link>} />
      <FinanceNav ctx={ctx} t={t} current="/finance/payments" unmatched={unmatched} />
      {!student ? (
        <div className="max-w-xl space-y-4">
          <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-3">
            <Field name="q" label={t("fin.payments.findStudent")} defaultValue={sp.q} placeholder={t("fin.payments.findHint")} className="min-w-56 flex-1" required />
            <button className="min-h-11 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800 btn-primary">{t("common.search")}</button>
          </form>
          {sp.q && matches.length === 0 && <EmptyState>{t("common.noResults")}</EmptyState>}
          <ul className="space-y-2">
            {matches.map((s) => (
              <li key={s.id}><Link href={`/finance/payments/new?studentId=${s.id}`} className="flex min-h-14 items-center justify-between rounded-xl border border-line bg-surface px-4 hover:border-brand-400"><span className="font-medium">{[s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ")}</span><span className="text-sm text-muted">{s.admissionNo} · {tDynamic(t, "student.status", s.status)}</span></Link></li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <Card title={[student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ")}>
            <ActionForm action={recordPaymentAction} submitLabel={t("fin.payments.save")}>
              <input type="hidden" name="studentId" value={student.id} />
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <Field name="amount" label={t("fin.pdf.amount")} required hint={t("fin.amountHint")} />
              <Field name="method" type="select" label={t("fin.pdf.method")} options={(["CASH", "BANK", "MOBILE_MONEY", "OTHER"] as const).map((m) => ({ value: m, label: tDynamic(t, "fin.method", m) }))} defaultValue="CASH" required />
              <Field name="reference" label={t("fin.pdf.reference")} optionalLabel={t("fin.referenceOptional")} hint={t("fin.referenceHint")} />
              <Field name="receivedOn" type="date" label={t("fin.pdf.date")} defaultValue={today} max={undefined} required />
              <Field name="payerName" label={t("fin.pdf.receivedFrom")} optionalLabel={t("common.optional")} />
              {open.length > 0 && <Field name="targetInvoiceId" type="select" label={t("fin.payments.aimAt")} options={open} placeholder={t("fin.payments.oldestFirst")} hint={t("fin.payments.aimHint")} />}
              <Field name="notes" label={t("common.notes")} optionalLabel={t("common.optional")} />
            </ActionForm>
          </Card>
          <Card title={t("fin.student.balance")} className="h-fit">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted">{t("fin.outstanding")}</dt><dd className="font-semibold tabular-nums">{money(fin!.ledger.outstanding)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">{t("fin.overdue")}</dt><dd className="tabular-nums">{money(fin!.ledger.overdue)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">{t("fin.credit")}</dt><dd className="tabular-nums">{money(fin!.ledger.credit)}</dd></div>
            </dl>
            <Link href={`/finance/students/${student.id}`} className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-link hover:underline">{t("fin.student.statement")}</Link>
          </Card>
        </div>
      )}
    </>
  );
}
