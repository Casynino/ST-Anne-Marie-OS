"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { AlertTriangle, Ban, Check } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { Badge, EmptyState } from "@/components/ui";

export type DeskLine = {
  id: string; applicationNo: string; name: string; className: string | null; guardian: string | null; phone: string | null; submitted: string; online: boolean;
  state: string; stateLabel: string; stateTone: "neutral" | "ok" | "warn" | "bad" | "brand"; step: number; stepLabel: string; className2: string; decide: "none" | "ready" | "wait"; waitWhy: string; canDecline: boolean;
  interviewLabel: string; interviewDetail: string | null; percent: number; missing: string[]; assignedTo: string | null; attention: string[];
};
type Mode = "START_REVIEW" | "MARK_REVIEWED" | "ASSIGN";
type Kind = "ACCEPT" | "DECLINE";
export type QuickLabels = Record<"column" | "accept" | "decline" | "acceptQ" | "acceptAfter" | "declineQ" | "declineReason" | "declineGo" | "confirm" | "open" | "cancel", string>;
export type DeskLabels = Record<"applicant" | "guardian" | "class" | "submitted" | "complete" | "interview" | "assigned" | "status" | "online" | "selectAll" | "start" | "review" | "assign" | "assignTo" | "go" | "cancel" | "dismiss" | "never" | "unassigned" | "choose", string>
  & { quick: QuickLabels; selected: string; selectRow: string; confirm: Record<Mode, string>; done: string; unchanged: string; failed: string };

/**
 * The applications of the desk, one row each, with a tick box on every row. Ticking some shows what can be done with them together
 * (start the review, mark as reviewed, give to a reviewer). A consequential action asks first, and afterwards the result says what was
 * done, what needed nothing and what could not be done and why. Accepting is never offered here.
 */
export function DeskTable({ rows, labels, reviewers, canVerify, canAssign, action, quick, empty }: {
  empty: string; rows: DeskLine[]; labels: DeskLabels; reviewers: { id: string; fullName: string }[]; canVerify: boolean; canAssign: boolean;
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  quick: (prev: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode | null>(null);
  const [state, formAction, pending] = useActionState(async (prev: ActionState, form: FormData) => { const r = await action(prev, form); if (r?.ok) { setPicked([]); setMode(null); } return r; }, null);
  // Accept and Decline sit on the row of the application; each asks in a pop-up first, and the server applies the same rules as the full page.
  const [ask, setAsk] = useState<{ id: string; kind: Kind; name: string; cls: string } | null>(null);
  const [done, setDone] = useState<{ name: string; text: string } | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [, quickForm, quickPending] = useActionState(async (prev: ActionState, form: FormData) => {
    const name = String(form.get("name") ?? "");
    const r = await quick(prev, form);
    if (r?.ok) { setDone({ name, text: r.message ?? "" }); setAsk(null); setFail(null); }
    else if (r) setFail(r.error);
    return r;
  }, null);
  const q = labels.quick;
  const openAsk = (r: DeskLine, kind: Kind) => { setDone(null); setFail(null); setAsk({ id: r.id, kind, name: r.name, cls: r.className2 }); };
  const closeAsk = () => { setAsk(null); setFail(null); };
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (ask && !d.open) d.showModal();
    if (!ask && d.open) d.close();
  }, [ask]);
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

      {rows.length === 0 ? <EmptyState>{empty}</EmptyState> : (
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
              <tr key={r.id} className={picked.includes(r.id) ? "bg-tint" : "hover:bg-canvas"}>
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
                <td className="whitespace-nowrap px-2 py-3">
                  {r.decide !== "none" && (
                    <span className="inline-flex items-center gap-1.5">
                      <span title={r.decide === "wait" ? r.waitWhy : undefined}>
                        <button type="button" disabled={r.decide === "wait"} aria-label={`${q.accept}: ${r.name}`} onClick={() => openAsk(r, "ACCEPT")} className="group inline-flex min-h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[13px] font-medium text-ink transition-colors hover:border-ok/60 hover:bg-ok/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-surface"><Check className="size-3.5 text-ok group-disabled:text-muted" aria-hidden />{q.accept}</button>
                      </span>
                      {r.canDecline && <button type="button" aria-label={`${q.decline}: ${r.name}`} onClick={() => openAsk(r, "DECLINE")} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[13px] font-medium text-ink transition-colors hover:border-bad/60 hover:bg-bad/10"><Ban className="size-3.5 text-bad" aria-hidden />{q.decline}</button>}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      <dialog ref={dialog} onClose={closeAsk} className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink shadow-[var(--shadow-lift)] backdrop:bg-black/60">
        {ask && (
          <form action={quickForm} className="space-y-4 p-5">
            <input type="hidden" name="id" value={ask.id} />
            <input type="hidden" name="name" value={ask.name} />
            <input type="hidden" name="kind" value={ask.kind} />
            <h2 className="text-lg font-semibold text-heading">{(ask.kind === "ACCEPT" ? q.acceptQ : q.declineQ).replace("{name}", ask.name).replace("{class}", ask.cls)}</h2>
            {ask.kind === "ACCEPT" && <p className="text-sm text-muted">{q.acceptAfter}</p>}
            {ask.kind === "DECLINE" && <input name="reason" required maxLength={300} autoFocus aria-label={q.declineReason} placeholder={q.declineReason} className="min-h-11 w-full rounded-md border border-line bg-surface px-3" />}
            {fail && <p role="alert" className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{fail} <Link href={`/admissions/${ask.id}`} className="font-semibold underline">{q.open}</Link></p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeAsk} className="min-h-10 rounded-md px-4 text-sm text-muted hover:text-ink">{q.cancel}</button>
              <button disabled={quickPending} className={`min-h-10 rounded-md px-4 text-sm font-semibold text-white disabled:opacity-60 ${ask.kind === "DECLINE" ? "bg-bad hover:opacity-90" : "bg-brand-700 hover:bg-brand-800"}`}>
                {ask.kind === "ACCEPT" ? q.confirm : q.declineGo}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
