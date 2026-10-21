"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { Badge, EmptyState } from "@/components/ui";

export type DeskLine = {
  id: string; applicationNo: string; name: string; className: string | null; guardian: string | null; phone: string | null; submitted: string; online: boolean;
  state: string; stateLabel: string; stateTone: "neutral" | "ok" | "warn" | "bad" | "brand"; step: number; stepLabel: string; className2: string; acts: Kind[];
  interviewLabel: string; interviewDetail: string | null; percent: number; missing: string[]; assignedTo: string | null; attention: string[];
};
type Mode = "START_REVIEW" | "MARK_REVIEWED" | "ASSIGN";
type Kind = "ACCEPT" | "DECLINE" | "ASK";
export type QuickLabels = Record<"close" | "openFull" | "none" | "missing" | "accept" | "decline" | "ask" | "acceptQ" | "acceptAfter" | "declineQ" | "declineReason" | "declineGo" | "askQ" | "askGo" | "askAfter" | "confirm" | "open" | "cancel", string>;
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
  // One application opened in the side panel; Accept, More info and Decline ask in a pop-up first, and the server applies the same rules as the full page.
  const [openId, setOpenId] = useState<string | null>(null);
  const [snap, setSnap] = useState<DeskLine | null>(null);
  const [popup, setPopup] = useState<Kind | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [, quickForm, quickPending] = useActionState(async (prev: ActionState, form: FormData) => {
    const r = await quick(prev, form);
    if (r?.ok) { setDone(r.message ?? ""); setPopup(null); setFail(null); }
    else if (r) setFail(r.error);
    return r;
  }, null);
  const q = labels.quick;
  // When the list is filtered by status, an accepted or declined application leaves it; the panel stays to say what happened, without the old details.
  const listed = rows.find((x) => x.id === openId) ?? null;
  const current = openId ? listed ?? snap : null;
  const gone = openId !== null && listed === null;
  const showRow = (id: string) => { setDone(null); setFail(null); setPopup(null); setSnap(rows.find((x) => x.id === id) ?? null); setOpenId(id); };
  const closeRow = () => { setOpenId(null); setSnap(null); setPopup(null); setDone(null); setFail(null); };
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (popup && !d.open) d.showModal();
    if (!popup && d.open) d.close();
  }, [popup]);
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !dialog.current?.open) closeRow(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);
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

      {rows.length === 0 ? <EmptyState>{empty}</EmptyState> : (
      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
            <tr>
              {selectable && <th scope="col" className="w-10 px-2 py-3"><input type="checkbox" aria-label={labels.selectAll} checked={all} onChange={() => setPicked(all ? [] : rows.map((r) => r.id))} className="size-4 accent-brand-600" /></th>}
              {[labels.applicant, labels.status, labels.complete, labels.interview, labels.class, labels.guardian, labels.assigned].map((h, i) => <th key={i} scope="col" className="px-2 py-3 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr
                key={r.id}
                tabIndex={0}
                onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,input,label,select")) showRow(r.id); }}
                onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); showRow(r.id); } }}
                className={`cursor-pointer ${openId === r.id || picked.includes(r.id) ? "bg-tint" : "hover:bg-canvas"}`}
              >
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {current && (
        <aside role="complementary" aria-label={current.name} className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line bg-surface shadow-[var(--shadow-lift)] sm:w-[25rem]">
          <div className="flex items-start gap-3 border-b border-line p-4">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold text-heading">{current.name}</h2>
              <p className="text-xs tabular-nums text-muted">{current.applicationNo} · {current.submitted}{current.online ? ` · ${labels.online}` : ""}</p>
            </div>
            <button type="button" onClick={closeRow} aria-label={q.close} className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-canvas hover:text-ink"><X className="size-5" aria-hidden /></button>
          </div>

          <div className="space-y-5 overflow-y-auto p-4 text-sm">
            {done && <p role="status" className="rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 font-medium text-ok">{done}</p>}

            {!gone && (
              <>
            <div>
              <Badge tone={current.stateTone}>{current.stateLabel}</Badge>
              <span role="img" aria-label={current.stepLabel} title={current.stepLabel} className="mt-2 flex w-32 gap-0.5">
                {[1, 2, 3, 4, 5].map((n) => <span key={n} className={`h-1 flex-1 rounded-sm ${n <= current.step ? (current.stateTone === "bad" ? "bg-bad" : "bg-brand-500") : "bg-line"}`} />)}
              </span>
              {current.attention.length > 0 && <ul className="mt-3 space-y-1 text-warn">{current.attention.map((a, i) => <li key={i} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{a}</li>)}</ul>}
            </div>

            <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-3">
              <dt className="text-muted">{labels.class}</dt><dd>{current.className ?? "—"}</dd>
              <dt className="text-muted">{labels.guardian}</dt><dd>{current.guardian ?? "—"}{current.phone && <span className="block text-xs tabular-nums text-muted">{current.phone}</span>}</dd>
              <dt className="text-muted">{labels.complete}</dt>
              <dd>
                <span className="flex items-center gap-2"><span aria-hidden className="h-1.5 w-20 overflow-hidden rounded-sm bg-line"><span className="block h-full" style={{ width: `${current.percent}%`, background: current.percent === 100 ? "var(--color-ok)" : current.percent >= 60 ? "var(--color-warn)" : "var(--color-bad)" }} /></span><span className="tabular-nums">{current.percent}%</span></span>
                {current.missing.length > 0 && <span className="block text-xs text-muted">{q.missing}: {current.missing.join(", ")}</span>}
              </dd>
              <dt className="text-muted">{labels.interview}</dt><dd>{current.interviewLabel}{current.interviewDetail && <span className="block text-xs text-muted">{current.interviewDetail}</span>}</dd>
              <dt className="text-muted">{labels.assigned}</dt><dd>{current.assignedTo ?? labels.unassigned}</dd>
            </dl>
              </>
            )}
          </div>

          <div className="space-y-3 border-t border-line p-4">
            {gone ? null : current.acts.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {current.acts.map((k) => (
                  <button key={k} type="button" onClick={() => { setFail(null); setDone(null); setPopup(k); }} className={`min-h-10 rounded-md px-4 text-sm font-semibold ${k === "ACCEPT" ? "bg-brand-700 text-white hover:bg-brand-800" : k === "DECLINE" ? "border border-bad/50 text-bad hover:bg-bad/10" : "border border-line hover:border-brand-500"}`}>
                    {k === "ACCEPT" ? q.accept : k === "DECLINE" ? q.decline : q.ask}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted">{q.none}</p>
            )}
            <Link href={`/admissions/${current.id}`} className="inline-flex min-h-9 items-center text-sm font-semibold text-link hover:underline">{q.openFull}</Link>
          </div>
        </aside>
      )}

      <dialog ref={dialog} onClose={() => { setPopup(null); setFail(null); }} className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink shadow-[var(--shadow-lift)] backdrop:bg-black/60">
        {current && popup && (
          <form action={quickForm} className="space-y-4 p-5">
            <input type="hidden" name="id" value={current.id} />
            <input type="hidden" name="kind" value={popup} />
            <h2 className="text-lg font-semibold text-heading">{(popup === "ACCEPT" ? q.acceptQ : popup === "DECLINE" ? q.declineQ : q.askQ).replace("{name}", current.name).replace("{class}", current.className2)}</h2>
            {popup === "ACCEPT" && <p className="text-sm text-muted">{q.acceptAfter}</p>}
            {popup === "ASK" && <><input name="note" required maxLength={500} autoFocus aria-label={q.askQ.replace("{name}", current.name)} className="min-h-11 w-full rounded-md border border-line bg-surface px-3" /><p className="text-xs text-muted">{q.askAfter}</p></>}
            {popup === "DECLINE" && <input name="reason" required maxLength={300} autoFocus aria-label={q.declineReason} placeholder={q.declineReason} className="min-h-11 w-full rounded-md border border-line bg-surface px-3" />}
            {fail && <p role="alert" className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{fail} <Link href={`/admissions/${current.id}`} className="font-semibold underline">{q.open}</Link></p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setPopup(null); setFail(null); }} className="min-h-10 rounded-md px-4 text-sm text-muted hover:text-ink">{q.cancel}</button>
              <button disabled={quickPending} className={`min-h-10 rounded-md px-4 text-sm font-semibold text-white disabled:opacity-60 ${popup === "DECLINE" ? "bg-bad hover:opacity-90" : "bg-brand-700 hover:bg-brand-800"}`}>
                {popup === "ACCEPT" ? q.confirm : popup === "DECLINE" ? q.declineGo : q.askGo}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
