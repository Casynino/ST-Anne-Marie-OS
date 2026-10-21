import Link from "next/link";
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
import { EmptyState, FilterBar, LinkButton, NoAccess, PageHeader, Pagination } from "@/components/ui";
import { Field } from "@/components/form";
import { DeskTable, type DeskLabels, type DeskLine } from "./desk-table";
import { bulkDeskAction } from "./actions";

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
  const tabs: { key: string; label: string; n: number; to: string; on: boolean }[] = [
    { key: "all", label: t("adm.stage.all"), n: c.total, to: href({}), on: !sp.state && sp.attention !== "1" },
    ...(["NEW", "UNDER_REVIEW", "NEEDS_INFO", "AWAITING_INTERVIEW", "INTERVIEW_SCHEDULED", "AWAITING_DECISION", "ACCEPTED", "ENROLLED", "CLOSED"] as const).map((s) => ({
      key: s, label: t(`adm.state.${s}`), n: s === "AWAITING_INTERVIEW" ? c.awaitingInterview : s === "CLOSED" ? c.closed : c[s], to: href({ state: s }), on: sp.state === s,
    })),
    { key: "attention", label: t("adm.state.ATTENTION"), n: c.attention, to: href({ attention: "1" }), on: sp.attention === "1" },
  ];
  const lines: DeskLine[] = desk.rows.map((r) => ({
    id: r.id, applicationNo: r.applicationNo, name: r.name, className: r.className, guardian: r.guardianName, phone: r.guardianPhone, submitted: displayDate(r.submittedAt, ctx.locale), online: r.source === "ONLINE",
    state: r.state, stateLabel: t(`adm.state.${r.state}`), stateTone: TONE[r.state],
    interviewLabel: t(`adm.ivs.${r.interview}`), interviewDetail: r.interviewAt ? displayDateTime(r.interviewAt, school.timezone, ctx.locale) : null,
    percent: r.completeness.percent,
    missing: r.completeness.missing.map((k) => (k.startsWith("doc:") ? t(`doc.type.${k.slice(4) as "OTHER"}`) : k === "class" ? t("adm.missing.class") : t("adm.missing.contact"))),
    assignedTo: r.assignedTo, attention: r.attention.map((a) => t(`adm.attn.${a}`)),
  }));
  const labels: DeskLabels = {
    applicant: t("adm.applicant"), guardian: t("adm.guardian"), class: t("adm.classApplied"), submitted: t("adm.appliedOn"), complete: t("adm.col.complete"), interview: t("adm.col.interview"), assigned: t("adm.col.assigned"), status: t("common.status"), open: t("adm.col.open"),
    online: t("adm.online"), selectAll: t("adm.bulk.selectAll"), start: t("adm.bulk.start"), review: t("adm.bulk.review"), assign: t("adm.bulk.assign"), assignTo: t("adm.bulk.assignTo"), go: t("adm.bulk.go"), cancel: t("adm.bulk.cancel"), dismiss: t("adm.bulk.dismiss"),
    never: t("adm.bulk.never"), unassigned: t("adm.unassigned"), choose: t("common.select"),
    selected: t("adm.bulk.selected", { n: "{n}" }), selectRow: t("adm.bulk.selectRow", { name: "{name}" }),
    confirm: { START_REVIEW: t("adm.bulk.confirm.START_REVIEW", { n: "{n}" }), MARK_REVIEWED: t("adm.bulk.confirm.MARK_REVIEWED", { n: "{n}" }), ASSIGN: t("adm.bulk.confirm.ASSIGN", { n: "{n}" }) },
    done: t("adm.bulk.done", { n: "{n}" }), unchanged: t("adm.bulk.unchanged", { n: "{n}" }), failed: t("adm.bulk.failed", { n: "{n}" }),
  };
  const exportQuery = new URLSearchParams({ desk: "1", ...Object.fromEntries(Object.entries({ ...keep, state: sp.state, attention: sp.attention }).filter(([, v]) => !!v) as [string, string][]) });

  return (
    <>
      <PageHeader title={t("adm.title")} actions={<div className="flex flex-wrap items-center gap-2">{can("admission.read") && <ExportMenu base={`/api/export/admissions?${exportQuery}`} t={t} />}{can("admission.create") && <LinkButton href="/admissions/new"><Plus className="size-4" aria-hidden /> {t("adm.new")}</LinkButton>}</div>} />
      <AdmissionsNav ctx={ctx} t={t} current="/admissions" />
      <nav aria-label={t("common.status")} className="mb-3 flex flex-wrap gap-1.5">
        {tabs.map((x) => (
          <Link key={x.key} href={x.to} aria-current={x.on ? "page" : undefined} className={`inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-medium ${x.on ? "bg-brand-700 text-white" : "border border-line bg-surface hover:bg-canvas"}`}>
            {x.label}<span className={`tabular-nums ${x.on ? "text-white/80" : x.key === "attention" && x.n > 0 ? "font-semibold text-warn" : "text-muted"}`}>{x.n}</span>
          </Link>
        ))}
      </nav>
      <FilterBar t={t} resetHref="/admissions">
        {sp.state && <input type="hidden" name="state" value={sp.state} />}
        {sp.attention === "1" && <input type="hidden" name="attention" value="1" />}
        <Field name="q" label={t("common.search")} defaultValue={sp.q} placeholder={t("adm.search")} className="min-w-52 flex-1" />
        <Field name="classId" label={t("adm.f.class")} type="select" defaultValue={sp.classId} placeholder={t("common.all")} options={classes.filter((x) => x.isActive).map((x) => ({ value: x.id, label: x.name }))} />
        <Field name="from" label={t("adm.f.from")} type="date" defaultValue={sp.from} />
        <Field name="to" label={t("adm.f.to")} type="date" defaultValue={sp.to} />
        <Field name="interview" label={t("adm.f.interview")} type="select" defaultValue={sp.interview} placeholder={t("common.all")} options={INTERVIEW_STATES.map((s) => ({ value: s, label: t(`adm.ivs.${s}`) }))} />
        <Field name="assigned" label={t("adm.f.assigned")} type="select" defaultValue={sp.assigned} placeholder={t("common.all")} options={[{ value: "me", label: t("adm.f.assigned.me") }, { value: "none", label: t("adm.f.assigned.none") }, ...reviewers.filter((r) => r.id !== ctx.userId).map((r) => ({ value: r.id, label: r.fullName }))]} />
        <Field name="source" label={t("adm.channel")} type="select" defaultValue={sp.source} placeholder={t("common.all")} options={[{ value: "ONLINE", label: t("adm.channel.ONLINE") }, { value: "STAFF", label: t("adm.channel.STAFF") }]} />
      </FilterBar>
      {lines.length === 0 ? (
        <EmptyState>{t("adm.none")}</EmptyState>
      ) : (
        <DeskTable rows={lines} labels={labels} reviewers={reviewers} canVerify={can("admission.documents.verify")} canAssign={can("admission.review")} action={bulkDeskAction} />
      )}
      <Pagination page={desk.page} pageSize={desk.pageSize} total={desk.total} basePath="/admissions" params={{ ...keep, state: sp.state, attention: sp.attention }} t={t} />
    </>
  );
}
