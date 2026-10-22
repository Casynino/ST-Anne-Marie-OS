import type { Metadata } from "next";
import Link from "next/link";
import { requireContext, getT } from "@/lib/auth/next";
import { db } from "@/lib/db";
import { displayDate, formatDateOnly, todayInTimezone } from "@/lib/dates";
import { formatMoney } from "@/lib/finance/money";
import { returningBoard, REGISTRATION_STAGES } from "@/server/annual-registration";
import { ActionForm, Field } from "@/components/form";
import { RowAction } from "@/components/lifecycle/row-action";
import { SubmitButton } from "@/components/submit-button";
import { SelectAll } from "@/components/lifecycle/select-all";
import { ClearanceBadge, CountTabs, FollowUpForm, OutcomeBadge, deptLabel, stageLabel } from "@/components/lifecycle/parts";
import { DefList, EmptyState, NoAccess, PageHeader, Pagination } from "@/components/ui";
import { Panel } from "@/components/dash/parts";
import { Row } from "@/components/dash/rows";
import { Check, Info } from "lucide-react";
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
  const b = await returningBoard(ctx, { yearId: sp.year, classId: sp.class, stage: sp.stage, q: sp.q, money, notRegistered: sp.notreg === "1", outcome: sp.outcome === "PROMOTED" || sp.outcome === "REPEAT" ? sp.outcome : undefined, page: Number(sp.page) || 1 });
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
    for (const [k, v] of Object.entries({ year: sp.year, class: sp.class, q: sp.q, stage: sp.stage, money: sp.money, notreg: sp.notreg, outcome: sp.outcome, ...extra })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/students/returning?${s}` : "/students/returning";
  };
  const by = b.counts.byStage;
  const ready = b.rows.filter((r) => r.stage === "READY_TO_ACTIVATE");

  const th = "px-3 py-2 text-left text-xs font-medium text-muted";
  const td = "px-3 py-2 align-middle text-[13px]";
  const notes = [windowNote, t(`lc.ret.policy.${b.settings.feePolicy}` as "lc.ret.policy.INFORM_ONLY")].filter(Boolean);

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
  /** The pop-up behind "View": the four steps at a glance, the facts, and the one form this student needs now, with a link to the full page. */
  const quick = (r: Row) => {
    const steps = [[t("lc.step.decision"), true], [t("lc.step.place"), r.classId !== null], [t("lc.step.register"), r.status === "REGISTERED" || r.status === "ACTIVE"], [t("lc.step.join"), r.status === "ACTIVE"]] as const;
    return (
      <div className="space-y-4">
        <p className="flex flex-wrap items-center gap-2 text-sm"><OutcomeBadge outcome={r.outcome} t={t} />{r.decidedClassName && <span className="text-ink">{r.fromClassName} → <strong>{r.decidedClassName}</strong></span>}<ClearanceBadge state={r.clearance} t={t} /></p>
        <ol className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          {steps.map(([label, ok], i) => <li key={label} className={`rounded-lg border px-2.5 py-2 ${ok ? "border-ok/30 bg-ok/5" : "border-line bg-canvas/50"}`}><span className="flex items-center gap-1 text-muted">{ok ? <Check className="size-3.5 text-ok" aria-hidden /> : null}{t("lc.d.step", { n: i + 1 })}</span><span className="mt-0.5 block font-medium text-ink">{label}</span></li>)}
        </ol>
        <DefList items={[
          { label: t("lc.col.placed"), value: r.className ? `${r.className}${r.streamName ? ` · ${r.streamName}` : ""}` : "—" },
          { label: t("lc.col.next"), value: `${stageLabel(t, r.stage)}${r.department !== "NONE" ? ` · ${deptLabel(t, r.department)}` : ""}` },
          ...(seeMoney ? [{ label: t("lc.fee.owed"), value: r.firstTermOutstanding ? formatMoney(r.firstTermOutstanding) : "—" }] : []),
          ...(r.hasPreviousDebt ? [{ label: t("lc.fee.older"), value: seeMoney && r.previousOutstanding ? formatMoney(r.previousOutstanding) : t("lc.ret.olderDebt") }] : []),
        ]} />
        {canManage && r.stage === "NEEDS_PLACEMENT" && <div className="border-t border-line pt-4">{placeForm(r, preferredFor(r))}</div>}
        {canManage && r.stage === "NEEDS_REGISTRATION" && <div className="border-t border-line pt-4">{registerForm(r)}</div>}
        {canManage && r.stage === "READY_TO_ACTIVATE" && <div className="border-t border-line pt-4">{joinForm(r)}</div>}
        <p className="text-right"><Link href={`/students/returning/${r.id}`} className="text-sm font-medium text-link hover:underline">{t("lc.d.openFull")} →</Link></p>
      </div>
    );
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

      {b.counts.notRegistered > 0 && (
        <p role="status" className={`mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-2.5 text-sm ${b.windowClosed ? "border-warn/40 bg-warn/10 text-warn" : "border-line bg-surface text-muted"}`}>
          <span>{b.windowClosed && b.year.registrationClosesOn ? t("lc.nr.bannerClosed", { date: displayDate(b.year.registrationClosesOn, ctx.locale), n: b.counts.notRegistered, c: b.counts.contacted }) : t("lc.nr.banner", { n: b.counts.notRegistered, c: b.counts.contacted })}</span>
          {sp.notreg !== "1" && <Link href={q({ notreg: "1", stage: undefined, page: undefined })} className="font-medium text-link hover:underline">{t("lc.nr.tab")} →</Link>}
        </p>
      )}

      {b.missing > 0 && canManage && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-sm text-warn">
          <span>{t("lc.ret.missing", { n: b.missing })}</span>
          <ActionForm action={createRegistrationsAction} submitLabel={t("lc.ret.createGo")} inline className="inline"><input type="hidden" name="yearId" value={b.year.id} /></ActionForm>
        </div>
      )}

      <Row>
        <Panel className="flex-[3_1_40rem]" title={t("lc.ret.fig.total")}>
          <CountTabs items={[
            { href: q({ stage: undefined, notreg: undefined, outcome: undefined, page: undefined }), label: t("lc.tab.all"), count: b.counts.total, active: !sp.stage && sp.notreg !== "1" && !sp.outcome },
            { href: q({ stage: undefined, notreg: undefined, outcome: "PROMOTED", page: undefined }), label: t("lc.ret.tab.up"), count: b.counts.promoted, active: sp.outcome === "PROMOTED" },
            ...(b.counts.repeat > 0 || sp.outcome === "REPEAT" ? [{ href: q({ stage: undefined, notreg: undefined, outcome: "REPEAT", page: undefined }), label: t("lc.ret.tab.repeat"), count: b.counts.repeat, active: sp.outcome === "REPEAT" }] : []),
            ...(b.counts.notRegistered > 0 ? [{ href: q({ stage: undefined, notreg: "1", outcome: undefined, page: undefined }), label: t("lc.nr.tab"), count: b.counts.notRegistered, active: sp.notreg === "1" }] : []),
            ...REGISTRATION_STAGES.filter((s) => (by[s] ?? 0) > 0).map((s) => ({ href: q({ stage: s, notreg: undefined, outcome: undefined, page: undefined }), label: stageLabel(t, s), count: by[s], active: sp.stage === s })),
          ]} />
          <form method="get" className="mb-4 flex flex-wrap items-end gap-2.5">
            {sp.year && <input type="hidden" name="year" value={sp.year} />}
            {sp.stage && <input type="hidden" name="stage" value={sp.stage} />}{sp.notreg && <input type="hidden" name="notreg" value={sp.notreg} />}{sp.outcome && <input type="hidden" name="outcome" value={sp.outcome} />}
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
                    <th className={th}>{t("lc.col.student")}</th><th className={th}>{t("lc.col.decision")}</th><th className={th}>{t("lc.col.placed")}</th><th className={th}>{t("lc.col.fees")}</th><th className={th}>{t("lc.col.next")}</th><th className={`${th} text-right`}><span className="sr-only">{t("lc.col.action")}</span></th>
                  </tr></thead>
                  <tbody className="divide-y divide-line">
                    {b.rows.map((r) => {
                      return (
                        <tr key={r.id} className="hover:bg-canvas/50">
                          <td className={`${td} w-10`}>{canManage && r.stage === "READY_TO_ACTIVATE" && <input type="checkbox" name="ids" value={r.id} form="bulk-activate" aria-label={r.name} className="size-4 accent-brand-700" />}</td>
                          <td className={td}><Link href={`/students/returning/${r.id}`} className="font-medium text-ink hover:text-link hover:underline">{r.name}</Link><span className="block text-xs tabular-nums text-muted">{r.admissionNo}</span></td>
                          <td className={td}><span className="flex flex-wrap items-center gap-2"><OutcomeBadge outcome={r.outcome} t={t} />{r.decidedClassName && <span className="text-muted">{r.outcome === "REPEAT" ? t("lc.ret.repeatSame", { from: r.decidedClassName }) : `${r.fromClassName} → ${r.decidedClassName}`}</span>}</span></td>
                          <td className={`${td} whitespace-nowrap`}>{r.className ? `${r.className}${r.streamName ? ` · ${r.streamName}` : ""}` : <span className="text-muted">—</span>}</td>
                          <td className={`${td} whitespace-nowrap`}>
                            <ClearanceBadge state={r.clearance} t={t} />
                            {seeMoney && r.firstTermOutstanding ? <span className="mt-1 block text-xs tabular-nums text-muted">{formatMoney(r.firstTermOutstanding)}</span> : null}
                            {r.hasPreviousDebt && <span className="mt-1 block text-xs text-warn">{t("lc.ret.olderDebt")}{seeMoney && r.previousOutstanding ? ` · ${formatMoney(r.previousOutstanding)}` : ""}</span>}
                          </td>
                          <td className={td}><span className={r.blocked ? "text-warn" : "text-ink"}>{stageLabel(t, r.stage)}</span>{r.department !== "NONE" && <span className="block text-xs text-muted">{deptLabel(t, r.department)}</span>}{r.notRegistered && <span className={`block text-xs ${r.followUp?.outcome === "NOT_RETURNING" ? "text-warn" : "text-muted"}`} title={r.followUp?.note ?? undefined}>{r.followUp ? t("lc.nr.last", { outcome: t(`lc.nr.o.${r.followUp.outcome}` as "lc.nr.o.OTHER"), date: displayDate(r.followUp.at, ctx.locale) }) : t("lc.nr.none")}</span>}</td>
                          <td className={`${td} whitespace-nowrap text-right`}>
                            <span className="inline-flex items-center justify-end gap-2">
                              {canManage && r.stage === "NEEDS_PLACEMENT" && <RowAction primary label={t("lc.row.place")} title={t("lc.row.placeTitle", { name: r.name })} closeLabel={t("common.cancel")}>{placeForm(r, preferredFor(r))}</RowAction>}
                              {canManage && r.stage === "NEEDS_REGISTRATION" && <RowAction primary label={t("lc.row.register")} title={t("lc.row.registerTitle", { name: r.name })} closeLabel={t("common.cancel")}>{registerForm(r)}</RowAction>}
                              {canManage && r.stage === "READY_TO_ACTIVATE" && joinForm(r)}
                              {canManage && r.notRegistered && <RowAction link label={t("lc.nr.row")} title={t("lc.nr.title", { name: r.name })} closeLabel={t("common.cancel")}><FollowUpForm id={r.id} t={t} action={followUpAction} /></RowAction>}
                              <RowAction link wide label={t("common.view")} title={r.name} closeLabel={t("common.cancel")}>{quick(r)}</RowAction>
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
          <Pagination page={b.page} pageSize={50} total={b.total} basePath="/students/returning" params={{ year: sp.year, class: sp.class, q: sp.q, stage: sp.stage, money: sp.money, notreg: sp.notreg, outcome: sp.outcome }} t={t} />
        </Panel>
        <Panel className="flex-[1_1_16rem]" title={t("lc.rep.adm.title")} subtitle={b.year.name}>
          <ul className="divide-y divide-line text-sm tabular-nums">
            {([
              [t("lc.rep.adm.eligible"), b.counts.total, q({ stage: undefined, notreg: undefined, page: undefined })],
              [t("lc.rep.adm.submitted"), b.counts.registered, null],
              [t("lc.rep.adm.payment"), b.counts.awaitingPayment, null],
              [t("lc.rep.adm.approval"), by.NEEDS_REGISTRATION ?? 0, q({ stage: "NEEDS_REGISTRATION", notreg: undefined, page: undefined })],
              [t("lc.rep.adm.class"), by.NEEDS_PLACEMENT ?? 0, q({ stage: "NEEDS_PLACEMENT", notreg: undefined, page: undefined })],
              [t("lc.rep.adm.done"), b.counts.registered, null],
              [t("lc.rep.adm.not"), b.counts.notRegistered, q({ notreg: "1", stage: undefined, page: undefined })],
              [t("lc.rep.adm.repeat"), b.counts.repeat, b.counts.repeat > 0 ? q({ outcome: "REPEAT", stage: undefined, notreg: undefined, page: undefined }) : null],
              [t("lc.rep.adm.undecided"), b.counts.undecided, null],
            ] as const).map(([label, n, href]) => (
              <li key={label} className="flex items-baseline justify-between gap-3 py-2">
                {href ? <Link href={href} className="text-ink hover:text-link hover:underline">{label}</Link> : <span>{label}</span>}
                <span className="font-semibold text-ink">{n}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </Row>
    </>
  );
}
