import type { Metadata } from "next";
import Link from "next/link";
import { requireContext, getT } from "@/lib/auth/next";
import { db } from "@/lib/db";
import { displayDate, formatDateOnly, todayInTimezone } from "@/lib/dates";
import { formatMoney } from "@/lib/finance/money";
import { returningBoard, TODO_STAGES, type Stage } from "@/server/annual-registration";
import { ActionForm, Field } from "@/components/form";
import { RowAction } from "@/components/lifecycle/row-action";
import { SubmitButton } from "@/components/submit-button";
import { SelectAll } from "@/components/lifecycle/select-all";
import { ClearanceBadge, CountTabs, FollowUpForm, OutcomeBadge, deptLabel, stageLabel } from "@/components/lifecycle/parts";
import { EmptyState, NoAccess, PageHeader, Pagination } from "@/components/ui";
import { Panel } from "@/components/dash/parts";
import { YearReportPanel } from "@/components/dash/year-report";
import { Row } from "@/components/dash/rows";
import { Info } from "lucide-react";
import { activateAction, confirmRegistrationAction, createRegistrationsAction, followUpAction, placeReturningAction } from "./actions";

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
  // The default list is the work to do now; everything else is one tab away, so finished students never hide the ones who need action.
  const view = sp.view ?? (sp.stage || sp.notreg || sp.outcome ? "all" : "todo");
  const stages: Stage[] | undefined = view === "todo" ? [...TODO_STAGES] : view === "waiting" ? ["WAITING_YEAR_OPEN"] : view === "active" ? ["ACTIVE"] : undefined;
  const b = await returningBoard(ctx, {
    yearId: sp.year, classId: sp.class, stage: sp.stage, stages, q: sp.q, money, notRegistered: view === "notreg" || sp.notreg === "1",
    outcome: view === "repeat" ? "REPEAT" : sp.outcome === "PROMOTED" || sp.outcome === "REPEAT" ? sp.outcome : undefined, page: Number(sp.page) || 1,
  });
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
    for (const [k, v] of Object.entries({ year: sp.year, class: sp.class, q: sp.q, money: sp.money, ...extra })) if (v) p.set(k, v);
    const str = p.toString();
    return str ? `/students/returning?${str}` : "/students/returning";
  };
  const by = b.counts.byStage;
  const ready = b.rows.filter((r) => r.stage === "READY_TO_ACTIVATE");

  const th = "px-3 py-2 text-left text-xs font-medium text-muted";
  const td = "px-3 py-2.5 align-middle text-[13px]";
  const notes = [windowNote, t(`lc.ret.policy.${b.settings.feePolicy}` as "lc.ret.policy.INFORM_ONLY")].filter(Boolean);
  const KNOWN = new Set<string>(["NEEDS_PLACEMENT", "NEEDS_REGISTRATION", "READY_TO_ACTIVATE", "NEEDS_FEE", "WAITING_YEAR_OPEN", "ACTIVE", "NOT_RETURNING"]);
  /** What the office has to do for this student, in one sentence (or "nothing, and why"). */
  const todo = (st: Stage) => (KNOWN.has(st) ? t(`lc.todo.${st}` as "lc.todo.ACTIVE", { year: b.year.name, date: displayDate(b.year.startsOn, ctx.locale) }) : stageLabel(t, st));

  type Row = (typeof b.rows)[number];
  const placeForm = (r: Row, preferred: string) => (
    <ActionForm action={placeReturningAction} submitLabel={t("lc.step.placeGo")} buttonClassName="btn-sm" className="space-y-3">
      <input type="hidden" name="id" value={r.id} />
      <Field name="placement" type="select" label={t("lc.step.placeLabel")} hint={t("lc.step.placeHint")} defaultValue={preferred} placeholder={t("common.select")} required options={b.options.map((o) => ({ value: o.value, label: o.full ? `${o.label} – ${t("adm.place.full")}` : o.label }))} />
      {(can("progression.exception") || can("class.capacity_override")) && (
        <details>
          <summary className="min-h-10 cursor-pointer py-1.5 text-sm text-muted">{t("lc.step.exceptions")}</summary>
          <div className="space-y-3">
            {can("progression.exception") && <Field name="gradeReason" label={t("lc.step.gradeReason")} optionalLabel={t("common.optional")} hint={t("lc.step.gradeReasonHint")} />}
            {can("class.capacity_override") && <><Field name="overrideCapacity" type="checkbox" label={t("adm.enrol.override")} /><Field name="overrideReason" label={t("adm.enrol.overrideReason")} optionalLabel={t("common.optional")} /></>}
          </div>
        </details>
      )}
    </ActionForm>
  );
  const registerForm = (r: Row) => (
    <ActionForm action={confirmRegistrationAction} submitLabel={t("lc.step.registerGo")} buttonClassName="btn-sm" className="space-y-3">
      <input type="hidden" name="id" value={r.id} />
      <Field name="confirmed" type="checkbox" label={t("lc.step.confirmed")} hint={t("lc.step.confirmedHint")} />
      <Field name="note" label={t("lc.bulk.note")} optionalLabel={t("common.optional")} />
    </ActionForm>
  );
  const joinForm = (r: Row) => <ActionForm action={activateAction} submitLabel={t("lc.row.join")} inline plain className="inline"><input type="hidden" name="ids" value={r.id} /></ActionForm>;
  const preferredFor = (r: Row) => {
    const decided = r.decidedClassId ? b.places.find((p) => p.classId === r.decidedClassId) : undefined;
    return r.classId ? (r.streamId ? `${r.classId}|${r.streamId}` : r.classId) : decided ? (decided.streams.length && decided.recommendedStreamId ? `${decided.classId}|${decided.recommendedStreamId}` : decided.classId) : "";
  };
  return (
    <>
      <PageHeader title={t("lc.ret.title")} subtitle={t("lc.ret.sub", { year: b.year.name })} actions={<span className="flex flex-wrap items-center gap-4"><Link href="/students" className="text-sm font-medium text-link hover:underline">{t("student.title")}</Link><Link href="/academic-setup/readiness" className="text-sm font-medium text-link hover:underline">{t("lc.ready.link")}</Link></span>} />

      <p className="mb-4 flex items-start gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-muted"><Info className="mt-0.5 size-4 shrink-0 text-link" aria-hidden /><span>{notes.join(" · ")}</span></p>

      {b.counts.undecided > 0 && (
        <p role="status" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-sm text-warn">
          <span>{t("lc.ret.undecided", { n: b.counts.undecided })}</span>
          {can("progression.read") && <Link href="/academic-office/progression" className="font-medium text-link hover:underline">{t("lc.ret.undecidedLink")} →</Link>}
        </p>
      )}

      {b.counts.notRegistered > 0 && b.windowClosed && b.year.registrationClosesOn && (
        <p role="status" className="mb-4 rounded-xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-sm text-warn">{t("lc.nr.bannerClosed", { date: displayDate(b.year.registrationClosesOn, ctx.locale), n: b.counts.notRegistered, c: b.counts.contacted })}</p>
      )}

      {b.missing > 0 && canManage && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-sm text-warn">
          <span>{t("lc.ret.missing", { n: b.missing })}</span>
          <ActionForm action={createRegistrationsAction} submitLabel={t("lc.ret.createGo")} inline className="inline"><input type="hidden" name="yearId" value={b.year.id} /></ActionForm>
        </div>
      )}

      <YearReportPanel flat t={t} money={(c) => formatMoney(c)} groups={["admissions"]} report={{
        yearName: b.year.name, academic: null, finance: null,
        admissions: { eligible: b.counts.total, registered: b.counts.registered, awaitingPayment: b.counts.awaitingPayment, awaitingApproval: by.NEEDS_REGISTRATION ?? 0, awaitingClass: by.NEEDS_PLACEMENT ?? 0, notRegistered: b.counts.notRegistered, repeat: b.counts.repeat, undecided: b.counts.undecided },
      }} />

      <Row>
        <Panel className="flex-[1_1_100%]" title={t("lc.ret.fig.total")}>
          <CountTabs items={[
            { href: q({ view: "todo" }), label: t("lc.view.todo"), count: b.counts.todo, active: view === "todo" },
            { href: q({ view: "waiting" }), label: t("lc.view.waiting"), count: b.counts.waiting, active: view === "waiting" },
            ...(b.counts.active > 0 ? [{ href: q({ view: "active" }), label: t("lc.view.active"), count: b.counts.active, active: view === "active" }] : []),
            ...(b.counts.notRegistered > 0 ? [{ href: q({ view: "notreg" }), label: t("lc.nr.tab"), count: b.counts.notRegistered, active: view === "notreg" }] : []),
            ...(b.counts.repeat > 0 ? [{ href: q({ view: "repeat" }), label: t("lc.view.repeat"), count: b.counts.repeat, active: view === "repeat" }] : []),
            ...((by.NOT_RETURNING ?? 0) > 0 ? [{ href: q({ view: "all", stage: "NOT_RETURNING" }), label: stageLabel(t, "NOT_RETURNING"), count: by.NOT_RETURNING, active: sp.stage === "NOT_RETURNING" }] : []),
            { href: q({ view: "all" }), label: t("lc.tab.all"), count: b.counts.total, active: view === "all" && !sp.stage },
          ]} />
          <p className="-mt-1 mb-4 text-sm text-muted">{t(`lc.view.hint.${sp.stage === "NOT_RETURNING" ? "all" : view}` as "lc.view.hint.all", { year: b.year.name, date: displayDate(b.year.startsOn, ctx.locale) })}</p>
          <form method="get" className="mb-4 flex flex-wrap items-end gap-2.5">
            {sp.year && <input type="hidden" name="year" value={sp.year} />}
            <input type="hidden" name="view" value={view} />
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

          {b.rows.length === 0 ? <EmptyState>{view === "todo" ? t("lc.view.todoEmpty") : t("lc.ret.none")}</EmptyState> : (
            <>
              {canManage && ready.length > 0 && (
                <ActionForm id="bulk-activate" action={activateAction} hideSubmit className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-canvas/50 px-3 py-2.5">
                  <SubmitButton>{t("lc.ret.activate")}</SubmitButton>
                  <span className="text-xs text-muted">{t("lc.ret.activateHint")}</span>
                </ActionForm>
              )}
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full min-w-[56rem] text-sm">
                  <thead><tr className="border-y border-line">
                    <th className={`${th} w-10`}>{canManage && ready.length > 0 ? <SelectAll formId="bulk-activate" name="ids" label={t("lc.selectAll")} /> : null}</th>
                    <th className={th}>{t("lc.col.student")}</th><th className={th}>{t("lc.col.decision")}</th><th className={th}>{t("lc.col.placed")}</th><th className={th}>{t("lc.col.fees")}</th><th className={th}>{t("lc.col.todo")}</th><th className={`${th} text-right`}><span className="sr-only">{t("lc.col.action")}</span></th>
                  </tr></thead>
                  <tbody className="divide-y divide-line">
                    {b.rows.map((r) => {
                      const needs = r.stage === "NEEDS_PLACEMENT" || r.stage === "NEEDS_REGISTRATION" || r.stage === "READY_TO_ACTIVATE";
                      return (
                        <tr key={r.id} className="hover:bg-canvas/50">
                          <td className={`${td} w-10`}>{canManage && r.stage === "READY_TO_ACTIVATE" && <input type="checkbox" name="ids" value={r.id} form="bulk-activate" aria-label={r.name} className="size-4 accent-brand-700" />}</td>
                          <td className={td}><Link href={`/students/returning/${r.id}`} className="font-medium text-ink hover:text-link hover:underline">{r.name}</Link><span className="block text-xs tabular-nums text-muted">{r.admissionNo}</span></td>
                          <td className={td}><OutcomeBadge outcome={r.outcome} t={t} /><span className="mt-1 block text-xs text-muted">{r.decidedClassName ? (r.outcome === "REPEAT" ? t("lc.ret.repeatSame", { from: r.decidedClassName }) : `${r.fromClassName} → ${r.decidedClassName}`) : "—"}</span></td>
                          <td className={`${td} whitespace-nowrap`}>{r.className ? `${r.className}${r.streamName ? ` · ${r.streamName}` : ""}` : <span className="text-muted">{t("lc.ret.notPlaced")}</span>}</td>
                          <td className={`${td} whitespace-nowrap`}>
                            <ClearanceBadge state={r.clearance} t={t} />
                            {seeMoney && r.firstTermOutstanding ? <span className="mt-1 block text-xs tabular-nums text-muted">{formatMoney(r.firstTermOutstanding)}</span> : null}
                            {r.hasPreviousDebt && <span className="mt-1 block text-xs text-warn">{t("lc.ret.olderDebt")}{seeMoney && r.previousOutstanding ? ` · ${formatMoney(r.previousOutstanding)}` : ""}</span>}
                          </td>
                          <td className={`${td} max-w-64`}>
                            <span className={needs ? "font-medium text-ink" : r.blocked ? "text-warn" : "text-muted"}>{todo(r.stage)}</span>
                            {r.department !== "NONE" && needs && <span className="block text-xs text-muted">{deptLabel(t, r.department)}</span>}
                            {r.notRegistered && <span className={`block text-xs ${r.followUp?.outcome === "NOT_RETURNING" ? "text-warn" : "text-muted"}`} title={r.followUp?.note ?? undefined}>{r.followUp ? t("lc.nr.last", { outcome: t(`lc.nr.o.${r.followUp.outcome}` as "lc.nr.o.OTHER"), date: displayDate(r.followUp.at, ctx.locale) }) : t("lc.nr.none")}</span>}
                          </td>
                          <td className={`${td} whitespace-nowrap text-right`}>
                            <span className="inline-flex items-center justify-end gap-3">
                              {canManage && r.stage === "NEEDS_PLACEMENT" && <RowAction primary label={t("lc.row.place")} title={t("lc.row.placeTitle", { name: r.name })} closeLabel={t("common.cancel")}>{placeForm(r, preferredFor(r))}</RowAction>}
                              {canManage && r.stage === "NEEDS_REGISTRATION" && <RowAction primary label={t("lc.row.register")} title={t("lc.row.registerTitle", { name: r.name })} closeLabel={t("common.cancel")}>{registerForm(r)}</RowAction>}
                              {canManage && r.stage === "READY_TO_ACTIVATE" && joinForm(r)}
                              {canManage && r.notRegistered && <RowAction link label={t("lc.nr.row")} title={t("lc.nr.title", { name: r.name })} closeLabel={t("common.cancel")}><FollowUpForm id={r.id} t={t} action={followUpAction} /></RowAction>}
                              <Link href={`/students/returning/${r.id}`} className="text-[13px] font-medium text-link hover:underline">{t("lc.row.open")} →</Link>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <Pagination page={b.page} pageSize={50} total={b.total} basePath="/students/returning" params={{ year: sp.year, class: sp.class, q: sp.q, view, stage: sp.stage, money: sp.money }} t={t} />
        </Panel>
      </Row>
    </>
  );
}
