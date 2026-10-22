import type { Metadata } from "next";
import Link from "next/link";
import { requireContext, getT } from "@/lib/auth/next";
import { db } from "@/lib/db";
import { displayDate, formatDateOnly, todayInTimezone } from "@/lib/dates";
import { formatMoney } from "@/lib/finance/money";
import { returningBoard, REGISTRATION_STAGES } from "@/server/annual-registration";
import { ActionForm } from "@/components/form";
import { SubmitButton } from "@/components/submit-button";
import { SelectAll } from "@/components/lifecycle/select-all";
import { ClearanceBadge, CountTabs, OutcomeBadge, deptLabel, stageLabel } from "@/components/lifecycle/parts";
import { EmptyState, NoAccess, PageHeader, Pagination } from "@/components/ui";
import { ColorBars, DonutStat, GradientTile, Panel } from "@/components/dash/parts";
import { Row } from "@/components/dash/rows";
import { CheckCircle2, ClipboardCheck, GraduationCap, Hourglass, Info, Repeat2, Wallet } from "lucide-react";
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
  if (!b.year) return <><PageHeader title={t("lc.ret.title")} /><EmptyState>{t("lc.noNextYear")}</EmptyState></>;

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
    return s ? `/students/returning?${s}` : "/students/returning";
  };
  const by = b.counts.byStage;
  const ready = b.rows.filter((r) => r.stage === "READY_TO_ACTIVATE");

  const STAGE_COLOR: Record<string, string> = { NEEDS_PLACEMENT: "#ff8574", NEEDS_REGISTRATION: "#14a3b8", NEEDS_FEE: "#f3b94c", READY_TO_ACTIVATE: "#8b80ff", WAITING_YEAR_OPEN: "#a9a0ff", ACTIVE: "#2fd08f", NOT_RETURNING: "#4b5a52" };
  const stageSegments = REGISTRATION_STAGES.filter((s) => (by[s] ?? 0) > 0).map((s) => ({ label: stageLabel(t, s), value: by[s] ?? 0, color: STAGE_COLOR[s] ?? "#4b5a52" }));
  const rooms = b.places.filter((p) => p.capacity !== null);
  const th = "px-4 py-2.5 text-left text-[13px] font-medium text-muted";
  const td = "px-4 py-2.5 align-middle";
  const notes = [windowNote, t(`lc.ret.policy.${b.settings.feePolicy}` as "lc.ret.policy.INFORM_ONLY")].filter(Boolean);

  return (
    <>
      <PageHeader title={t("lc.ret.title")} subtitle={t("lc.ret.sub", { year: b.year.name })} actions={<span className="flex flex-wrap items-center gap-4"><Link href="/students" className="text-sm font-medium text-link hover:underline">{t("student.title")}</Link><Link href="/academic-setup/readiness" className="text-sm font-medium text-link hover:underline">{t("lc.ready.link")}</Link></span>} />

      <p className="mb-4 flex items-start gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-muted"><Info className="mt-0.5 size-4 shrink-0 text-link" aria-hidden /><span>{notes.join(" · ")}</span></p>

      {b.missing > 0 && canManage && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-sm text-warn">
          <span>{t("lc.ret.missing", { n: b.missing })}</span>
          <ActionForm action={createRegistrationsAction} submitLabel={t("lc.ret.createGo")} inline className="inline"><input type="hidden" name="yearId" value={b.year.id} /></ActionForm>
        </div>
      )}

      <ul className="mb-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11.5rem,1fr))]">
        <li><GradientTile icon={Repeat2} tone="orange" label={t("lc.ret.fig.total")} value={b.counts.total} /></li>
        <li><GradientTile icon={ClipboardCheck} tone={by.NEEDS_PLACEMENT ? "rose" : "green"} label={t("lc.stage.NEEDS_PLACEMENT")} value={by.NEEDS_PLACEMENT ?? 0} /></li>
        <li><GradientTile icon={GraduationCap} tone="teal" label={t("lc.stage.NEEDS_REGISTRATION")} value={by.NEEDS_REGISTRATION ?? 0} /></li>
        <li><GradientTile icon={Wallet} tone="violet" label={t("lc.stage.NEEDS_FEE")} value={by.NEEDS_FEE ?? 0} /></li>
        <li><GradientTile icon={Hourglass} tone="indigo" label={t("lc.stage.READY_TO_ACTIVATE")} value={(by.READY_TO_ACTIVATE ?? 0) + (by.WAITING_YEAR_OPEN ?? 0)} /></li>
        <li><GradientTile icon={CheckCircle2} tone="green" label={t("lc.stage.ACTIVE")} value={by.ACTIVE ?? 0} /></li>
      </ul>

      <Row>
        <Panel className="flex-[3_1_40rem]" title={t("lc.ret.fig.total")}>
          <CountTabs items={[
            { href: q({ stage: undefined, page: undefined }), label: t("lc.tab.all"), count: b.counts.total, active: !sp.stage },
            ...REGISTRATION_STAGES.filter((s) => (by[s] ?? 0) > 0).map((s) => ({ href: q({ stage: s, page: undefined }), label: stageLabel(t, s), count: by[s], active: sp.stage === s })),
          ]} />
          <form method="get" className="mb-4 flex flex-wrap items-end gap-2.5">
            {sp.year && <input type="hidden" name="year" value={sp.year} />}
            {sp.stage && <input type="hidden" name="stage" value={sp.stage} />}
            <label className="text-xs text-muted"><span className="mb-1 block">{t("lc.col.class")}</span>
              <select name="class" defaultValue={sp.class ?? ""} className="min-h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink"><option value="">{t("lc.allClasses")}</option>{b.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </label>
            <label className="text-xs text-muted"><span className="mb-1 block">{t("lc.col.fees")}</span>
              <select name="money" defaultValue={sp.money ?? ""} className="min-h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink"><option value="">{t("lc.tab.all")}</option><option value="cleared">{t("lc.clear.CLEARED")}</option><option value="owing">{t("lc.clear.OUTSTANDING")}</option></select>
            </label>
            <label className="min-w-44 flex-1 text-xs text-muted"><span className="mb-1 block">{t("common.search")}</span><input name="q" defaultValue={sp.q ?? ""} placeholder={t("lc.searchHint")} className="min-h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink" /></label>
            <button className="btn-secondary min-h-10 px-4 text-sm font-medium">{t("common.filter")}</button>
          </form>

          {b.rows.length === 0 ? <EmptyState>{t("lc.ret.none")}</EmptyState> : (
            <ActionForm action={activateAction} hideSubmit className="space-y-3">
              {canManage && ready.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-canvas/50 px-3 py-2.5">
                  <SubmitButton>{t("lc.ret.activate")}</SubmitButton>
                  <span className="text-xs text-muted">{t("lc.ret.activateHint")}</span>
                </div>
              )}
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead><tr className="border-y border-line">
                    <th className={`${th} w-10`}>{canManage && ready.length > 0 ? <SelectAll name="ids" label={t("lc.selectAll")} /> : null}</th>
                    <th className={th}>{t("lc.col.student")}</th><th className={th}>{t("lc.col.decision")}</th><th className={th}>{t("lc.col.placed")}</th><th className={th}>{t("lc.col.fees")}</th><th className={th}>{t("lc.col.next")}</th>
                  </tr></thead>
                  <tbody className="divide-y divide-line">
                    {b.rows.map((r) => (
                      <tr key={r.id} className="hover:bg-canvas/50">
                        <td className={`${td} w-10`}>{canManage && r.stage === "READY_TO_ACTIVATE" && <input type="checkbox" name="ids" value={r.id} aria-label={r.name} className="size-4 accent-brand-700" />}</td>
                        <td className={td}><Link href={`/students/returning/${r.id}`} className="font-medium text-ink hover:text-link hover:underline">{r.name}</Link><span className="block text-xs tabular-nums text-muted">{r.admissionNo}</span></td>
                        <td className={td}><span className="flex flex-wrap items-center gap-2"><OutcomeBadge outcome={r.outcome} t={t} />{r.decidedClassName && <span className="text-muted">→ {r.decidedClassName}</span>}</span></td>
                        <td className={`${td} whitespace-nowrap`}>{r.className ? `${r.className}${r.streamName ? ` · ${r.streamName}` : ""}` : <span className="text-muted">—</span>}</td>
                        <td className={td}>
                          <ClearanceBadge state={r.clearance} t={t} />
                          {seeMoney && r.firstTermOutstanding ? <span className="mt-1 block text-xs tabular-nums text-muted">{formatMoney(r.firstTermOutstanding)}</span> : null}
                          {r.hasPreviousDebt && <span className="mt-1 block text-xs text-warn">{t("lc.ret.olderDebt")}{seeMoney && r.previousOutstanding ? ` · ${formatMoney(r.previousOutstanding)}` : ""}</span>}
                        </td>
                        <td className={td}><span className={r.blocked ? "text-warn" : "text-ink"}>{stageLabel(t, r.stage)}</span>{r.department !== "NONE" && <span className="block text-xs text-muted">{deptLabel(t, r.department)}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ActionForm>
          )}
          <Pagination page={b.page} pageSize={50} total={b.total} basePath="/students/returning" params={{ year: sp.year, class: sp.class, q: sp.q, stage: sp.stage, money: sp.money }} t={t} />
        </Panel>

        <div className="flex flex-[1_1_19rem] flex-col gap-4">
          {stageSegments.length > 0 && (
            <Panel title={t("lc.ret.whereTitle")}>
              <DonutStat label={t("lc.ret.whereTitle")} center={b.counts.total} caption={t("lc.ret.fig.total")} segments={stageSegments} />
            </Panel>
          )}
          {seeMoney && b.counts.total > 0 && (
            <Panel title={t("lc.col.fees")}>
              <DonutStat label={t("lc.col.fees")} center={b.counts.total} caption={t("lc.col.fees")} segments={[{ label: t("lc.clear.CLEARED"), value: b.counts.cleared, color: "#2fd08f" }, { label: t("lc.clear.OUTSTANDING"), value: b.counts.owing, color: "#f3b94c" }]} />
            </Panel>
          )}
          {rooms.length > 0 && (
            <Panel title={t("lc.ret.placesTitle", { year: b.year.name })} subtitle={t("lc.ret.placesSub")}>
              <ColorBars label={t("lc.ret.placesTitle", { year: b.year.name })} max={Math.max(...rooms.map((p) => p.capacity ?? 0))} labelWidth="5.5rem" items={rooms.map((p) => ({ label: p.name, value: p.inClass + p.reserved, mark: p.capacity }))} />
            </Panel>
          )}
        </div>
      </Row>
    </>
  );
}
