import type { Metadata } from "next";
import Link from "next/link";
import { requireContext, getT } from "@/lib/auth/next";
import { formatMoney } from "@/lib/finance/money";
import { annualFeeBoard, type FeeFilter } from "@/server/annual-fees";
import { FinanceNav } from "@/components/finance/subnav";
import { ActionForm, Field } from "@/components/form";
import { ClearanceBadge, CountTabs, Figures } from "@/components/lifecycle/parts";
import { DataTable, EmptyState, NoAccess, PageHeader, Pagination, Td } from "@/components/ui";
import { billReturningAction } from "./actions";

export const metadata: Metadata = { title: "Annual fees" };
const OUTCOMES = ["PROMOTED", "REPEAT"] as const;
const REG = ["PENDING", "REGISTERED", "ACTIVE"] as const;
const STATES = ["cleared", "owing", "not_billed", "exception", "previous"] as const;

/**
 * Annual fee clearance for the new year, for Finance: what each returning student owes for the year, what verified payments cover, and the debt
 * from earlier years on its own line. Clearance is a fact about money; it never changes an academic decision. Admissions sees the status only.
 */
export default async function AnnualFeesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireContext();
  const t = await getT();
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  if (!can("fees.read") || !can("registration.read")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const state = (STATES as readonly string[]).includes(sp.state ?? "") ? (sp.state as FeeFilter["state"]) : undefined;
  const outcome = (OUTCOMES as readonly string[]).includes(sp.outcome ?? "") ? (sp.outcome as FeeFilter["outcome"]) : undefined;
  const regStatus = (REG as readonly string[]).includes(sp.reg ?? "") ? (sp.reg as FeeFilter["regStatus"]) : undefined;
  const b = await annualFeeBoard(ctx, { yearId: sp.year, classId: sp.class, streamId: sp.stream, outcome, regStatus, state, q: sp.q, page: Number(sp.page) || 1 });
  if (!b.year) return <><PageHeader title={t("lc.fee.title")} /><FinanceNav ctx={ctx} t={t} current="/finance/annual" /><EmptyState>{t("lc.noNextYear")}</EmptyState></>;

  const tot = b.totals;
  const q = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ year: sp.year, class: sp.class, stream: sp.stream, outcome: sp.outcome, reg: sp.reg, q: sp.q, state: sp.state, ...extra })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/finance/annual?${s}` : "/finance/annual";
  };
  const tab = (key: string | undefined, label: string, count: number) => ({ href: q({ state: key, page: undefined }), label, count, active: (state ?? undefined) === key });
  const nextMonth = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title={t("lc.fee.title")} subtitle={t("lc.fee.sub", { year: b.year.name })} />
      <FinanceNav ctx={ctx} t={t} current="/finance/annual" />
      <Figures items={[
        { label: t("lc.ret.fig.total"), value: tot.students },
        { label: t("lc.fee.expected"), value: formatMoney(tot.expected) },
        { label: t("lc.fee.collected"), value: formatMoney(tot.collected), tone: "ok" },
        { label: t("lc.fee.outstanding"), value: formatMoney(tot.outstanding), tone: tot.outstanding ? "warn" : undefined },
        { label: t("lc.fee.older"), value: formatMoney(tot.previousOutstanding), tone: tot.previousOutstanding ? "bad" : undefined },
        { label: t("lc.fee.notBilled"), value: tot.notBilled, tone: tot.notBilled ? "warn" : undefined },
      ]} />
      <p className="mb-4 text-sm text-muted">{t("lc.fee.rule", { policy: t(`lc.rules.fee.${b.settings.feePolicy}` as "lc.rules.fee.INFORM_ONLY") })}</p>

      <div className="mb-4 overflow-x-auto rounded-2xl border border-line bg-surface p-4">
        <p className="text-sm font-medium">{t("lc.rep.byGrade")}</p>
        <p className="mb-3 text-xs text-muted">{t("lc.rep.byGradeHint")}</p>
        <table className="w-full min-w-[48rem] text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
          <thead><tr className="border-b border-line text-left text-xs text-muted">
            <th className="py-1.5 pr-3 font-medium">{t("lc.col.class")}</th><th className="px-3 py-1.5 text-right font-medium">{t("lc.rep.students")}</th><th className="px-3 py-1.5 text-right font-medium">{t("lc.rep.expected")}</th>
            <th className="px-3 py-1.5 text-right font-medium">{t("lc.rep.initial")}{b.initial.pct !== null ? ` (${b.initial.pct}%)` : ""}</th><th className="px-3 py-1.5 text-right font-medium">{t("lc.rep.collected")}</th>
            <th className="px-3 py-1.5 text-right font-medium">{t("lc.rep.initialVerified")}</th><th className="px-3 py-1.5 text-right font-medium">{t("lc.fee.outstanding")}</th><th className="pl-3 py-1.5 text-right font-medium">{t("lc.fee.older")}</th>
          </tr></thead>
          <tbody className="divide-y divide-line tabular-nums">
            {b.byGrade.map((g) => (
              <tr key={g.className}>
                <td className="py-1.5 pr-3 font-medium">{g.className}</td><td className="px-3 py-1.5 text-right">{g.students}</td><td className="px-3 py-1.5 text-right">{formatMoney(g.expected)}</td>
                <td className="px-3 py-1.5 text-right">{g.initialRequired === null ? <span className="text-muted">—</span> : formatMoney(g.initialRequired)}</td><td className="px-3 py-1.5 text-right">{formatMoney(g.collected)}</td>
                <td className="px-3 py-1.5 text-right">{g.verified} / {g.students}</td><td className={`px-3 py-1.5 text-right ${g.outstanding ? "text-warn" : ""}`}>{formatMoney(g.outstanding)}</td><td className={`pl-3 py-1.5 text-right ${g.previousOutstanding ? "text-bad" : ""}`}>{formatMoney(g.previousOutstanding)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t border-line font-medium">
            <td className="py-1.5 pr-3">{t("lc.tab.all")}</td><td className="px-3 py-1.5 text-right">{tot.students}</td><td className="px-3 py-1.5 text-right">{formatMoney(tot.expected)}</td>
            <td className="px-3 py-1.5 text-right">{b.initial.required === null ? <span className="text-muted">{t("lc.rep.notSet")}</span> : formatMoney(b.initial.required)}</td><td className="px-3 py-1.5 text-right">{formatMoney(tot.collected)}</td>
            <td className="px-3 py-1.5 text-right">{tot.cleared} / {tot.students}</td><td className="px-3 py-1.5 text-right">{formatMoney(tot.outstanding)}</td><td className="pl-3 py-1.5 text-right">{formatMoney(tot.previousOutstanding)}</td>
          </tr></tfoot>
        </table>
        {b.awaitingReconciliation > 0 && <p className="mt-3 text-xs text-warn">{t("lc.rep.reconcile")}: {b.awaitingReconciliation}</p>}
      </div>

      {tot.notBilled > 0 && can("invoice.generate") && (
        <div className="mb-4 rounded-2xl border border-line bg-surface p-3">
          <p className="mb-2 text-sm font-medium">{t("lc.fee.billTitle", { term: b.firstTermName ?? "" })}</p>
          <ActionForm action={billReturningAction} submitLabel={t("lc.fee.billGo")} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="yearId" value={b.year.id} />
            <Field name="dueDate" type="date" label={t("lc.fee.due")} defaultValue={nextMonth} required className="w-48" />
          </ActionForm>
          <p className="mt-2 text-xs text-muted">{t("lc.fee.billHint")}</p>
        </div>
      )}

      <CountTabs items={[
        tab(undefined, t("lc.tab.all"), tot.students), tab("cleared", t("lc.clear.CLEARED"), tot.cleared), tab("owing", t("lc.clear.OUTSTANDING"), tot.owing), tab("not_billed", t("lc.clear.NOT_BILLED"), tot.notBilled),
        tab("exception", t("lc.fee.arrangements"), tot.exceptions), tab("previous", t("lc.fee.olderTab"), tot.withPreviousDebt),
      ]} />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        {sp.year && <input type="hidden" name="year" value={sp.year} />}{sp.state && <input type="hidden" name="state" value={sp.state} />}
        <label className="text-sm"><span className="mb-1 block text-muted">{t("lc.col.class")}</span>
          <select name="class" defaultValue={sp.class ?? ""} className="min-h-11 rounded-lg border border-line bg-surface px-3 text-base"><option value="">{t("lc.allClasses")}</option>{b.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <label className="text-sm"><span className="mb-1 block text-muted">{t("student.stream")}</span>
          <select name="stream" defaultValue={sp.stream ?? ""} className="min-h-11 rounded-lg border border-line bg-surface px-3 text-base"><option value="">{t("lc.fee.allStreams")}</option>{b.streams.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <label className="text-sm"><span className="mb-1 block text-muted">{t("lc.detail.outcome")}</span>
          <select name="outcome" defaultValue={sp.outcome ?? ""} className="min-h-11 rounded-lg border border-line bg-surface px-3 text-base"><option value="">{t("lc.fee.anyOutcome")}</option>{OUTCOMES.map((o) => <option key={o} value={o}>{t(`lc.outcome.${o}` as "lc.outcome.PROMOTED")}</option>)}</select>
        </label>
        <label className="text-sm"><span className="mb-1 block text-muted">{t("lc.fee.regStatus")}</span>
          <select name="reg" defaultValue={sp.reg ?? ""} className="min-h-11 rounded-lg border border-line bg-surface px-3 text-base"><option value="">{t("lc.fee.anyReg")}</option>{REG.map((o) => <option key={o} value={o}>{t(`lc.reg.${o}` as "lc.reg.PENDING")}</option>)}</select>
        </label>
        <label className="text-sm"><span className="mb-1 block text-muted">{t("common.search")}</span><input name="q" defaultValue={sp.q ?? ""} placeholder={t("lc.searchHint")} className="min-h-11 w-56 rounded-lg border border-line bg-surface px-3 text-base" /></label>
        <button className="min-h-11 rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:bg-canvas btn-secondary">{t("common.filter")}</button>
      </form>

      {b.rows.length === 0 ? <EmptyState>{t("lc.ret.none")}</EmptyState> : (
        <DataTable head={[t("lc.col.student"), t("lc.col.class"), t("lc.fee.firstTerm"), t("lc.fee.wholeYear"), t("lc.fee.older"), t("lc.col.fees")]}>
          {b.rows.map((r) => (
            <tr key={r.registrationId}>
              <Td><Link href={`/students/returning/${r.registrationId}`} className="font-medium text-link hover:underline">{r.name}</Link><span className="block text-xs text-muted">{r.admissionNo}</span></Td>
              <Td className="whitespace-nowrap">{r.className ?? "—"}{r.streamName ? ` ${r.streamName}` : ""}<span className="block text-xs text-muted">{t(`lc.outcome.${r.outcome}` as "lc.outcome.PROMOTED")} · {t(`lc.reg.${r.status}` as "lc.reg.PENDING")}</span></Td>
              <Td className="tabular-nums">{r.firstTerm.billed ? <>{formatMoney(r.firstTerm.paid)} / {formatMoney(r.firstTerm.charged)}<span className={`block text-xs ${r.firstTerm.outstanding ? "text-warn" : "text-muted"}`}>{t("lc.fee.owed")}: {formatMoney(r.firstTerm.outstanding)}</span></> : <span className="text-muted">—</span>}</Td>
              <Td className="tabular-nums">{r.year.billed ? <>{formatMoney(r.year.charged)}<span className="block text-xs text-muted">{t("lc.fee.owed")}: {formatMoney(r.year.outstanding)}</span></> : <span className="text-muted">—</span>}</Td>
              <Td className="tabular-nums">{r.previousOutstanding > 0 ? <span className="text-bad">{formatMoney(r.previousOutstanding)}<span className="block text-xs text-muted">{r.previous.map((p) => p.yearName).join(", ")}</span></span> : <span className="text-muted">—</span>}</Td>
              <Td><ClearanceBadge state={r.state} t={t} />{r.exceptionReason && <span className="mt-1 block max-w-48 text-xs text-muted" title={r.exceptionReason}>{r.exceptionReason}</span>}</Td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pagination page={b.page} pageSize={50} total={b.total} basePath="/finance/annual" params={{ year: sp.year, class: sp.class, stream: sp.stream, outcome: sp.outcome, reg: sp.reg, q: sp.q, state: sp.state }} t={t} />
    </>
  );
}
