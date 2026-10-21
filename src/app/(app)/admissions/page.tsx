import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDate, displayDateTime } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { listClasses } from "@/server/academics";
import { loadDesk, INTERVIEW_STATES, STAGE_NAMES, type DeskFilters, type DeskRow } from "@/server/admission-desk";
import { upcomingInterviewSlots } from "@/server/interviews";
import { listReviewers } from "@/server/admission-review";
import { AdmissionsNav } from "@/components/admissions/subnav";
import { ExportMenu } from "@/components/export-menu";
import { LinkButton, NoAccess, PageHeader, Pagination } from "@/components/ui";
import { inputClass } from "@/components/form";
import { stageOf, workflowProgress, type Stage, type WorkflowState } from "@/lib/admissions/rules";
import { DeskTable, type DeskLabels, type DeskLine } from "./desk-table";
import { bulkDeskAction, quickDecisionAction } from "./actions";
import { Pipeline, type PipelineTab } from "./pipeline";
import { DeskFilters as FilterRow } from "./desk-filters";

export const metadata: Metadata = { title: "Admissions" };
type Search = { q?: string; state?: string; stage?: string; classId?: string; from?: string; to?: string; interview?: string; assigned?: string; source?: string; attention?: string; page?: string };
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
  const filters: DeskFilters = { q: sp.q, state: sp.state, stage: sp.stage, classId: sp.classId, from: sp.from, to: sp.to, interview: sp.interview, assigned: sp.assigned, source: sp.source, attention: sp.attention === "1" };
  // Which list this is: under review (the default), the interview, or accepted. A status chosen in the tabs belongs to one of them.
  const STATE_STAGE: Record<string, Stage> = { AWAITING_INTERVIEW: "interview", CLOSED: "closed" };
  const stage: Stage = sp.state ? STATE_STAGE[sp.state] ?? stageOf(sp.state as WorkflowState) : (STAGE_NAMES as readonly string[]).includes(sp.stage ?? "") ? (sp.stage as Stage) : "review";
  const [desk, school, classes, reviewers, slotRows] = await Promise.all([
    loadDesk(ctx, filters, page),
    getSchoolBasics(ctx.schoolId),
    can("academic.read") ? listClasses(ctx) : [],
    listReviewers(ctx),
    stage === "interview" && can("admission.interview.manage") ? upcomingInterviewSlots(ctx) : [],
  ]);
  const c = desk.counts;
  const keep = { q: sp.q, classId: sp.classId, from: sp.from, to: sp.to, interview: sp.interview, assigned: sp.assigned, source: sp.source };
  const href = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...keep, ...extra }).filter(([, v]) => !!v) as [string, string][]);
    return p.size ? `/admissions?${p}` : "/admissions";
  };
  // The enrolled and closed lists are reached from the tabs; their "All" goes back to the list under review.
  const inList = stage === "review" || stage === "interview" || stage === "accepted";
  const listStage: "review" | "interview" | "accepted" = inList ? (stage as "review") : "review";
  const stageHref = (st: Stage) => (st === "review" ? "/admissions" : `/admissions?stage=${st}`);
  const COLOR = { review: "var(--color-indigo)", interview: "var(--color-brand-400)", accepted: "var(--color-brand-700)" } as const;
  const mk = (key: string, label: string, n: number, to: string, on: boolean, extra: Partial<PipelineTab> = {}): PipelineTab => ({ key, label, n, to, on, color: "var(--color-muted)", ...extra });
  const onAll = !sp.state && sp.attention !== "1";
  const tabs: PipelineTab[] = [
    mk("all", t("adm.stage.all"), c.stages[listStage], href({ stage: listStage === "review" ? undefined : listStage }), onAll && inList),
    ...(stage === "review" ? [mk("NEW", t("adm.tab.NEW"), c.NEW, href({ state: "NEW" }), sp.state === "NEW"), mk("UNDER_REVIEW", t("adm.tab.UNDER_REVIEW"), c.UNDER_REVIEW, href({ state: "UNDER_REVIEW" }), sp.state === "UNDER_REVIEW"), mk("NEEDS_INFO", t("adm.tab.NEEDS_INFO"), c.NEEDS_INFO, href({ state: "NEEDS_INFO" }), sp.state === "NEEDS_INFO", { color: "var(--color-warn)" })] : []),
    ...(stage === "interview" ? [mk("AWAITING_INTERVIEW", t("adm.tab.NODATE"), c.awaitingInterview, href({ state: "AWAITING_INTERVIEW" }), sp.state === "AWAITING_INTERVIEW", { color: "var(--color-warn)" }), mk("INTERVIEW_SCHEDULED", t("adm.tab.INTERVIEW_SCHEDULED"), c.INTERVIEW_SCHEDULED, href({ state: "INTERVIEW_SCHEDULED" }), sp.state === "INTERVIEW_SCHEDULED"), mk("AWAITING_DECISION", t("adm.tab.AWAITING_DECISION"), c.AWAITING_DECISION, href({ state: "AWAITING_DECISION" }), sp.state === "AWAITING_DECISION")] : []),
    mk("attention", t("adm.tab.ATTENTION"), c.attention, href({ attention: "1", stage: listStage === "review" ? undefined : listStage }), sp.attention === "1", { color: "var(--color-warn)", alert: true }),
    mk("ENROLLED", t("adm.tab.ENROLLED"), c.ENROLLED, href({ state: "ENROLLED" }), sp.state === "ENROLLED", { color: "var(--color-brand-800)" }),
    mk("CLOSED", t("adm.tab.CLOSED"), c.closed, href({ state: "CLOSED" }), sp.state === "CLOSED", { color: "var(--color-bad)" }),
  ];
  // The bar shows the three lists an application moves through; the nav shows how many are in each.
  const segments = (["review", "interview", "accepted"] as const).map((st) => ({ key: st, label: t(`adm.nav.${st === "review" ? "applications" : st === "interview" ? "stageInterview" : "stageAccepted"}` as "adm.nav.applications"), n: c.stages[st], to: stageHref(st), color: COLOR[st] }));
  const badges = { "/admissions": c.stages.review, "/admissions?stage=interview": c.stages.interview, "/admissions?stage=accepted": c.stages.accepted };
  // The buttons on a row follow the step the application is at. Under review: Accept (the papers are in order, it goes on) or Decline. In the interview
  // list: give it a date, record the result once the interview has taken place, then Accept. Every service checks its own conditions again.
  const now = Date.now();
  const actsOf = (r: DeskRow): DeskLine["acts"] => {
    const out: DeskLine["acts"] = [];
    const decide = can("admission.review"), verify = can("admission.documents.verify"), iv = can("admission.interview.manage");
    if ((r.state === "NEW" || r.state === "UNDER_REVIEW") && verify) out.push({ kind: "REVIEW", why: null });
    if (r.state === "REVIEWED" && iv && r.interview === "TO_ARRANGE") out.push({ kind: "DATE", why: null });
    if (r.state === "INTERVIEW_SCHEDULED" && iv) out.push({ kind: "RESULT", why: r.interviewAt && r.interviewAt.getTime() > now ? t("adm.q.wait.date") : null });
    if (r.state === "AWAITING_DECISION" && decide) out.push({ kind: "ACCEPT", why: null });
    if (decide && stageOf(r.state) !== "accepted" && ["review", "interview"].includes(stageOf(r.state))) out.push({ kind: "DECLINE", why: null });
    return out;
  };
  const lines: DeskLine[] = desk.rows.map((r) => ({
    id: r.id, applicationNo: r.applicationNo, name: r.name, className: r.className, guardian: r.guardianName, phone: r.guardianPhone, submitted: displayDate(r.submittedAt, ctx.locale), online: r.source === "ONLINE",
    state: r.state, stateLabel: t(`adm.state.${r.state}`), stateTone: TONE[r.state], step: workflowProgress(r.state), className2: r.className ?? t("adm.noClass"), acts: actsOf(r), afterReview: r.afterReview, pendingDocs: r.pendingDocs, stepLabel: t("adm.progress", { n: String(workflowProgress(r.state)) }),
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
      column: t("adm.col.action"), view: t("common.view"), accept: t("adm.q.accept"), decline: t("adm.q.decline"), date: t("adm.q.date"), result: t("adm.q.result"),
      acceptQ: t("adm.accept.confirm", { name: "{name}", class: "{class}" }), acceptAfter: t("adm.accept.after"), declineQ: t("adm.q.decline.q", { name: "{name}" }), declineReason: t("adm.q.decline.reason"), declineGo: t("adm.q.decline.go"),
      confirm: t("adm.accept.go"), open: t("adm.q.open"), cancel: t("adm.bulk.cancel"),
      reviewQ: t("adm.q.review.q", { name: "{name}" }), reviewToInterview: t("adm.q.review.toInterview"), reviewToAccepted: t("adm.q.review.toAccepted"), papersChecked: t("adm.q.papersChecked", { n: "{n}" }),
      dateQ: t("adm.q.date.q", { name: "{name}" }), dateSlot: t("adm.q.date.slot"), dateOther: t("adm.q.date.other"), dateWhen: t("adm.q.date.when"), dateGo: t("adm.q.date.go"),
      resultQ: t("adm.q.result.q", { name: "{name}" }), resultPassed: t("adm.q.result.passed"), resultNot: t("adm.q.result.not"), resultNote: t("adm.q.result.note"), resultGo: t("adm.q.result.go"),
    },
    selected: t("adm.bulk.selected", { n: "{n}" }), selectRow: t("adm.bulk.selectRow", { name: "{name}" }),
    confirm: { START_REVIEW: t("adm.bulk.confirm.START_REVIEW", { n: "{n}" }), MARK_REVIEWED: t("adm.bulk.confirm.MARK_REVIEWED", { n: "{n}" }), ASSIGN: t("adm.bulk.confirm.ASSIGN", { n: "{n}" }) },
    done: t("adm.bulk.done", { n: "{n}" }), unchanged: t("adm.bulk.unchanged", { n: "{n}" }), failed: t("adm.bulk.failed", { n: "{n}" }),
  };
  const filtersOn = !!(sp.q || sp.classId || sp.from || sp.to || sp.interview || sp.assigned || sp.source);
  const SEL = `${inputClass} !min-h-10 !w-auto !py-1.5 !text-sm`;
  const exportQuery = new URLSearchParams({ desk: "1", ...Object.fromEntries(Object.entries({ ...keep, state: sp.state, stage: sp.stage, attention: sp.attention }).filter(([, v]) => !!v) as [string, string][]) });

  return (
    <>
      <PageHeader title={t(`adm.stage.title.${stage}` as "adm.title")} subtitle={t(`adm.stage.sub.${stage}` as "adm.title")} actions={<div className="flex flex-wrap items-center gap-2">{can("admission.read") && <ExportMenu base={`/api/export/admissions?${exportQuery}`} t={t} />}{can("admission.create") && <LinkButton href="/admissions/new"><Plus className="size-4" aria-hidden /> {t("adm.new")}</LinkButton>}</div>} />
      <AdmissionsNav ctx={ctx} t={t} current={stage === "interview" ? "/admissions?stage=interview" : stage === "accepted" ? "/admissions?stage=accepted" : "/admissions"} badges={badges} />
      <Pipeline tabs={tabs} label={t("common.status")} segments={segments} />
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
        {!sp.state && stage !== "review" && <input type="hidden" name="stage" value={stage} />}
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
      <DeskTable rows={lines} labels={labels} reviewers={reviewers} canVerify={can("admission.documents.verify")} canAssign={can("admission.review")} action={bulkDeskAction} quick={quickDecisionAction} empty={t("adm.none")} slots={slotRows.map((x) => ({ value: x.local, label: `${x.when}${x.venue ? ` · ${x.venue}` : ""}${x.count > 0 ? ` (${x.count})` : ""}` }))} />
      <Pagination page={desk.page} pageSize={desk.pageSize} total={desk.total} basePath="/admissions" params={{ ...keep, state: sp.state, stage: sp.stage, attention: sp.attention }} t={t} />
    </>
  );
}
