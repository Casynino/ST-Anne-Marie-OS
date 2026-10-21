import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDate, displayDateTime } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { listClasses } from "@/server/academics";
import { loadDesk, INTERVIEW_STATES, type DeskFilters } from "@/server/admission-desk";
import { listReviewers } from "@/server/admission-review";
import { AdmissionsNav } from "@/components/admissions/subnav";
import { ExportMenu } from "@/components/export-menu";
import { LinkButton, NoAccess, PageHeader, Pagination } from "@/components/ui";
import { inputClass } from "@/components/form";
import { workflowProgress } from "@/lib/admissions/rules";
import { DeskTable, type DeskLabels, type DeskLine } from "./desk-table";
import { bulkDeskAction, quickDecisionAction } from "./actions";
import { Pipeline, type PipelineTab } from "./pipeline";
import { DeskFilters as FilterRow } from "./desk-filters";

export const metadata: Metadata = { title: "Admissions" };
type Search = { q?: string; state?: string; classId?: string; from?: string; to?: string; interview?: string; assigned?: string; source?: string; attention?: string; page?: string };
const TONE = { NEW: "neutral", UNDER_REVIEW: "brand", NEEDS_INFO: "warn", REVIEWED: "brand", INTERVIEW_SCHEDULED: "brand", AWAITING_DECISION: "warn", ACCEPTED: "ok", ENROLLED: "ok", REJECTED: "bad", WITHDRAWN: "neutral" } as const;

/**
 * The Admissions Office desk: every application, wherever it came from, with the one status that says where it stands, how complete it is,
 * its interview and who looks after it. Online applications are here by themselves. Tick several to review or assign them together.
 */
export default async function AdmissionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("admission.read")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  const page = Math.max(1, Number(sp.page) || 1);
  const filters: DeskFilters = { q: sp.q, state: sp.state, classId: sp.classId, from: sp.from, to: sp.to, interview: sp.interview, assigned: sp.assigned, source: sp.source, attention: sp.attention === "1" };
  const [desk, school, classes, reviewers] = await Promise.all([
    loadDesk(ctx, filters, page),
    getSchoolBasics(ctx.schoolId),
    can("academic.read") ? listClasses(ctx) : [],
    listReviewers(ctx),
  ]);
  const c = desk.counts;
  const keep = { q: sp.q, classId: sp.classId, from: sp.from, to: sp.to, interview: sp.interview, assigned: sp.assigned, source: sp.source };
  const href = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...keep, ...extra }).filter(([, v]) => !!v) as [string, string][]);
    return p.size ? `/admissions?${p}` : "/admissions";
  };
  const COLOR = { NEW: "var(--color-muted)", UNDER_REVIEW: "var(--color-indigo)", NEEDS_INFO: "var(--color-warn)", AWAITING_INTERVIEW: "var(--color-brand-300)", INTERVIEW_SCHEDULED: "var(--color-brand-400)", AWAITING_DECISION: "var(--color-sun-600)", ACCEPTED: "var(--color-brand-600)", ENROLLED: "var(--color-brand-800)", CLOSED: "var(--color-bad)" } as const;
  const tabs: PipelineTab[] = [
    { key: "all", label: t("adm.stage.all"), n: c.total, to: href({}), on: !sp.state && sp.attention !== "1", color: "var(--color-line)" },
    ...(["NEW", "UNDER_REVIEW", "NEEDS_INFO", "AWAITING_INTERVIEW", "INTERVIEW_SCHEDULED", "AWAITING_DECISION", "ACCEPTED", "ENROLLED", "CLOSED"] as const).map((s) => ({
      key: s, label: t(`adm.tab.${s}`), color: COLOR[s], to: href({ state: s }), on: sp.state === s,
      n: s === "AWAITING_INTERVIEW" ? c.awaitingInterview : s === "CLOSED" ? c.closed : c[s],
      // closed and enrolled applications are not part of the working pipeline, so they are not in the bar
      ...(s === "CLOSED" || s === "ENROLLED" ? { bar: 0 } : {}),
      // "to interview" is the part of Reviewed that still has no interview, so the bar uses all of Reviewed there and counts nobody twice
      ...(s === "AWAITING_INTERVIEW" ? { bar: c.REVIEWED } : {}),
    })),
    { key: "attention", label: t("adm.tab.ATTENTION"), n: c.attention, to: href({ attention: "1" }), on: sp.attention === "1", color: "var(--color-warn)", alert: true },
  ];
  // Accept and Decline are on every application still under consideration. Accept is available where a decision is next (reviewed, or waiting for a decision); on the others it is greyed with the reason. The service checks every condition again.
  const OPEN_STATES = ["NEW", "UNDER_REVIEW", "NEEDS_INFO", "REVIEWED", "INTERVIEW_SCHEDULED", "AWAITING_DECISION"] as const;
  const decideOf = (state: string): "none" | "ready" | "wait" => {
    if (!can("admission.review") || !(OPEN_STATES as readonly string[]).includes(state)) return "none";
    return state === "REVIEWED" || state === "AWAITING_DECISION" ? "ready" : "wait";
  };
  const lines: DeskLine[] = desk.rows.map((r) => ({
    id: r.id, applicationNo: r.applicationNo, name: r.name, className: r.className, guardian: r.guardianName, phone: r.guardianPhone, submitted: displayDate(r.submittedAt, ctx.locale), online: r.source === "ONLINE",
    state: r.state, stateLabel: t(`adm.state.${r.state}`), stateTone: TONE[r.state], step: workflowProgress(r.state), className2: r.className ?? t("adm.noClass"), decide: decideOf(r.state), canDecline: decideOf(r.state) !== "none", waitWhy: decideOf(r.state) === "wait" ? t(`adm.q.wait.${r.state as "NEW"}`) : "", stepLabel: t("adm.progress", { n: String(workflowProgress(r.state)) }),
    interviewLabel: t(`adm.ivs.${r.interview}`), interviewDetail: r.interviewAt ? displayDateTime(r.interviewAt, school.timezone, ctx.locale) : null,
    percent: r.completeness.percent,
    missing: r.completeness.missing.map((k) => (k.startsWith("doc:") ? t(`doc.type.${k.slice(4) as "OTHER"}`) : k === "class" ? t("adm.missing.class") : t("adm.missing.contact"))),
    assignedTo: r.assignedTo, attention: r.attention.map((a) => t(`adm.attn.${a}`)),
  }));
  const labels: DeskLabels = {
    applicant: t("adm.applicant"), guardian: t("adm.guardian"), class: t("adm.classApplied"), submitted: t("adm.appliedOn"), complete: t("adm.col.complete"), interview: t("adm.col.interview"), assigned: t("adm.col.assigned"), status: t("common.status"),
    online: t("adm.online"), selectAll: t("adm.bulk.selectAll"), start: t("adm.bulk.start"), review: t("adm.bulk.review"), assign: t("adm.bulk.assign"), assignTo: t("adm.bulk.assignTo"), go: t("adm.bulk.go"), cancel: t("adm.bulk.cancel"), dismiss: t("adm.bulk.dismiss"),
    never: t("adm.bulk.never"), unassigned: t("adm.unassigned"), choose: t("common.select"),
    quick: {
      column: t("adm.col.action"), view: t("common.view"), accept: t("adm.q.accept"), decline: t("adm.q.decline"),
      acceptQ: t("adm.accept.confirm", { name: "{name}", class: "{class}" }), acceptAfter: t("adm.accept.after"), declineQ: t("adm.q.decline.q", { name: "{name}" }), declineReason: t("adm.q.decline.reason"), declineGo: t("adm.q.decline.go"),
      confirm: t("adm.accept.go"), open: t("adm.q.open"), cancel: t("adm.bulk.cancel"),
    },
    selected: t("adm.bulk.selected", { n: "{n}" }), selectRow: t("adm.bulk.selectRow", { name: "{name}" }),
    confirm: { START_REVIEW: t("adm.bulk.confirm.START_REVIEW", { n: "{n}" }), MARK_REVIEWED: t("adm.bulk.confirm.MARK_REVIEWED", { n: "{n}" }), ASSIGN: t("adm.bulk.confirm.ASSIGN", { n: "{n}" }) },
    done: t("adm.bulk.done", { n: "{n}" }), unchanged: t("adm.bulk.unchanged", { n: "{n}" }), failed: t("adm.bulk.failed", { n: "{n}" }),
  };
  const filtersOn = !!(sp.q || sp.classId || sp.from || sp.to || sp.interview || sp.assigned || sp.source);
  const SEL = `${inputClass} !min-h-10 !w-auto !py-1.5 !text-sm`;
  const exportQuery = new URLSearchParams({ desk: "1", ...Object.fromEntries(Object.entries({ ...keep, state: sp.state, attention: sp.attention }).filter(([, v]) => !!v) as [string, string][]) });

  return (
    <>
      <PageHeader title={t("adm.title")} actions={<div className="flex flex-wrap items-center gap-2">{can("admission.read") && <ExportMenu base={`/api/export/admissions?${exportQuery}`} t={t} />}{can("admission.create") && <LinkButton href="/admissions/new"><Plus className="size-4" aria-hidden /> {t("adm.new")}</LinkButton>}</div>} />
      <AdmissionsNav ctx={ctx} t={t} current="/admissions" />
      <Pipeline tabs={tabs} label={t("common.status")} />
      <FilterRow resetHref="/admissions" active={filtersOn} clearLabel={t("common.clear")} moreLabel={t("adm.f.more")} moreOpen={!!(sp.from || sp.to || sp.source)}
        more={<>
          <label className="flex items-center gap-2 text-sm text-muted">{t("adm.f.from.short")}<input type="date" name="from" defaultValue={sp.from} aria-label={t("adm.f.from")} className={SEL} /></label>
          <label className="flex items-center gap-2 text-sm text-muted">{t("adm.f.to.short")}<input type="date" name="to" defaultValue={sp.to} aria-label={t("adm.f.to")} className={SEL} /></label>
          <select name="source" defaultValue={sp.source ?? ""} aria-label={t("adm.channel")} className={SEL}>
            <option value="">{t("adm.f.anyChannel")}</option>
            <option value="ONLINE">{t("adm.channel.ONLINE")}</option>
            <option value="STAFF">{t("adm.channel.STAFF")}</option>
          </select>
        </>}
      >
        {sp.state && <input type="hidden" name="state" value={sp.state} />}
        {sp.attention === "1" && <input type="hidden" name="attention" value="1" />}
        <input type="search" name="q" defaultValue={sp.q} placeholder={t("adm.f.search.ph")} aria-label={t("common.search")} className={`${inputClass} !min-h-10 min-w-48 flex-1 !py-1.5 !text-sm`} />
        <select name="classId" defaultValue={sp.classId ?? ""} aria-label={t("adm.f.class")} className={SEL}>
          <option value="">{t("adm.f.allClasses")}</option>
          {classes.filter((x) => x.isActive).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select name="interview" defaultValue={sp.interview ?? ""} aria-label={t("adm.f.interview")} className={SEL}>
          <option value="">{t("adm.f.anyInterview")}</option>
          {INTERVIEW_STATES.map((st) => <option key={st} value={st}>{t(`adm.ivs.${st}`)}</option>)}
        </select>
        <select name="assigned" defaultValue={sp.assigned ?? ""} aria-label={t("adm.f.assigned")} className={SEL}>
          <option value="">{t("adm.f.anyone")}</option>
          <option value="me">{t("adm.f.assigned.me")}</option>
          <option value="none">{t("adm.f.assigned.none")}</option>
          {reviewers.filter((r) => r.id !== ctx.userId).map((r) => <option key={r.id} value={r.id}>{r.fullName}</option>)}
        </select>
        <button className="inline-flex min-h-10 items-center rounded-md border border-line px-3 text-sm font-semibold hover:border-brand-500">{t("common.filter")}</button>
      </FilterRow>
      <DeskTable rows={lines} labels={labels} reviewers={reviewers} canVerify={can("admission.documents.verify")} canAssign={can("admission.review")} action={bulkDeskAction} quick={quickDecisionAction} empty={t("adm.none")} />
      <Pagination page={desk.page} pageSize={desk.pageSize} total={desk.total} basePath="/admissions" params={{ ...keep, state: sp.state, attention: sp.attention }} t={t} />
    </>
  );
}
