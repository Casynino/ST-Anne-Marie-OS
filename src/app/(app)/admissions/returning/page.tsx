import type { Metadata } from "next";
import Link from "next/link";
import { requireContext, getT } from "@/lib/auth/next";
import { db } from "@/lib/db";
import { displayDate, formatDateOnly, todayInTimezone } from "@/lib/dates";
import { formatMoney } from "@/lib/finance/money";
import { returningBoard, REGISTRATION_STAGES } from "@/server/annual-registration";
import { AdmissionsNav } from "@/components/admissions/subnav";
import { ActionForm } from "@/components/form";
import { SubmitButton } from "@/components/submit-button";
import { SelectAll } from "@/components/lifecycle/select-all";
import { ClearanceBadge, CountTabs, Figures, OutcomeBadge, deptLabel, stageLabel } from "@/components/lifecycle/parts";
import { DataTable, EmptyState, NoAccess, PageHeader, Pagination, Td } from "@/components/ui";
import { activateAction, createRegistrationsAction } from "./actions";

export const metadata: Metadata = { title: "Returning students" };

/**
 * Returning students: pupils who already study here and come back for another year. Their record and Student ID are the ones they always had,
 * so there is no new application. The Academic Office has decided where they go; Admissions places them, confirms the registration and puts them
 * in the class roster. Fee clearance is shown beside each one and only holds a step back if the school's own rule says so.
 */
export default async function ReturningPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireContext();
  const t = await getT();
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  if (!can("registration.read")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const money = sp.money === "cleared" || sp.money === "owing" ? sp.money : undefined;
  const b = await returningBoard(ctx, { yearId: sp.year, classId: sp.class, stage: sp.stage, q: sp.q, money, page: Number(sp.page) || 1 });
  const canManage = can("registration.manage");
  if (!b.year) return <><PageHeader title={t("lc.ret.title")} /><AdmissionsNav ctx={ctx} t={t} current="/admissions/returning" /><EmptyState>{t("lc.noNextYear")}</EmptyState></>;

  const seeMoney = can("fees.read");
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { timezone: true } });
  const today = todayInTimezone(school.timezone);
  const opens = b.year.registrationOpensOn ? formatDateOnly(b.year.registrationOpensOn) : null;
  const closes = b.year.registrationClosesOn ? formatDateOnly(b.year.registrationClosesOn) : null;
  const windowNote = !opens && !closes ? null : closes && today > closes ? t("lc.ret.window.closed", { date: displayDate(b.year.registrationClosesOn, ctx.locale) }) : opens && today < opens ? t("lc.ret.window.notYet", { date: displayDate(b.year.registrationOpensOn, ctx.locale) }) : t("lc.ret.window.open", { date: closes ? displayDate(b.year.registrationClosesOn, ctx.locale) : "—" });

  const q = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ year: sp.year, class: sp.class, q: sp.q, stage: sp.stage, money: sp.money, ...extra })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/admissions/returning?${s}` : "/admissions/returning";
  };
  const by = b.counts.byStage;
  const ready = b.rows.filter((r) => r.stage === "READY_TO_ACTIVATE");

  return (
    <>
      <PageHeader title={t("lc.ret.title")} subtitle={t("lc.ret.sub", { year: b.year.name })} actions={<Link href="/academic-setup/readiness" className="text-sm font-medium text-link hover:underline">{t("lc.ready.link")}</Link>} />
      <AdmissionsNav ctx={ctx} t={t} current="/admissions/returning" />
      {windowNote && <p className="mb-3 text-sm text-muted">{windowNote}</p>}
      <p className="mb-4 text-sm text-muted">{t(`lc.ret.policy.${b.settings.feePolicy}` as "lc.ret.policy.INFORM_ONLY")}</p>

      {b.missing > 0 && canManage && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-amber-50 px-3 py-2 text-sm text-warn">
          <span>{t("lc.ret.missing", { n: b.missing })}</span>
          <ActionForm action={createRegistrationsAction} submitLabel={t("lc.ret.createGo")} inline className="inline"><input type="hidden" name="yearId" value={b.year.id} /></ActionForm>
        </div>
      )}

      <Figures items={[
        { label: t("lc.ret.fig.total"), value: b.counts.total },
        { label: t("lc.stage.NEEDS_PLACEMENT"), value: by.NEEDS_PLACEMENT ?? 0, tone: by.NEEDS_PLACEMENT ? "warn" : "ok" },
        { label: t("lc.stage.NEEDS_REGISTRATION"), value: by.NEEDS_REGISTRATION ?? 0 },
        { label: t("lc.stage.NEEDS_FEE"), value: by.NEEDS_FEE ?? 0, tone: by.NEEDS_FEE ? "warn" : undefined },
        { label: t("lc.stage.READY_TO_ACTIVATE"), value: (by.READY_TO_ACTIVATE ?? 0) + (by.WAITING_YEAR_OPEN ?? 0) },
        { label: t("lc.stage.ACTIVE"), value: by.ACTIVE ?? 0, tone: "ok" },
      ]} />

      <CountTabs items={[
        { href: q({ stage: undefined, page: undefined }), label: t("lc.tab.all"), count: b.counts.total, active: !sp.stage },
        ...REGISTRATION_STAGES.filter((s) => (by[s] ?? 0) > 0).map((s) => ({ href: q({ stage: s, page: undefined }), label: stageLabel(t, s), count: by[s], active: sp.stage === s })),
      ]} />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        {sp.year && <input type="hidden" name="year" value={sp.year} />}
        {sp.stage && <input type="hidden" name="stage" value={sp.stage} />}
        <label className="text-sm"><span className="mb-1 block text-muted">{t("lc.col.class")}</span>
          <select name="class" defaultValue={sp.class ?? ""} className="min-h-11 rounded-lg border border-line bg-surface px-3 text-base"><option value="">{t("lc.allClasses")}</option>{b.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <label className="text-sm"><span className="mb-1 block text-muted">{t("lc.col.fees")}</span>
          <select name="money" defaultValue={sp.money ?? ""} className="min-h-11 rounded-lg border border-line bg-surface px-3 text-base"><option value="">{t("lc.tab.all")}</option><option value="cleared">{t("lc.clear.CLEARED")}</option><option value="owing">{t("lc.clear.OUTSTANDING")}</option></select>
        </label>
        <label className="text-sm"><span className="mb-1 block text-muted">{t("common.search")}</span><input name="q" defaultValue={sp.q ?? ""} placeholder={t("lc.searchHint")} className="min-h-11 w-56 rounded-lg border border-line bg-surface px-3 text-base" /></label>
        <button className="min-h-11 rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:bg-canvas">{t("common.filter")}</button>
      </form>

      {b.rows.length === 0 ? <EmptyState>{t("lc.ret.none")}</EmptyState> : (
        <ActionForm action={activateAction} hideSubmit className="space-y-3">
          {canManage && ready.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3">
              <SubmitButton>{t("lc.ret.activate")}</SubmitButton>
              <span className="text-xs text-muted">{t("lc.ret.activateHint")}</span>
            </div>
          )}
          <DataTable head={[canManage && ready.length > 0 ? <SelectAll key="all" name="ids" label={t("lc.selectAll")} /> : "", t("lc.col.student"), t("lc.col.decision"), t("lc.col.placed"), t("lc.col.fees"), t("lc.col.next")]}>
            {b.rows.map((r) => (
              <tr key={r.id}>
                <Td className="w-10">{canManage && r.stage === "READY_TO_ACTIVATE" && <input type="checkbox" name="ids" value={r.id} aria-label={r.name} className="size-4 accent-brand-700" />}</Td>
                <Td><Link href={`/admissions/returning/${r.id}`} className="font-medium text-link hover:underline">{r.name}</Link><span className="block text-xs text-muted">{r.admissionNo}</span></Td>
                <Td><span className="flex flex-wrap items-center gap-2"><OutcomeBadge outcome={r.outcome} t={t} />{r.decidedClassName && <span className="text-muted">→ {r.decidedClassName}</span>}</span></Td>
                <Td className="whitespace-nowrap">{r.className ? `${r.className}${r.streamName ? ` · ${r.streamName}` : ""}` : <span className="text-muted">—</span>}</Td>
                <Td>
                  <ClearanceBadge state={r.clearance} t={t} />
                  {seeMoney && r.firstTermOutstanding ? <span className="mt-1 block text-xs tabular-nums text-muted">{formatMoney(r.firstTermOutstanding)}</span> : null}
                  {r.hasPreviousDebt && <span className="mt-1 block text-xs text-warn">{t("lc.ret.olderDebt")}{seeMoney && r.previousOutstanding ? ` · ${formatMoney(r.previousOutstanding)}` : ""}</span>}
                </Td>
                <Td><span className={r.blocked ? "text-warn" : ""}>{stageLabel(t, r.stage)}</span>{r.department !== "NONE" && <span className="block text-xs text-muted">{deptLabel(t, r.department)}</span>}</Td>
              </tr>
            ))}
          </DataTable>
        </ActionForm>
      )}
      <Pagination page={b.page} pageSize={50} total={b.total} basePath="/admissions/returning" params={{ year: sp.year, class: sp.class, q: sp.q, stage: sp.stage, money: sp.money }} t={t} />
    </>
  );
}
