import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Download } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { formatMoney } from "@/lib/finance/money";
import { AppError } from "@/lib/errors";
import { getMyApplication } from "@/server/application-fee";
import { ActionForm } from "@/components/form";
import { Badge, Card, LinkButton, PageHeader } from "@/components/ui";
import { cancelApplicationAction, sandboxPayAction } from "../actions";

export const metadata: Metadata = { title: "Application" };

export default async function MyApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const t = await getT();
  const a = await getMyApplication(ctx, id).catch((e) => (e instanceof AppError && e.code === "NOT_FOUND" ? null : Promise.reject(e)));
  if (!a) notFound();
  const money = (c: number) => formatMoney(c, a.currency);
  const dl = (href: string, label: string) => <a href={href} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:border-brand-500"><Download className="size-4" aria-hidden />{label}</a>;
  return (
    <>
      <PageHeader title={a.childName} subtitle={[a.className, a.applicationNo].filter(Boolean).join(" · ")} actions={<Badge tone={a.draftStatus === "SUBMITTED" ? "ok" : a.draftStatus === "AWAITING_PAYMENT" ? "warn" : "neutral"}>{t(`apf.status.${a.draftStatus}` as "apf.status.SUBMITTED")}</Badge>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {a.draftStatus === "AWAITING_PAYMENT" && (
            <Card title={t("apf.pay.title")}>
              <p className="text-sm text-muted">{t("apf.pay.intro")}</p>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                <div><dt className="text-xs text-muted">{t("apf.pay.amount")}</dt><dd className="text-2xl font-semibold tabular-nums">{money(a.feeCents)}</dd></div>
                <div><dt className="text-xs text-muted">{t("apf.pay.reference")}</dt><dd className="font-mono text-2xl font-semibold tracking-wider">{a.reference}</dd></div>
              </dl>
              {a.ready && a.instructions && (
                <div className="mt-4 rounded-xl border border-line bg-canvas p-4">
                  <p className="text-sm font-semibold">{t("apf.pay.how")}</p>
                  <p className="mt-1 whitespace-pre-line text-sm">{a.instructions}</p>
                  <p className="mt-2 text-sm text-muted">{t("apf.pay.useReference", { reference: a.reference })}</p>
                </div>
              )}
              {!a.ready && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-warn">{t("apf.pay.notReady")}</p>}
              <p className="mt-4 text-sm text-muted">{t("apf.pay.after")}</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <LinkButton href={`/family/applications/${a.id}`} variant="secondary">{t("apf.pay.check")}</LinkButton>
              </div>
              {a.sandbox && (
                <div className="mt-5 rounded-xl border-2 border-dashed border-amber-400 bg-amber-50 p-4">
                  <p className="text-sm font-semibold text-warn">{t("apf.sandbox.title")}</p>
                  <p className="mb-3 text-sm text-warn">{t("apf.sandbox.body")}</p>
                  <ActionForm action={sandboxPayAction} submitLabel={t("apf.sandbox.button")}><input type="hidden" name="id" value={a.id} /></ActionForm>
                </div>
              )}
            </Card>
          )}
          {a.draftStatus === "SUBMITTED" && (
            <Card title={t("apf.done.title")}>
              <p className="text-sm">{t("apf.done.body", { number: a.applicationNo ?? "" })}</p>
              {a.publicStatus && <p className="mt-2 text-sm"><span className="text-muted">{t("apf.done.status")}: </span><strong>{t(`apply.status.${a.publicStatus}` as "apply.status.APPLIED")}</strong></p>}
              <div className="mt-4 flex flex-wrap gap-3">
                {dl(`/api/applications/${a.id}/form`, t("apf.download.form"))}
                {a.paid && dl(`/api/applications/${a.id}/receipt`, t("apf.download.receipt"))}
              </div>
              <p className="mt-4 text-sm text-muted">{t("apf.done.track")}</p>
            </Card>
          )}
          {a.draftStatus === "PAID_HOLD" && (
            <Card title={t("apf.hold.title")}>
              <p className="text-sm">{t("apf.hold.body")}</p>
              {a.paid && <div className="mt-4">{dl(`/api/applications/${a.id}/receipt`, t("apf.download.receipt"))}</div>}
            </Card>
          )}
          {a.draftStatus === "CANCELLED" && <Card><p className="text-sm text-muted">{t("apf.cancelled")}</p></Card>}
        </div>
        <div className="space-y-5">
          <Card title={t("apf.details")}>
            <dl className="space-y-2 text-sm">
              <div><dt className="text-muted">{t("apf.pay.reference")}</dt><dd className="font-mono">{a.reference}</dd></div>
              <div><dt className="text-muted">{t("apf.started")}</dt><dd>{displayDate(a.createdAt, ctx.locale)}</dd></div>
              {a.paid && a.paidAt && <div><dt className="text-muted">{t("apf.paidOn")}</dt><dd>{displayDate(a.paidAt, ctx.locale)}{a.test ? ` (${t("apf.test")})` : ""}</dd></div>}
              {a.receiptNo && <div><dt className="text-muted">{t("fin.pdf.receiptNo")}</dt><dd>{a.receiptNo}</dd></div>}
            </dl>
          </Card>
          {a.draftStatus === "AWAITING_PAYMENT" && (
            <Card title={t("apf.cancel.title")}>
              <ActionForm action={cancelApplicationAction} submitLabel={t("apf.cancel.button")} tone="danger" confirm={t("apf.cancel.confirm")}><input type="hidden" name="id" value={a.id} /></ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
