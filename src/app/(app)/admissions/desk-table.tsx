"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { Badge } from "@/components/ui";

export type DeskLine = {
  id: string; applicationNo: string; name: string; className: string | null; guardian: string | null; phone: string | null; submitted: string; online: boolean;
  state: string; stateLabel: string; stateTone: "neutral" | "ok" | "warn" | "bad" | "brand";
  interviewLabel: string; interviewDetail: string | null; percent: number; missing: string[]; assignedTo: string | null; attention: string[];
};
type Mode = "START_REVIEW" | "MARK_REVIEWED" | "ASSIGN";
export type DeskLabels = Record<"applicant" | "guardian" | "class" | "submitted" | "complete" | "interview" | "assigned" | "status" | "open" | "online" | "selectAll" | "start" | "review" | "assign" | "assignTo" | "go" | "cancel" | "dismiss" | "never" | "unassigned" | "choose", string>
  & { selected: string; selectRow: string; confirm: Record<Mode, string>; done: string; unchanged: string; failed: string };

/**
 * The applications of the desk, one row each, with a tick box on every row. Ticking some shows what can be done with them together
 * (start the review, mark as reviewed, give to a reviewer). A consequential action asks first, and afterwards the result says what was
 * done, what needed nothing and what could not be done and why. Accepting is never offered here.
 */
export function DeskTable({ rows, labels, reviewers, canVerify, canAssign, action }: {
  rows: DeskLine[]; labels: DeskLabels; reviewers: { id: string; fullName: string }[]; canVerify: boolean; canAssign: boolean;
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode | null>(null);
  const [state, formAction, pending] = useActionState(async (prev: ActionState, form: FormData) => { const r = await action(prev, form); if (r?.ok) { setPicked([]); setMode(null); } return r; }, null);
  const all = rows.length > 0 && picked.length === rows.length;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const outcome = state?.ok && state.data ? state.data : null;
  const problems: { no: string; reason: string }[] = outcome?.problems ? JSON.parse(outcome.problems) : [];
  const selectable = canVerify || canAssign;

  return (
    <div className="space-y-3">
      {outcome && (
        <div role="status" className="rounded-xl border border-line bg-surface p-4 text-sm">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className="font-semibold text-ok">{labels.done.replace("{n}", outcome.done ?? "0")}</span>
            <span className="text-muted">{labels.unchanged.replace("{n}", outcome.unchanged ?? "0")}</span>
            <span className={Number(outcome.failed) > 0 ? "font-semibold text-bad" : "text-muted"}>{labels.failed.replace("{n}", outcome.failed ?? "0")}</span>
            <Link href="?" className="ml-auto text-link hover:underline">{labels.dismiss}</Link>
          </div>
          {problems.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-muted">{problems.map((p, i) => <li key={i}><span className="font-medium tabular-nums text-ink">{p.no}</span>: {p.reason}</li>)}</ul>}
        </div>
      )}
      {state && !state.ok && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{state.error}</p>}

      {selectable && picked.length > 0 && (
        <form action={formAction} className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/50 bg-surface p-3 text-sm shadow-[var(--shadow-lift)]">
          {picked.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
          <input type="hidden" name="action" value={mode ?? ""} />
          <span className="font-semibold">{labels.selected.replace("{n}", String(picked.length))}</span>
          {!mode ? (
            <>
              {canVerify && <button type="button" onClick={() => setMode("START_REVIEW")} className="min-h-10 rounded-md border border-line px-3 font-semibold hover:border-brand-500">{labels.start}</button>}
              {canVerify && <button type="button" onClick={() => setMode("MARK_REVIEWED")} className="min-h-10 rounded-md border border-line px-3 font-semibold hover:border-brand-500">{labels.review}</button>}
              {canAssign && <button type="button" onClick={() => setMode("ASSIGN")} className="min-h-10 rounded-md border border-line px-3 font-semibold hover:border-brand-500">{labels.assign}</button>}
              <span className="ml-auto text-xs text-muted">{labels.never}</span>
            </>
          ) : (
            <>
              <span className="basis-full text-ink sm:basis-auto">{labels.confirm[mode].replace("{n}", String(picked.length))}</span>
              {mode === "ASSIGN" && (
                <select name="assigneeId" required defaultValue="" aria-label={labels.assignTo} className="min-h-10 rounded-md border border-line bg-surface px-2">
                  <option value="" disabled>{labels.choose}</option>
                  {reviewers.map((r) => <option key={r.id} value={r.id}>{r.fullName}</option>)}
                </select>
              )}
              <button disabled={pending} className="min-h-10 rounded-md bg-brand-700 px-4 font-semibold text-white hover:bg-brand-800 disabled:opacity-60">{labels.go}</button>
              <button type="button" onClick={() => setMode(null)} className="min-h-10 px-2 text-muted hover:text-ink">{labels.cancel}</button>
            </>
          )}
        </form>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]">
        <table className="w-full min-w-[60rem] text-left text-sm">
          <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
            <tr>
              {selectable && <th scope="col" className="w-10 px-3 py-3"><input type="checkbox" aria-label={labels.selectAll} checked={all} onChange={() => setPicked(all ? [] : rows.map((r) => r.id))} className="size-4 accent-brand-600" /></th>}
              {[labels.applicant, labels.guardian, labels.class, labels.submitted, labels.complete, labels.interview, labels.assigned, labels.status, ""].map((h, i) => <th key={i} scope="col" className="px-3 py-3 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id} className={picked.includes(r.id) ? "bg-tint" : "hover:bg-canvas"}>
                {selectable && <td className="px-3 py-3"><input type="checkbox" aria-label={labels.selectRow.replace("{name}", r.name)} checked={picked.includes(r.id)} onChange={() => toggle(r.id)} className="size-4 accent-brand-600" /></td>}
                <td className="px-3 py-3">
                  <Link href={`/admissions/${r.id}`} className="font-semibold text-link hover:underline">{r.name}</Link>
                  <span className="block text-xs tabular-nums text-muted">{r.applicationNo}{r.online ? ` · ${labels.online}` : ""}</span>
                </td>
                <td className="px-3 py-3"><span className="block">{r.guardian ?? "—"}</span><span className="block text-xs tabular-nums text-muted">{r.phone ?? ""}</span></td>
                <td className="whitespace-nowrap px-3 py-3">{r.className ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-3 text-muted">{r.submitted}</td>
                <td className="px-3 py-3" title={r.missing.join(", ")}>
                  <span className="flex items-center gap-2"><span aria-hidden className="h-1.5 w-14 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full" style={{ width: `${r.percent}%`, background: r.percent === 100 ? "var(--color-ok)" : r.percent >= 60 ? "var(--color-warn)" : "var(--color-bad)" }} /></span><span className="tabular-nums">{r.percent}%</span></span>
                  {r.missing.length > 0 && <span className="block max-w-[11rem] truncate text-xs text-muted">{r.missing.join(", ")}</span>}
                </td>
                <td className="px-3 py-3"><span className="block">{r.interviewLabel}</span>{r.interviewDetail && <span className="block whitespace-nowrap text-xs text-muted">{r.interviewDetail}</span>}</td>
                <td className="px-3 py-3 text-muted">{r.assignedTo ?? labels.unassigned}</td>
                <td className="px-3 py-3">
                  <Badge tone={r.stateTone}>{r.stateLabel}</Badge>
                  {r.attention.length > 0 && <span title={r.attention.join("\n")} className="ml-2 inline-flex align-middle text-warn"><AlertTriangle className="size-4" aria-label={r.attention.join(", ")} /></span>}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right"><Link href={`/admissions/${r.id}`} className="font-semibold text-link hover:underline">{labels.open}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
