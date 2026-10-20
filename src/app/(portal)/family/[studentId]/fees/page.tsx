import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, FileDown } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { formatMoney } from "@/lib/finance/money";
import { tDynamic } from "@/lib/i18n";
import { displayDate } from "@/lib/dates";
import { childFees } from "@/server/portal";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";

export const metadata: Metadata = { title: "Fees" };
const TONE = { PAID: "ok", PARTIAL: "warn", UNPAID: "bad", NO_CHARGE: "neutral" } as const;

export default async function ChildFeesPage({ params }: { params: Promise<{ studentId: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  const { studentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(studentId)) notFound();
  let f: Awaited<ReturnType<typeof childFees>>;
  try { f = await childFees(ctx, studentId); } catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
  const money = (c: number) => formatMoney(c, f.currency);
  const d = (iso: string) => displayDate(new Date(`${iso}T00:00:00Z`), ctx.locale);
  return (
    <>
      <Link href={`/family/${studentId}`} className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-800 hover:underline"><ArrowLeft className="size-4" aria-hidden />{f.child.name}</Link>
      <PageHeader title={t("fam.fees")} subtitle={`${f.child.name} · ${f.child.admissionNo}`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("fin.billed")} value={money(f.summary.billed)} />
        <Stat label={t("fin.paid")} value={money(f.summary.paid)} />
        <Stat label={t("fin.outstanding")} value={money(f.summary.outstanding)} />
        <Stat label={t("fin.overdue")} value={money(f.summary.overdue)} />
      </div>
      {f.summary.credit > 0 && <p className="mt-3 rounded-lg border border-line bg-white px-4 py-3 text-sm">{t("fam.fees.credit", { amount: money(f.summary.credit) })}</p>}

      <section className="mt-8"><h2 className="mb-3 text-lg font-semibold">{t("fin.nav.invoices")}</h2>
        {f.invoices.length === 0 ? <EmptyState>{t("fam.fees.noInvoices")}</EmptyState> : (
          <ul className="space-y-3">
            {f.invoices.map((i) => (
              <li key={i.id} className="rounded-2xl border border-line bg-white p-4 shadow-[var(--shadow-card)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{i.number} <span className="font-normal text-muted">· {i.termName ?? t("fin.invoices.oneOff")}</span></p>
                    <p className="text-sm text-muted">{t("fin.pdf.due")} {d(i.dueDate)}</p>
                  </div>
                  <div className="flex items-center gap-2"><Badge tone={TONE[i.balance.state]}>{tDynamic(t, "fin.state", i.balance.state)}</Badge>{i.balance.overdueAmount > 0 && <Badge tone="bad">{t("fin.state.OVERDUE")}</Badge>}</div>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm"><div><dt className="text-muted">{t("fin.total")}</dt><dd className="tabular-nums font-medium">{money(i.balance.total)}</dd></div><div><dt className="text-muted">{t("fin.paid")}</dt><dd className="tabular-nums">{money(i.balance.paid)}</dd></div><div><dt className="text-muted">{t("fin.outstanding")}</dt><dd className="tabular-nums font-semibold">{money(i.balance.outstanding)}</dd></div></dl>
                {i.balance.schedule.length > 1 && <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">{i.balance.schedule.map((s, k) => <li key={k} className="flex justify-between"><span>{t("fin.pdf.due")} {d(s.dueDate)}</span><span className="tabular-nums">{money(s.paid)} / {money(s.amount)}</span></li>)}</ul>}
                <a href={`/api/invoices/${i.id}`} target="_blank" rel="noopener" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-4 text-sm font-semibold hover:bg-canvas"><FileDown className="size-4" aria-hidden />{t("fin.pdf.invoice")}</a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8"><h2 className="mb-3 text-lg font-semibold">{t("fin.nav.payments")}</h2>
        {f.payments.length === 0 ? <EmptyState>{t("fam.fees.noPayments")}</EmptyState> : (
          <ul className="space-y-2">
            {f.payments.map((p) => (
              <li key={p.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-3 ${p.status === "REVERSED" ? "opacity-70" : ""}`}>
                <div className="text-sm"><p className={`font-semibold tabular-nums ${p.status === "REVERSED" ? "line-through" : ""}`}>{money(p.amountCents)}</p><p className="text-muted">{d(p.receivedOn)} · {tDynamic(t, "fin.method", p.method)}{p.reference ? ` · ${p.reference}` : ""}</p></div>
                {p.status === "REVERSED" ? <Badge tone="bad">{t("fin.pay.REVERSED")}</Badge> : p.receiptNumber && <a href={`/api/receipts/${p.id}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm font-semibold hover:bg-canvas"><FileDown className="size-4" aria-hidden />{p.receiptNumber}</a>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {f.paymentInstructions.trim() && <Card title={t("fin.pdf.howToPay")} className="mt-8"><p className="whitespace-pre-line text-sm">{f.paymentInstructions}</p></Card>}
    </>
  );
}
