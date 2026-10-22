import type { Translate } from "@/lib/i18n";
import { AttentionTabs, type AttentionRow } from "@/components/dash/attention-tabs";
import type { DashEnv } from "./sections";

/*
 * "Needs your attention", the same block at the top of every home: what is waiting, with one sentence about what to do, most urgent first.
 * Each home builds its rows from the services it is allowed to read; the block itself only draws them.
 */

export type Area = "attendance" | "admissions" | "finance" | "results" | "messages" | "system" | "homework" | "planning" | "teaching" | "family" | "academic";
const AREAS: Area[] = ["admissions", "academic", "attendance", "teaching", "results", "finance", "messages", "homework", "planning", "family", "system"];
const AREA_LABEL: Record<Area, string> = { attendance: "dash.area.attendance", admissions: "dash.area.admissions", finance: "dash.area.finance", results: "dash.area.results", messages: "dash.area.messages", system: "dash.area.system", homework: "dash.area.homework", planning: "dash.area.planning", teaching: "desk.teaching", family: "fam.portal", academic: "desk.academic" };

const SEVERITY: Record<string, "bad" | "warn" | "info"> = {
  failedNotifications: "bad", backupStale: "bad", marksOverdue: "bad", tasksOverdue: "bad", feeOverdue: "bad", conflicts: "warn", unmatchedPayments: "warn", refundsPending: "warn", expensesPending: "warn", resultsToApprove: "warn",
  registersOpen: "warn", returned: "warn", awaitingResult: "warn", newEnquiries: "info", newApplications: "info", messagesWaiting: "info", new: "info", docsPending: "info", awaitingDecision: "info", interviewsToday: "info",
  eligible: "info", awaitingPaymentView: "info", awaitingPlacement: "warn", paymentsToVerify: "warn", awaitingPayment: "info", offerPending: "warn",
};
const toneRank = { bad: 0, warn: 1, info: 2 } as const;

/** The standard rows from the school-wide attention list (`d.attention`) and the admissions queues (`adm.queues`). */
export function standardRows(env: DashEnv, opts: { queues?: boolean; skip?: string[] } = {}): AttentionRow[] {
  const { t, d, adm } = env;
  const skip = new Set(opts.skip ?? []);
  const rows: AttentionRow[] = [];
  for (const a of d.attention) {
    if (skip.has(a.key) || (opts.queues && a.key === "newApplications")) continue;
    rows.push({ key: a.key, area: a.area, href: a.href, tone: SEVERITY[a.key] ?? "warn", text: t(`dash.attention.${a.key}` as "dash.attention.none", { count: a.count }), detail: t(`att.d.${a.key}` as "att.d.new") });
  }
  if (opts.queues) {
    for (const q of adm.queues) {
      if (skip.has(q.key)) continue;
      const task = q.key.startsWith("tasks");
      rows.push({ key: `q-${q.key}`, area: task ? "system" : "admissions", href: q.href, tone: SEVERITY[q.key] ?? "info", text: t(`adm.q.${q.key}` as "adm.q.new"), detail: t(`att.d.${q.key}` as "att.d.new"), count: q.count });
    }
  }
  return rows;
}

export function sortRows(rows: AttentionRow[]): AttentionRow[] {
  return [...rows].sort((a, b) => toneRank[a.tone ?? "warn"] - toneRank[b.tone ?? "warn"]);
}

/** The finished block. With nothing to show it draws one calm line, never an empty box. */
export function AttentionBlock({ t, rows }: { t: Translate; rows: AttentionRow[] }) {
  const sorted = sortRows(rows);
  if (sorted.length === 0) {
    return <section aria-label={t("attn.title")} className="mt-5"><h2 className="mb-2.5 text-xs font-semibold uppercase tracking-[.16em] text-muted">{t("attn.title")}</h2><p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ok shadow-[var(--shadow-card)]">{t("att.clear")}</p></section>;
  }
  const used = AREAS.filter((a) => sorted.some((r) => r.area === a));
  return <AttentionTabs heading={t("attn.title")} moreLabel={t("att.more")} allLabel={t("dash.attention.all")} areas={used.map((x) => ({ id: x, label: t(AREA_LABEL[x] as "dash.area.system") }))} rows={sorted} />;
}

/** Money that needs following up: overdue invoices and what falls due within a week (only for people who may see finance). */
export function financeRows(env: DashEnv): AttentionRow[] {
  const { t, d, money } = env;
  const f = d.finance;
  if (!f) return [];
  const rows: AttentionRow[] = [];
  if (f.overdue > 0) rows.push({ key: "feeOverdue", area: "finance", href: "/finance/reports", tone: "bad", text: t("att.t.feeOverdue", { amount: money(f.overdue) }), detail: t("att.d.feeOverdue") });
  if (f.dueSoon.amount > 0) rows.push({ key: "feeDueSoon", area: "finance", href: "/finance/invoices", tone: "warn", text: t("att.t.feeDueSoon", { amount: money(f.dueSoon.amount) }), detail: t("att.d.feeDueSoon"), count: f.dueSoon.students });
  return rows;
}

/** What the head teacher has to chase: teachers who have not signed in, mark sheets with no teacher, plans waiting for a review. */
export function headRows(t: Translate, totals: { sheetsUnassigned: number; plansAwaiting: number; neverSignedIn: number } | null | undefined): AttentionRow[] {
  if (!totals) return [];
  const rows: AttentionRow[] = [];
  if (totals.sheetsUnassigned > 0) rows.push({ key: "sheetsUnassigned", area: "results", href: "/marks", tone: "warn", text: t("att.t.sheetsUnassigned", { n: totals.sheetsUnassigned }), detail: t("att.d.sheetsUnassigned") });
  if (totals.plansAwaiting > 0) rows.push({ key: "plansAwaiting", area: "planning", href: "/planning", tone: "info", text: t("att.t.plansAwaiting", { n: totals.plansAwaiting }), detail: t("att.d.plansAwaiting") });
  if (totals.neverSignedIn > 0) rows.push({ key: "neverSignedIn", area: "teaching", href: "/users", tone: "info", text: t("att.t.neverSignedIn", { n: totals.neverSignedIn }), detail: t("att.d.neverSignedIn") });
  return rows;
}
