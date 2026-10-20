import Link from "next/link";
import type { Metadata } from "next";
import { hasAny } from "@/lib/auth/next";
import { tDynamic } from "@/lib/i18n";
import { listPayments } from "@/server/payments";
import { displayDate } from "@/lib/dates";
import { Badge, DataTable, EmptyState, FilterBar, NoAccess, PageHeader, Pagination, Td } from "@/components/ui";
import { Field } from "@/components/form";
import { FinanceNav } from "@/components/finance/subnav";
import { ExportMenu } from "@/components/export-menu";
import { financePage } from "../_lib";

export const metadata: Metadata = { title: "Payments" };
type Search = { from?: string; to?: string; method?: string; status?: string; q?: string; page?: string };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { ctx, t, money, unmatched } = await financePage();
  if (!hasAny(ctx, ["fees.read"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  const method = (["CASH", "BANK", "MOBILE_MONEY", "OTHER"] as const).find((m) => m === sp.method);
  const status = (["POSTED", "REVERSED"] as const).find((m) => m === sp.status);
  const clean = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const data = await listPayments(ctx, { from: clean(sp.from), to: clean(sp.to), method, status, q: sp.q, page: Number(sp.page) || 1 });
  const q = new URLSearchParams(Object.entries({ from: clean(sp.from) ?? "", to: clean(sp.to) ?? "" }).filter(([, v]) => v));
  return (
    <>
      <PageHeader
        title={t("fin.payments.title")}
        subtitle={t("fin.payments.subtitle")}
        actions={<>{hasAny(ctx, ["finance.reports"]) && <ExportMenu base={`/api/finance/export?type=payments&${q}`} t={t} />}{hasAny(ctx, ["payment.record"]) && <Link href="/finance/payments/new" className="inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800">{t("fin.payments.record")}</Link>}</>}
      />
      <FinanceNav ctx={ctx} t={t} current="/finance/payments" unmatched={unmatched} />
      <FilterBar t={t} resetHref="/finance/payments">
        <Field name="from" type="date" label={t("fin.from")} defaultValue={clean(sp.from)} />
        <Field name="to" type="date" label={t("fin.to")} defaultValue={clean(sp.to)} />
        <Field name="method" type="select" label={t("fin.pdf.method")} options={(["CASH", "BANK", "MOBILE_MONEY", "OTHER"] as const).map((m) => ({ value: m, label: tDynamic(t, "fin.method", m) }))} defaultValue={method ?? ""} placeholder={t("common.all")} />
        <Field name="status" type="select" label={t("marks.status")} options={[{ value: "POSTED", label: t("fin.pay.POSTED") }, { value: "REVERSED", label: t("fin.pay.REVERSED") }]} defaultValue={status ?? ""} placeholder={t("common.all")} />
        <Field name="q" label={t("common.search")} defaultValue={sp.q} placeholder={t("fin.payments.search")} className="min-w-48 flex-1" />
      </FilterBar>
      <p className="mb-3 text-sm text-muted">{t("fin.payments.total", { amount: money(data.postedTotalCents), count: data.total })}</p>
      {data.items.length === 0 ? <EmptyState>{t("fin.payments.empty")}</EmptyState> : (
        <DataTable head={[t("fin.pdf.date"), t("fin.pdf.receiptNo"), t("marks.student"), t("fin.pdf.method"), t("fin.pdf.reference"), t("fin.pdf.amount"), t("marks.status")]}>
          {data.items.map((p) => (
            <tr key={p.id} className={p.status === "REVERSED" ? "text-muted" : undefined}>
              <Td className="whitespace-nowrap">{displayDate(p.receivedOn, ctx.locale)}</Td>
              <Td><Link href={`/finance/payments/${p.id}`} className="font-medium text-link hover:underline">{p.receipt?.number ?? "—"}</Link></Td>
              <Td><Link href={`/finance/students/${p.studentId}`} className="hover:underline">{p.studentName}</Link><p className="text-xs text-muted">{p.admissionNo}</p></Td>
              <Td>{tDynamic(t, "fin.method", p.method)}{p.source === "PROVIDER" && <p className="text-xs text-muted">{p.provider}</p>}</Td>
              <Td className="text-xs">{p.reference ?? "—"}</Td>
              <Td className={`tabular-nums font-medium ${p.status === "REVERSED" ? "line-through" : ""}`}>{money(p.amountCents)}</Td>
              <Td><Badge tone={p.status === "POSTED" ? "ok" : "bad"}>{t(`fin.pay.${p.status}` as never)}</Badge></Td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/finance/payments" params={{ from: clean(sp.from), to: clean(sp.to), method, status, q: sp.q }} t={t} />
    </>
  );
}
