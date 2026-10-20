import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { hasAny } from "@/lib/auth/next";
import { tDynamic } from "@/lib/i18n";
import { listExamTerms } from "@/server/exams";
import { financeOverview } from "@/server/finance-reports";
import { Badge, Card, EmptyState, FilterBar, NoAccess, PageHeader, Stat } from "@/components/ui";
import { Field } from "@/components/form";
import { FinanceNav } from "@/components/finance/subnav";
import { financePage } from "./_lib";

export const metadata: Metadata = { title: "Finance" };

export default async function FinanceOverviewPage({ searchParams }: { searchParams: Promise<{ termId?: string }> }) {
  const { ctx, t, money, unmatched } = await financePage();
  if (!hasAny(ctx, ["finance.reports", "fees.read", "expense.read", "finance.reconcile"])) return <NoAccess t={t} />;
  if (!hasAny(ctx, ["finance.reports"])) redirect(hasAny(ctx, ["fees.read"]) ? "/finance/invoices" : hasAny(ctx, ["expense.read"]) ? "/finance/expenses" : "/finance/reconciliation");
  const sp = await searchParams;
  const terms = await listExamTerms(ctx).catch(() => []);
  const o = await financeOverview(ctx, { termId: sp.termId && terms.some((x) => x.id === sp.termId) ? sp.termId : undefined });
  return (
    <>
      <PageHeader title={t("fin.title")} subtitle={t("fin.subtitle")} />
      <FinanceNav ctx={ctx} t={t} current="/finance" unmatched={unmatched} />
      <FilterBar t={t} resetHref="/finance">
        <Field name="termId" type="select" label={t("exam.term")} options={terms.map((x) => ({ value: x.id, label: `${x.academicYear.name} · ${x.name}` }))} defaultValue={o?.term.id ?? ""} />
      </FilterBar>
      {unmatched > 0 && <Link href="/finance/reconciliation" className="mb-4 flex min-h-12 items-center justify-between rounded-xl border border-warn/30 bg-amber-50 px-4 text-sm font-medium text-warn">{t("fin.overview.unmatched", { count: unmatched })}<span aria-hidden>→</span></Link>}
      {!o ? (
        <EmptyState>{t("exam.noTerms")}</EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t("fin.billed")} value={money(o.billed)} hint={t("fin.overview.invoices", { count: o.invoices.total })} />
            <Stat label={t("fin.collected")} value={money(o.collected)} hint={t("fin.overview.payments", { count: o.payments })} />
            <Stat label={t("fin.outstanding")} value={money(o.outstanding)} hint={o.collectionRatePct === null ? undefined : t("fin.overview.rate", { pct: o.collectionRatePct })} />
            <Stat label={t("fin.overdue")} value={money(o.overdue)} />
            <Stat label={t("fin.credit")} value={money(o.credit)} hint={t("fin.overview.creditHint")} />
            <Stat label={t("fin.expenses")} value={money(o.expenses)} />
            <Stat label={t("fin.refundsPaid")} value={money(o.refundsPaid)} />
            <Stat label={t("fin.net")} value={money(o.net)} hint={t("fin.overview.netHint")} />
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card title={t("fin.overview.status")}>
              <ul className="space-y-2 text-sm">
                {([["PAID", o.invoices.paid], ["PARTIAL", o.invoices.partial], ["UNPAID", o.invoices.unpaid], ["NO_CHARGE", o.invoices.noCharge]] as const).map(([k, v]) => (
                  <li key={k} className="flex items-center justify-between"><Badge tone={k === "PAID" ? "ok" : k === "PARTIAL" ? "warn" : k === "UNPAID" ? "bad" : "neutral"}>{tDynamic(t, "fin.state", k)}</Badge><span className="tabular-nums">{v}</span></li>
                ))}
              </ul>
            </Card>
            <Card title={t("fin.overview.byMethod")}>
              {o.byMethod.length === 0 ? <p className="text-sm text-muted">{t("fin.overview.noPayments")}</p> : (
                <ul className="space-y-2 text-sm">{o.byMethod.map((m) => <li key={m.method} className="flex items-center justify-between"><span>{tDynamic(t, "fin.method", m.method)}</span><span className="tabular-nums font-medium">{money(m.cents)}</span></li>)}</ul>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
