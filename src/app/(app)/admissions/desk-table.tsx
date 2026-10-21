"use client";

import Link from "next/link";
import { Fragment, useActionState, useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { Badge } from "@/components/ui";

export type DeskLine = {
  id: string; applicationNo: string; name: string; className: string | null; guardian: string | null; phone: string | null; submitted: string; online: boolean;
  state: string; stateLabel: string; stateTone: "neutral" | "ok" | "warn" | "bad" | "brand"; step: number; stepLabel: string; className2: string; acts: Kind[];
  interviewLabel: string; interviewDetail: string | null; percent: number; missing: string[]; assignedTo: string | null; attention: string[];
};
type Mode = "START_REVIEW" | "MARK_REVIEWED" | "ASSIGN";
type Kind = "ACCEPT" | "DECLINE" | "ASK";
export type QuickLabels = Record<"column" | "accept" | "decline" | "ask" | "acceptQ" | "acceptAfter" | "declineQ" | "declineReason" | "declineGo" | "askQ" | "askGo" | "askAfter" | "confirm" | "open" | "cancel", string>;
export type DeskLabels = Record<"applicant" | "guardian" | "class" | "submitted" | "complete" | "interview" | "assigned" | "status" | "online" | "selectAll" | "start" | "review" | "assign" | "assignTo" | "go" | "cancel" | "dismiss" | "never" | "unassigned" | "choose", string>
  & { quick: QuickLabels; selected: string; selectRow: string; confirm: Record<Mode, string>; done: string; unchanged: string; failed: string };

/**
 * The applications of the desk, one row each, with a tick box on every row. Ticking some shows what can be done with them together
 * (start the review, mark as reviewed, give to a reviewer). A consequential action asks first, and afterwards the result says what was
 * done, what needed nothing and what could not be done and why. Accepting is never offered here.
 */
export function DeskTable({ rows, labels, reviewers, canVerify, canAssign, action, quick }: {
  rows: DeskLine[]; labels: DeskLabels; reviewers: { id: string; fullName: string }[]; canVerify: boolean; canAssign: boolean;
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  quick: (prev: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode | null>(null);
  const [state, formAction, pending] = useActionState(async (prev: ActionState, form: FormData) => { const r = await action(prev, form); if (r?.ok) { setPicked([]); setMode(null); } return r; }, null);
  // The quick action of one row (accept, decline, ask for more details): a small panel under the row; the server applies the same rules as the full page.
  const [panel, setPanel] = useState<{ id: string; kind: Kind } | null>(null);
  const [done, setDone] = useState<{ name: string; text: string } | null>(null);
  const [fail, setFail] = useState<{ id: string; text: string } | null>(null);
  const [, quickForm, quickPending] = useActionState(async (prev: ActionState, form: FormData) => {
    const id = String(form.get("id") ?? "");
    const r = await quick(prev, form);
    if (r?.ok) { setDone({ name: rows.find((x) => x.id === id)?.name ?? "", text: r.message ?? "" }); setPanel(null); setFail(null); }
    else if (r) setFail({ id, text: r.error });
    return r;
  }, null);
  const openPanel = (id: string, kind: Kind) => { setDone(null); setFail(null); setPanel({ id, kind }); };
  const closePanel = () => { setPanel(null); setFail(null); };
  const q = labels.quick;
  const all = rows.length > 0 && picked.length === rows.length;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const outcome = state?.ok && state.data ? state.data : null;
  const problems: { no: string; reason: string }[] = outcome?.problems ? JSON.parse(outcome.problems) : [];
  const selectable = canVerify || canAssign;
  const cols = (selectable ? 1 : 0) + 8;

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
      {done && (
        <p role="status" className="flex flex-wrap items-center gap-x-3 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm"><span className="font-semibold text-ok">{done.name}</span><span>{done.text}</span><button type="button" onClick={() => setDone(null)} className="ml-auto text-link hover:underline">{labels.dismiss}</button></p>
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
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
            <tr>
              {selectable && <th scope="col" className="w-10 px-2 py-3"><input type="checkbox" aria-label={labels.selectAll} checked={all} onChange={() => setPicked(all ? [] : rows.map((r) => r.id))} className="size-4 accent-brand-600" /></th>}
              {[labels.applicant, labels.status, labels.complete, labels.interview, labels.class, labels.guardian, labels.assigned, q.column].map((h, i) => <th key={i} scope="col" className="px-2 py-3 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <Fragment key={r.id}>
              <tr className={picked.includes(r.id) ? "bg-tint" : "hover:bg-canvas"}>
                {selectable && <td className="px-2 py-3"><input type="checkbox" aria-label={labels.selectRow.replace("{name}", r.name)} checked={picked.includes(r.id)} onChange={() => toggle(r.id)} className="size-4 accent-brand-600" /></td>}
                <td className="min-w-36 px-2 py-3">
                  <Link href={`/admissions/${r.id}`} className="font-semibold text-link hover:underline">{r.name}</Link>
                  <span className="block text-xs tabular-nums text-muted">{r.applicationNo}</span><span className="block text-xs text-muted">{r.submitted}{r.online ? ` · ${labels.online}` : ""}</span>
                </td>
                <td className="px-2 py-3">
                  <span className="flex items-center gap-1.5">
                    <Badge tone={r.stateTone}>{r.stateLabel}</Badge>
                    {r.attention.length > 0 && <span title={r.attention.join("\n")} className="inline-flex text-warn"><AlertTriangle className="size-4" aria-label={r.attention.join(", ")} /></span>}
                  </span>
                  <span role="img" aria-label={r.stepLabel} title={r.stepLabel} className="mt-1.5 flex w-24 gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => <span key={n} className={`h-1 flex-1 rounded-sm ${n <= r.step ? (r.stateTone === "bad" ? "bg-bad" : "bg-brand-500") : "bg-line"}`} />)}
                  </span>
                </td>
                <td className="px-2 py-3" title={r.missing.join(", ")}>
                  <span className="flex items-center gap-2"><span aria-hidden className="h-1.5 w-12 overflow-hidden rounded-sm bg-line"><span className="block h-full" style={{ width: `${r.percent}%`, background: r.percent === 100 ? "var(--color-ok)" : r.percent >= 60 ? "var(--color-warn)" : "var(--color-bad)" }} /></span><span className="tabular-nums">{r.percent}%</span></span>
                  {r.missing.length > 0 && <span className="block max-w-[11rem] truncate text-xs text-muted">{r.missing.join(", ")}</span>}
                </td>
                <td className="px-2 py-3"><span className="block">{r.interviewLabel}</span>{r.interviewDetail && <span className="block whitespace-nowrap text-xs text-muted">{r.interviewDetail}</span>}</td>
                <td className="whitespace-nowrap px-2 py-3">{r.className ?? "—"}</td>
                <td className="px-2 py-3"><span className="block">{r.guardian ?? "—"}</span><span className="block text-xs tabular-nums text-muted">{r.phone ?? ""}</span></td>
                <td className="px-2 py-3 text-muted">{r.assignedTo ?? labels.unassigned}</td>
                <td className="whitespace-nowrap px-2 py-3 text-right">
                  {r.acts.length > 0 && (
                    <button type="button" aria-expanded={panel?.id === r.id} onClick={() => (panel?.id === r.id ? closePanel() : openPanel(r.id, r.acts[0]!))} className="group inline-flex min-h-9 items-center gap-1.5 rounded-md border border-line px-3 text-sm font-semibold hover:border-brand-500 aria-expanded:border-brand-500 aria-expanded:bg-tint">
                      {q.column}<ChevronDown className="size-4 transition-transform group-aria-expanded:rotate-180" aria-hidden />
                    </button>
                  )}
                </td>
              </tr>
              {panel?.id === r.id && (
                <tr className="bg-tint">
                  <td colSpan={cols} className="px-2 py-3">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                      <div role="group" aria-label={q.column} className="inline-flex overflow-hidden rounded-md border border-line bg-surface">
                        {r.acts.map((k, i) => (
                          <button key={k} type="button" aria-pressed={panel.kind === k} onClick={() => openPanel(r.id, k)} className={`min-h-9 px-3 font-semibold ${i > 0 ? "border-l border-line" : ""} ${panel.kind === k ? (k === "DECLINE" ? "bg-bad text-white" : "bg-brand-700 text-white") : "text-ink hover:bg-canvas"}`}>
                            {k === "ACCEPT" ? q.accept : k === "DECLINE" ? q.decline : q.ask}
                          </button>
                        ))}
                      </div>
                    <form action={quickForm} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="kind" value={panel.kind} />
                      <span className="font-medium text-ink">
                        {(panel.kind === "ACCEPT" ? q.acceptQ : panel.kind === "DECLINE" ? q.declineQ : q.askQ).replace("{name}", r.name).replace("{class}", r.className2)}
                      </span>
                      {panel.kind === "DECLINE" && <input name="reason" required maxLength={300} aria-label={q.declineReason} placeholder={q.declineReason} className="min-h-10 min-w-56 flex-1 rounded-md border border-line bg-surface px-3" />}
                      {panel.kind === "ASK" && <input name="note" required maxLength={500} aria-label={q.askQ.replace("{name}", r.name)} placeholder={q.askQ.replace("{name}", r.name)} className="min-h-10 min-w-56 flex-1 rounded-md border border-line bg-surface px-3" />}
                      <button disabled={quickPending} className={`min-h-10 rounded-md px-4 font-semibold text-white disabled:opacity-60 ${panel.kind === "DECLINE" ? "bg-bad hover:opacity-90" : "bg-brand-700 hover:bg-brand-800"}`}>
                        {panel.kind === "ACCEPT" ? q.confirm : panel.kind === "DECLINE" ? q.declineGo : q.askGo}
                      </button>
                      <button type="button" onClick={closePanel} className="min-h-10 px-2 text-muted hover:text-ink">{q.cancel}</button>
                      <span className="basis-full text-xs text-muted">{panel.kind === "ACCEPT" ? q.acceptAfter : panel.kind === "ASK" ? q.askAfter : ""}</span>
                      {fail?.id === r.id && (
                        <span role="alert" className="basis-full rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-bad">
                          {fail.text} <Link href={`/admissions/${r.id}`} className="font-semibold underline">{q.open}</Link>
                        </span>
                      )}
                    </form>
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
