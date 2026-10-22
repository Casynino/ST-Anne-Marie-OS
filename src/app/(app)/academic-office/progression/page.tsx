import type { Metadata } from "next";
import Link from "next/link";
import { requireContext, getT } from "@/lib/auth/next";
import { progressionBoard, type ProgressionFilter } from "@/server/progression";
import { ActionForm, Field } from "@/components/form";
import { SubmitButton } from "@/components/submit-button";
import { SelectAll } from "@/components/lifecycle/select-all";
import { CountTabs, DecisionStatus, Figures, OutcomeBadge, ResultsCell } from "@/components/lifecycle/parts";
import { Card, DataTable, EmptyState, NoAccess, PageHeader, Pagination, Td } from "@/components/ui";
import { lifecycleSettingsAction, prepareAction, progressionAction } from "./actions";

export const metadata: Metadata = { title: "End of year" };
const SHOWS = ["none", "draft", "awaiting_head", "approved", "review", "incomplete"] as const;

/**
 * The Academic Office's end-of-year screen: every student of the year, whether their results are complete, and what has been decided. One bar
 * decides or approves a whole selection; one page per student (click the name) holds the details and the exceptions. The system never decides
 * promotion or repetition: it shows the facts and records who decided what, and when.
 */
export default async function ProgressionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireContext();
  const t = await getT();
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  if (!can("progression.read")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const show = (SHOWS as readonly string[]).includes(sp.show ?? "") ? (sp.show as ProgressionFilter["show"]) : undefined;
  const b = await progressionBoard(ctx, { yearId: sp.year, classId: sp.class, q: sp.q, show, page: Number(sp.page) || 1 });
  if (!b.year) return <><PageHeader title={t("lc.prog.title")} /><EmptyState>{t("lc.noYear")}</EmptyState></>;

  const canDecide = can("progression.prepare");
  const canApprove = can("progression.approve") || can("progression.head_approve");
  const tot = b.totals;
  const q = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const all = { year: sp.year, class: sp.class, q: sp.q, show: sp.show, ...extra };
    for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/academic-office/progression?${s}` : "/academic-office/progression";
  };
  const tab = (key: string | undefined, label: string, count?: number) => ({ href: q({ show: key, page: undefined }), label, count, active: (show ?? undefined) === key });
  const classOptions = b.classes.map((c) => ({ value: c.classId, label: c.name }));
  const outcomes = ["PROMOTED", "REPEAT", "PENDING_REVIEW", "COMPLETED", "WITHDRAWN", "TRANSFERRED"] as const;

  return (
    <>
      <PageHeader
        title={t("lc.prog.title")}
        subtitle={b.nextYear ? t("lc.prog.sub", { from: b.year.name, to: b.nextYear.name }) : t("lc.prog.subNoNext", { from: b.year.name })}
        actions={<Link href="/academic-setup/readiness" className="text-sm font-medium text-link hover:underline">{t("lc.ready.link")}</Link>}
      />
      {!b.nextYear && <p role="status" className="mb-4 rounded-lg border border-warn/40 bg-amber-50 px-3 py-2 text-sm text-warn">{t("lc.prog.noNextYear")}</p>}

      <Figures items={[
        { label: t("lc.fig.students"), value: tot.students },
        { label: t("lc.fig.none"), value: tot.none, tone: tot.none ? "warn" : "ok" },
        { label: t("lc.fig.draft"), value: tot.draft },
        { label: t("lc.fig.head"), value: tot.awaitingHead, tone: tot.awaitingHead ? "warn" : undefined },
        { label: t("lc.fig.approved"), value: tot.approved, tone: "ok" },
        { label: t("lc.fig.incomplete"), value: tot.incomplete, tone: tot.incomplete ? "warn" : undefined },
      ]} />

      <CountTabs items={[
        tab(undefined, t("lc.tab.all"), tot.students), tab("none", t("lc.tab.none"), tot.none), tab("draft", t("lc.tab.draft"), tot.draft),
        ...(b.settings.requireHeadApproval || tot.awaitingHead ? [tab("awaiting_head", t("lc.tab.head"), tot.awaitingHead)] : []),
        tab("approved", t("lc.tab.approved"), tot.approved), tab("review", t("lc.tab.review"), tot.review), tab("incomplete", t("lc.tab.incomplete"), tot.incomplete),
      ]} />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <form method="get" className="flex flex-wrap items-end gap-3">
          {sp.year && <input type="hidden" name="year" value={sp.year} />}
          {sp.show && <input type="hidden" name="show" value={sp.show} />}
          <label className="text-sm"><span className="mb-1 block text-muted">{t("lc.col.class")}</span>
            <select name="class" defaultValue={sp.class ?? ""} className="min-h-11 rounded-lg border border-line bg-surface px-3 text-base">
              <option value="">{t("lc.allClasses")}</option>
              {classOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="text-sm"><span className="mb-1 block text-muted">{t("common.search")}</span>
            <input name="q" defaultValue={sp.q ?? ""} placeholder={t("lc.searchHint")} className="min-h-11 w-56 rounded-lg border border-line bg-surface px-3 text-base" />
          </label>
          <button className="min-h-11 rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:bg-canvas">{t("common.filter")}</button>
        </form>
        {canDecide && tot.none > 0 && (
          <ActionForm action={prepareAction} submitLabel={t("lc.prepare.go")} inline className="flex items-center gap-2">
            <input type="hidden" name="yearId" value={b.year.id} />
            <input type="hidden" name="classId" value={sp.class ?? ""} />
          </ActionForm>
        )}
      </div>
      {canDecide && tot.none > 0 && <p className="-mt-2 mb-4 text-xs text-muted">{b.settings.promotionMinAverage !== null ? t("lc.prepare.hintAvg", { avg: b.settings.promotionMinAverage }) : t("lc.prepare.hintNoAvg")}</p>}

      {b.rows.length === 0 ? <EmptyState>{t("lc.none")}</EmptyState> : (
        <ActionForm action={progressionAction} hideSubmit className="space-y-3">
          <input type="hidden" name="yearId" value={b.year.id} />
          {(canDecide || canApprove) && (
            <div className="rounded-2xl border border-line bg-surface p-3">
              <p className="mb-2 text-sm font-medium">{t("lc.bulk.title")}</p>
              <div className="flex flex-wrap items-end gap-3">
                {canDecide && (
                  <>
                    <Field name="outcome" type="select" label={t("lc.bulk.decision")} options={outcomes.slice(0, 4).map((o) => ({ value: o, label: t(`lc.outcome.${o}` as "lc.outcome.PROMOTED") }))} defaultValue="PROMOTED" className="w-56" />
                    <Field name="note" label={t("lc.bulk.note")} optionalLabel={t("common.optional")} className="w-56" />
                    {can("progression.exception") && <Field name="exceptionReason" label={t("lc.bulk.exception")} optionalLabel={t("common.optional")} hint={t("lc.bulk.exceptionHint")} className="w-64" />}
                    <SubmitButton intent="decide">{t("lc.bulk.save")}</SubmitButton>
                  </>
                )}
                {canApprove && <SubmitButton intent="approve" variant="secondary" confirm={t("lc.bulk.approveConfirm")}>{t("lc.bulk.approve")}</SubmitButton>}
              </div>
              <p className="mt-2 text-xs text-muted">{t("lc.bulk.hint")}</p>
            </div>
          )}
          <DataTable head={[(canDecide || canApprove) ? <SelectAll key="all" name="studentIds" label={t("lc.selectAll")} /> : "", t("lc.col.student"), t("lc.col.class"), t("lc.col.results"), t("lc.col.decision"), t("common.status")]}>
            {b.rows.map((r) => (
              <tr key={r.studentId} className={r.decision?.status === "APPROVED" ? "bg-canvas/50" : ""}>
                <Td className="w-10">{(canDecide || canApprove) && <input type="checkbox" name="studentIds" value={r.studentId} aria-label={r.name} className="size-4 accent-brand-700" />}</Td>
                <Td><Link href={`/academic-office/progression/${r.studentId}?year=${b.year!.id}`} className="font-medium text-link hover:underline">{r.name}</Link><span className="block text-xs text-muted">{r.admissionNo}</span></Td>
                <Td className="whitespace-nowrap">{r.className}{r.streamName ? ` · ${r.streamName}` : ""}</Td>
                <Td><ResultsCell c={r.completion} t={t} /></Td>
                <Td>
                  {r.decision ? (
                    <span className="flex flex-wrap items-center gap-2"><OutcomeBadge outcome={r.decision.outcome} t={t} />{r.decision.toClassName && <span className="text-muted">→ {r.decision.toClassName}</span>}{r.decision.exceptionReason && <span className="text-xs text-warn" title={r.decision.exceptionReason}>{t("lc.exception")}</span>}</span>
                  ) : (
                    <span className="text-muted">{"className" in r.suggested ? t("lc.suggest", { to: r.suggested.className }) : t("lc.suggestFinal")}</span>
                  )}
                </Td>
                <Td>{r.decision ? <DecisionStatus status={r.decision.status} t={t} /> : <span className="text-muted">—</span>}</Td>
              </tr>
            ))}
          </DataTable>
        </ActionForm>
      )}
      <Pagination page={b.page} pageSize={50} total={b.total} basePath="/academic-office/progression" params={{ year: sp.year, class: sp.class, q: sp.q, show: sp.show }} t={t} />

      {b.classes.length > 0 && (
        <details className="mt-6">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-link">{t("lc.byClass")}</summary>
          <DataTable head={[t("lc.col.class"), t("lc.fig.students"), t("lc.fig.none"), t("lc.fig.draft"), t("lc.fig.head"), t("lc.fig.approved"), t("lc.fig.incomplete")]}>
            {b.classes.map((c) => (
              <tr key={c.classId}>
                <Td><Link href={q({ class: c.classId, page: undefined })} className="font-medium text-link hover:underline">{c.name}</Link></Td>
                <Td className="tabular-nums">{c.total}</Td><Td className="tabular-nums">{c.none}</Td><Td className="tabular-nums">{c.draft}</Td><Td className="tabular-nums">{c.awaitingHead}</Td><Td className="tabular-nums">{c.approved}</Td><Td className="tabular-nums">{c.incomplete}</Td>
              </tr>
            ))}
          </DataTable>
        </details>
      )}

      {can("school.settings.update") && (
        <details className="mt-6">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-link">{t("lc.rules.title")}</summary>
          <Card className="mt-2">
            <ActionForm action={lifecycleSettingsAction} submitLabel={t("common.save")} className="grid gap-4 md:grid-cols-2">
              <Field name="requireHeadApproval" type="checkbox" label={t("lc.rules.head")} defaultValue={b.settings.requireHeadApproval} hint={t("lc.rules.headHint")} />
              <Field name="promotionMinAverage" type="number" label={t("lc.rules.avg")} defaultValue={b.settings.promotionMinAverage ?? ""} min={0} max={100} optionalLabel={t("common.optional")} hint={t("lc.rules.avgHint")} />
              <Field name="feePolicy" type="select" label={t("lc.rules.fee")} defaultValue={b.settings.feePolicy} hint={t("lc.rules.feeHint")} options={[
                { value: "INFORM_ONLY", label: t("lc.rules.fee.INFORM_ONLY") }, { value: "BLOCK_REGISTRATION", label: t("lc.rules.fee.BLOCK_REGISTRATION") }, { value: "BLOCK_ACTIVATION", label: t("lc.rules.fee.BLOCK_ACTIVATION") },
              ]} />
              <Field name="previousDebtCounts" type="checkbox" label={t("lc.rules.prev")} defaultValue={b.settings.previousDebtCounts} hint={t("lc.rules.prevHint")} />
            </ActionForm>
          </Card>
        </details>
      )}
    </>
  );
}
