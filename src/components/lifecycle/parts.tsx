import type { Translate } from "@/lib/i18n";
import { Badge } from "@/components/ui";
import type { ExamCompletion, ClearanceState, NextStage } from "@/lib/lifecycle/rules";

/*
 * Small pieces the three year-lifecycle screens share, so Academic, Admissions and Finance describe the same fact in the same words.
 */

const OUTCOME_TONE = { PROMOTED: "ok", REPEAT: "warn", PENDING_REVIEW: "neutral", COMPLETED: "brand", WITHDRAWN: "bad", TRANSFERRED: "bad" } as const;
const STATUS_TONE = { DRAFT: "neutral", AWAITING_HEAD: "warn", APPROVED: "ok" } as const;

export function OutcomeBadge({ outcome, t }: { outcome: string; t: Translate }) {
  return <Badge tone={OUTCOME_TONE[outcome as keyof typeof OUTCOME_TONE] ?? "neutral"}>{t(`lc.outcome.${outcome}` as "lc.outcome.PROMOTED")}</Badge>;
}

export function DecisionStatus({ status, t }: { status: string; t: Translate }) {
  return <Badge tone={STATUS_TONE[status as keyof typeof STATUS_TONE] ?? "neutral"}>{t(`lc.status.${status}` as "lc.status.DRAFT")}</Badge>;
}

/** Whether a student's examinations of the year are complete, in one line. The list of what is missing is in the tooltip and on the student's page. */
export function ResultsCell({ c, t }: { c: ExamCompletion; t: Translate }) {
  if (c.state === "COMPLETE") return <span className="text-ok">{t("lc.results.complete")}{c.average !== null && <span className="ml-1 tabular-nums text-muted">· {c.average}%</span>}</span>;
  if (c.state === "NO_EXAMS") return <span className="text-muted">{t("lc.results.none")}</span>;
  return <span className="text-warn" title={c.missing.join("\n")}>{t("lc.results.incomplete", { n: c.missing.length })}</span>;
}

const CLEAR_TONE = { CLEARED: "ok", CLEARED_EXCEPTION: "brand", OUTSTANDING: "warn", NOT_BILLED: "neutral" } as const;
export function ClearanceBadge({ state, t }: { state: ClearanceState; t: Translate }) {
  return <Badge tone={CLEAR_TONE[state]}>{t(`lc.clear.${state}` as "lc.clear.CLEARED")}</Badge>;
}

export const stageLabel = (t: Translate, stage: NextStage) => t(`lc.stage.${stage}` as "lc.stage.ACTIVE");
export const deptLabel = (t: Translate, d: string) => t(`lc.dept.${d}` as "lc.dept.ACADEMIC");

/** A plain horizontal row of tabs with a count each (links, not buttons: the state is in the address). */
export function CountTabs({ items }: { items: { href: string; label: string; count?: number; active: boolean }[] }) {
  return (
    <ul className="mb-4 flex gap-2 overflow-x-auto whitespace-nowrap">
      {items.map((i) => (
        <li key={i.href}>
          <a href={i.href} aria-current={i.active ? "page" : undefined} className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium ${i.active ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-surface text-ink hover:bg-canvas"}`}>
            {i.label}
            {i.count !== undefined && <span className={`tabular-nums ${i.active ? "text-white/80" : "text-muted"}`}>{i.count}</span>}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Numbers across the top of a dashboard: plain, not boxed cards. */
export function Figures({ items }: { items: { label: string; value: string | number; tone?: "ok" | "warn" | "bad" }[] }) {
  return (
    <dl className="mb-5 grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl border border-line bg-surface px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((i) => (
        <div key={i.label}>
          <dt className="text-xs text-muted">{i.label}</dt>
          <dd className={`text-xl font-semibold tabular-nums ${i.tone === "ok" ? "text-ok" : i.tone === "warn" ? "text-warn" : i.tone === "bad" ? "text-bad" : ""}`}>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}
