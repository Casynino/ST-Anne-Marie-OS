import { Download } from "lucide-react";
import type { Translate } from "@/lib/i18n";
import { displayDate } from "@/lib/dates";
import { formatMoney } from "@/lib/finance/money";
import { Badge, Card } from "@/components/ui";
import type { JoiningView } from "@/server/joining";

/**
 * The joining instructions on screen (the same content as the printable letter): what to pay and how, what to bring, when to report and
 * the entrance results. Used on the accepted applicant's page for staff and in the family's account.
 */
export function JoiningCard({ v, t, locale, pdfHref }: { v: JoiningView; t: Translate; locale: "EN" | "SW"; pdfHref: string }) {
  const cur = v.school.currency;
  const settled = v.fee.status === "PAID" || v.fee.status === "WAIVED" || v.fee.status === "NOT_REQUIRED";
  const none = v.fee.requiredCents <= 0;
  return (
    <Card
      title={t("join.title")}
      actions={<a href={`${pdfHref}?lang=${locale}`} target="_blank" rel="noopener" className="inline-flex min-h-9 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-medium text-link hover:border-brand-500 hover:bg-tint"><Download className="size-4" aria-hidden />{t("join.download")}</a>}
    >
      <p className="mb-5 text-sm text-muted">{t("join.congrats", { name: v.applicantName, class: v.className ?? "" })}</p>

      <section aria-labelledby="join-pay">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 id="join-pay" className="text-xs font-semibold uppercase tracking-wide text-muted">{t("join.pay")}</h3>
          {!none && <Badge tone={settled ? "ok" : "warn"}>{t(`adm.pay.status.${v.fee.status}` as "adm.pay.status.PAID")}</Badge>}
        </div>
        {none ? <p className="text-sm">{t("join.noFee")}</p> : (
          <div className="rounded-lg border border-line bg-canvas p-4">
            <dl className="grid gap-4 sm:grid-cols-3">
              <div><dt className="text-xs uppercase tracking-wide text-muted">{t("join.fee")}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(v.fee.requiredCents, cur)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-muted">{t("join.paid")}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(v.fee.verifiedCents, cur)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-muted">{t("join.balance")}</dt><dd className={`mt-1 text-lg font-semibold tabular-nums ${settled ? "" : "text-warn"}`}>{formatMoney(v.fee.balanceCents, cur)}</dd></div>
            </dl>
            <p className="mt-4 border-t border-line pt-3 text-sm"><span className="text-muted">{t("join.reference")}: </span><strong className="tabular-nums">{v.fee.reference}</strong></p>
            <div className="mt-3">
              <h4 className="text-xs uppercase tracking-wide text-muted">{t("join.howToPay")}</h4>
              <p className="mt-1 whitespace-pre-line text-sm">{v.fee.howToPay || t("join.howToPayNone")}</p>
            </div>
            <p className="mt-3 text-xs text-muted">{t("join.payNote")}</p>
          </div>
        )}
      </section>

      {v.settings.bringList.length > 0 && (
        <section aria-labelledby="join-bring" className="mt-6">
          <h3 id="join-bring" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("join.bring")}</h3>
          <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {v.settings.bringList.map((x) => <li key={x} className="flex gap-2"><span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-sm border border-brand-500" />{x}</li>)}
          </ul>
        </section>
      )}

      {(v.settings.reportingOn || v.settings.reportingNote) && (
        <section aria-labelledby="join-report" className="mt-6">
          <h3 id="join-report" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("join.report")}</h3>
          {v.settings.reportingOn && <p className="text-base font-semibold text-link">{displayDate(new Date(`${v.settings.reportingOn}T00:00:00Z`), locale)}</p>}
          {v.settings.reportingNote && <p className="mt-1 text-sm">{v.settings.reportingNote}</p>}
        </section>
      )}

      {v.results.length > 0 && (
        <section aria-labelledby="join-results" className="mt-6">
          <h3 id="join-results" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("join.results")}</h3>
          <table className="w-full max-w-md text-left text-sm">
            <tbody className="divide-y divide-line border-y border-line">
              {v.results.map((r) => <tr key={r.subject}><td className="py-2 pr-3">{r.subject}</td><td className="py-2 text-right tabular-nums">{r.mark !== null ? `${r.mark} / ${r.maxMark}` : r.outcome ?? "—"}</td></tr>)}
              {v.average !== null && <tr><td className="py-2 pr-3 font-semibold">{t("join.average")}</td><td className="py-2 text-right font-semibold tabular-nums">{v.average}%{v.passMark !== null ? ` · ${t("join.passMark", { pass: String(v.passMark) })}` : ""}</td></tr>}
            </tbody>
          </table>
        </section>
      )}

      <section aria-labelledby="join-next" className="mt-6">
        <h3 id="join-next" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("join.next")}</h3>
        <ol className="space-y-1.5 text-sm">
          {(["join.step1", "join.step2", "join.step3", "join.step4"] as const).map((k, i) => <li key={k} className="flex gap-3"><span className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm bg-brand-700 text-xs font-semibold text-white">{i + 1}</span>{t(k)}</li>)}
        </ol>
      </section>

      {v.settings.notes && <p className="mt-6 whitespace-pre-line rounded-lg border border-line bg-canvas p-3 text-sm">{v.settings.notes}</p>}
    </Card>
  );
}
