import type { Metadata } from "next";
import { displayDate } from "@/lib/dates";
import { hasAny } from "@/lib/auth/next";
import { admissionPaymentQueue } from "@/server/admission-offers";
import { Badge, Card, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { FinanceNav } from "@/components/finance/subnav";
import { financePage } from "../_lib";
import { PaymentActions, PaymentForm, PAY_TONE } from "../../admissions/[id]/sections";

export const metadata: Metadata = { title: "School fee for accepted applicants" };
const ROW_TONE = { PENDING: "warn", VERIFIED: "ok", REJECTED: "bad", REVERSED: "neutral" } as const;

/** Finance's desk for admission payments: record what an applicant paid, verify it, issue the receipt. Enrolment waits for the verified amount. */
export default async function AdmissionPaymentsPage() {
  const { ctx, t, money, unmatched } = await financePage();
  if (!hasAny(ctx, ["admission.payment.record", "admission.payment.verify"])) return <NoAccess t={t} />;
  const queue = await admissionPaymentQueue(ctx);
  const toVerify = queue.filter((a) => a.payments.some((p) => p.status === "PENDING"));
  return (
    <>
      <PageHeader title={t("fin.adm.title")} subtitle={t("fin.adm.sub")} />
      <FinanceNav ctx={ctx} t={t} current="/finance/admissions" unmatched={unmatched} admissionDue={queue.filter((a) => a.stage !== "PAID").length} />
      {queue.length === 0 ? <EmptyState>{t("fin.adm.none")}</EmptyState> : (
        <div className="space-y-6">
          <dl className="grid gap-3 sm:grid-cols-3" aria-label={t("fin.adm.summary")}>
            {([["TO_VERIFY", "fin.adm.stage.TO_VERIFY"], ["TO_PAY", "fin.adm.stage.TO_PAY"], ["PAID", "fin.adm.stage.PAID"]] as const).map(([k, label]) => (
              <div key={k} className="rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
                <dt className="text-xs uppercase tracking-wide text-muted">{t(label)}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">{queue.filter((a) => a.stage === k).length}</dd>
              </div>
            ))}
          </dl>
          <section aria-labelledby="to-verify">
            <h2 id="to-verify" className="mb-2 text-lg font-semibold">{t("fin.adm.toVerify")} ({toVerify.reduce((n, a) => n + a.payments.filter((p) => p.status === "PENDING").length, 0)})</h2>
            {toVerify.length === 0 ? <p className="text-sm text-muted">{t("fin.adm.noneToVerify")}</p> : (
              <div className="grid gap-3 lg:grid-cols-2">
                {toVerify.map((a) => a.payments.filter((p) => p.status === "PENDING").map((p) => (
                  <Card key={p.id} title={`${a.name} · ${a.applicationNo}`} actions={<Badge tone="warn">{t("adm.pay.row.PENDING")}</Badge>}>
                    <p className="mb-3 text-sm"><span className="font-semibold tabular-nums">{money(p.amountCents)}</span> <span className="text-muted">· {t(`fin.method.${p.method}` as "fin.method.CASH")}{p.reference ? ` · ${p.reference}` : ""} · {displayDate(p.paidOn, ctx.locale)}</span></p>
                    {hasAny(ctx, ["admission.payment.verify"]) ? <PaymentActions t={t} paymentId={p.id} status="PENDING" enrolled={false} /> : null}
                  </Card>
                )))}
              </div>
            )}
          </section>
          <section aria-labelledby="applicants">
            <h2 id="applicants" className="mb-2 text-lg font-semibold">{t("fin.adm.applicants")} ({queue.length})</h2>
            <div className="grid gap-4 xl:grid-cols-2">
              {queue.map((a) => (
                <Card key={a.id} title={a.name} actions={<Badge tone={a.stage === "PAID" ? "ok" : a.stage === "TO_VERIFY" ? "warn" : PAY_TONE[a.account.status]}>{t(`fin.adm.stage.${a.stage}` as "fin.adm.stage.PAID")}</Badge>}>
                  <p className="mb-3 text-sm text-muted">{a.className ? `${a.className} · ` : ""}{a.decidedAt ? `${t("fin.adm.accepted")} ${displayDate(a.decidedAt, ctx.locale)} · ` : ""}{t("adm.acc.reference")}: <span className="font-medium text-ink">{a.applicationNo}</span> · {t("fin.adm.offer")} {a.letterNo}{a.expiresOn ? ` · ${t("fin.adm.expires")} ${displayDate(a.expiresOn, ctx.locale)}` : ""}{a.guardian ? ` · ${a.guardian.fullName ?? ""} ${a.guardian.phone ?? ""}` : ""}</p>
                  <dl className="mb-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div><dt className="text-muted">{t("adm.pay.required")}</dt><dd className="font-semibold tabular-nums">{money(a.account.requiredCents)}</dd></div>
                    <div><dt className="text-muted">{t("adm.pay.verified")}</dt><dd className="font-semibold tabular-nums text-ok">{money(a.account.verifiedCents)}</dd></div>
                    <div><dt className="text-muted">{t("adm.pay.pending")}</dt><dd className="font-semibold tabular-nums">{money(a.account.pendingCents)}</dd></div>
                    <div><dt className="text-muted">{t("adm.pay.balance")}</dt><dd className="font-semibold tabular-nums">{money(a.account.balanceCents)}</dd></div>
                  </dl>
                  {a.stage === "PAID" && <p className="mb-3 text-sm text-ok">{t("fin.adm.paidNote")}</p>}
                  {a.payments.length > 0 && (
                    <ul className="mb-3 divide-y divide-line text-sm">
                      {a.payments.map((p) => (
                        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                          <span><span className="tabular-nums">{money(p.amountCents)}</span> <span className="text-muted">· {t(`fin.method.${p.method}` as "fin.method.CASH")}{p.reference ? ` · ${p.reference}` : ""}</span></span>
                          <span className="flex items-center gap-2">
                            {p.receiptNo && <a href={`/api/admission-receipts/${p.id}?lang=${ctx.locale}`} target="_blank" rel="noopener" className="font-medium text-link hover:underline">{t("adm.pay.receipt")} {p.receiptNo}</a>}
                            <Badge tone={ROW_TONE[p.status as keyof typeof ROW_TONE]}>{t(`adm.pay.row.${p.status}` as "adm.pay.row.PENDING")}</Badge>
                          </span>
                          {p.status === "VERIFIED" && hasAny(ctx, ["admission.payment.verify"]) && <span className="basis-full"><PaymentActions t={t} paymentId={p.id} status="VERIFIED" enrolled={false} /></span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {hasAny(ctx, ["admission.payment.record"]) && (
                    <details className="rounded-lg border border-line bg-canvas/40 px-3 py-1">
                      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-link">{t("fin.adm.record")}</summary>
                      <div className="pb-3 pt-1"><PaymentForm t={t} applicationId={a.id} /></div>
                    </details>
                  )}
                </Card>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
