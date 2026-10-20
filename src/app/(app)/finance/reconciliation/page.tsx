import Link from "next/link";
import type { Metadata } from "next";
import { hasAny } from "@/lib/auth/next";
import { displayDateTime } from "@/lib/dates";
import { listPaymentEvents, providerStatuses } from "@/server/payment-events";
import { Badge, Card, DataTable, EmptyState, NoAccess, PageHeader, Pagination, Td } from "@/components/ui";
import { FinanceNav } from "@/components/finance/subnav";
import { financePage } from "../_lib";

export const metadata: Metadata = { title: "Reconciliation" };
const TONE = { POSTED: "ok", UNMATCHED: "warn", NOT_SUCCESSFUL: "neutral", REJECTED: "bad" } as const;

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const { ctx, t, money, timezone, unmatched } = await financePage();
  if (!hasAny(ctx, ["finance.reconcile"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  const status = (["UNMATCHED", "POSTED", "NOT_SUCCESSFUL", "REJECTED"] as const).find((s) => s === sp.status) ?? "UNMATCHED";
  const [data, providers] = await Promise.all([listPaymentEvents(ctx, { status, page: Number(sp.page) || 1 }), Promise.resolve(providerStatuses(ctx))]);
  return (
    <>
      <PageHeader title={t("fin.recon.title")} subtitle={t("fin.recon.subtitle")} />
      <FinanceNav ctx={ctx} t={t} current="/finance/reconciliation" unmatched={unmatched} />
      <Card title={t("fin.recon.providers")} className="mb-6">
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {providers.map((p) => <li key={p.key} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm"><span className="font-medium">{p.name}</span><Badge tone={p.configured ? "ok" : "neutral"}>{p.configured ? t("fin.recon.configured") : t("fin.recon.notConfigured")}</Badge></li>)}
        </ul>
        <p className="mt-3 text-sm text-muted">{providers.some((p) => p.configured) ? t("fin.recon.help") : t("fin.recon.noneConfigured")}</p>
      </Card>
      <nav className="mb-4 flex flex-wrap gap-2" aria-label={t("marks.status")}>
        {(["UNMATCHED", "POSTED", "NOT_SUCCESSFUL", "REJECTED"] as const).map((s) => (
          <a key={s} href={`/finance/reconciliation?status=${s}`} aria-current={status === s ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium ${status === s ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white hover:bg-canvas"}`}>{t(`fin.event.${s}` as never)}{s === "UNMATCHED" && unmatched > 0 ? ` (${unmatched})` : ""}</a>
        ))}
      </nav>
      {data.items.length === 0 ? <EmptyState>{status === "UNMATCHED" ? t("fin.recon.emptyQueue") : t("fin.recon.empty")}</EmptyState> : (
        <DataTable head={[t("fin.pdf.date"), t("fin.recon.provider"), t("fin.pdf.amount"), t("fin.pdf.reference"), t("marks.status"), ""]}>
          {data.items.map((e) => (
            <tr key={e.id}>
              <Td className="whitespace-nowrap text-xs">{displayDateTime(e.receivedAt, timezone)}</Td>
              <Td>{e.provider}<p className="text-xs text-muted">{e.providerEventId}</p></Td>
              <Td className="tabular-nums font-medium">{e.amountCents === null ? "—" : `${money(e.amountCents)}`}{e.currency && e.currency !== "TZS" ? ` (${e.currency})` : ""}<p className="text-xs font-normal text-muted">{e.msisdn ?? ""}</p></Td>
              <Td className="text-sm">{e.reference ?? "—"}{e.note && <p className="text-xs text-muted">{e.note}</p>}</Td>
              <Td><Badge tone={TONE[e.status]}>{t(`fin.event.${e.status}` as never)}</Badge></Td>
              <Td>
                {e.status === "UNMATCHED" && <Link href={`/finance/reconciliation/${e.id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-800 hover:underline">{t("fin.recon.review")}</Link>}
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/finance/reconciliation" params={{ status }} t={t} />
      <p className="mt-4 text-xs text-muted">{t("fin.recon.neverAuto")}</p>
    </>
  );
}
