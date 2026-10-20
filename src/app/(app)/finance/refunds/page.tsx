import Link from "next/link";
import type { Metadata } from "next";
import { hasAny } from "@/lib/auth/next";
import { tDynamic } from "@/lib/i18n";
import { displayDate } from "@/lib/dates";
import { centsOf } from "@/lib/finance/money";
import { listRefunds } from "@/server/payments";
import { Badge, DataTable, EmptyState, NoAccess, PageHeader, Td } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { FinanceNav } from "@/components/finance/subnav";
import { financePage } from "../_lib";
import { decideRefundAction, payRefundAction } from "../actions";

export const metadata: Metadata = { title: "Refunds" };
const TONE = { REQUESTED: "warn", APPROVED: "brand", REJECTED: "bad", PAID: "ok" } as const;

export default async function RefundsPage() {
  const { ctx, t, money, unmatched } = await financePage();
  if (!hasAny(ctx, ["fees.read"])) return <NoAccess t={t} />;
  const rows = await listRefunds(ctx);
  const canApprove = hasAny(ctx, ["refund.approve"]);
  const canPay = hasAny(ctx, ["refund.request"]);
  return (
    <>
      <PageHeader title={t("fin.refunds.title")} subtitle={t("fin.refunds.subtitle")} />
      <FinanceNav ctx={ctx} t={t} current="/finance/refunds" unmatched={unmatched} />
      {rows.length === 0 ? <EmptyState>{t("fin.refunds.empty")}</EmptyState> : (
        <DataTable head={[t("fin.pdf.date"), t("marks.student"), t("fin.pdf.amount"), t("marks.reason"), t("marks.status"), ""]}>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td className="whitespace-nowrap">{displayDate(r.requestedAt, ctx.locale)}<p className="text-xs text-muted">{r.requestedBy}</p></Td>
              <Td><Link href={`/finance/students/${r.studentId}`} className="hover:underline">{r.studentName}</Link><p className="text-xs text-muted">{r.admissionNo}</p></Td>
              <Td className="tabular-nums font-medium">{money(centsOf(r.amount))}<p className="text-xs font-normal text-muted">{tDynamic(t, "fin.method", r.method)}</p></Td>
              <Td className="max-w-xs text-sm">{r.reason}{r.decisionNote && <p className="text-xs text-muted">{r.decidedBy}: {r.decisionNote}</p>}</Td>
              <Td><Badge tone={TONE[r.status]}>{t(`fin.refund.${r.status}` as never)}</Badge></Td>
              <Td>
                {r.status === "REQUESTED" && canApprove && r.requestedById !== ctx.userId && (
                  <div className="space-y-2">
                    <ActionForm action={decideRefundAction} submitLabel={t("fin.refunds.approve")} inline className="space-y-0"><input type="hidden" name="refundId" value={r.id} /><input type="hidden" name="decision" value="APPROVE" /></ActionForm>
                    <ActionForm action={decideRefundAction} submitLabel={t("fin.refunds.reject")} inline tone="danger" className="space-y-1"><input type="hidden" name="refundId" value={r.id} /><input type="hidden" name="decision" value="REJECT" /><Field name="note" label={t("marks.reason")} required /></ActionForm>
                  </div>
                )}
                {r.status === "REQUESTED" && r.requestedById === ctx.userId && <span className="text-xs text-muted">{t("fin.refunds.otherApproves")}</span>}
                {r.status === "APPROVED" && canPay && (
                  <ActionForm action={payRefundAction} submitLabel={t("fin.refunds.markPaid")} inline className="space-y-1"><input type="hidden" name="refundId" value={r.id} /><Field name="reference" label={t("fin.pdf.reference")} optionalLabel={r.method === "CASH" ? t("common.optional") : undefined} required={r.method !== "CASH" && r.method !== "OTHER"} /></ActionForm>
                )}
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
