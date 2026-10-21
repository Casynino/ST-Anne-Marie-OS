"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { AlertTriangle, Ban, CalendarPlus, Check, ClipboardCheck, Eye, Undo2, UserPlus } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { Badge, EmptyState } from "@/components/ui";

export type DeskLine = {
  id: string; applicationNo: string; name: string; className: string | null; guardian: string | null; phone: string | null; submitted: string; online: boolean;
  state: string; stateLabel: string; stateTone: "neutral" | "ok" | "warn" | "bad" | "brand"; step: number; stepLabel: string; className2: string; classId: string | null; acts: { kind: Kind; why: string | null }[]; afterReview: "interview" | "placement"; pendingDocs: number;
  interviewLabel: string; interviewDetail: string | null; percent: number; missing: string[]; attention: string[];
};
type Mode = "START_REVIEW" | "MARK_REVIEWED";
type Kind = "REVIEW" | "ACCEPT" | "DECLINE" | "DATE" | "RESULT" | "ENROL" | "BACK";
export type QuickLabels = Record<"column" | "view" | "accept" | "decline" | "date" | "result" | "acceptQ" | "acceptAfter" | "declineQ" | "declineReason" | "declineGo" | "confirm" | "open" | "cancel" | "reviewQ" | "reviewToInterview" | "reviewToAccepted" | "reviewHasDate" | "papersChecked" | "dateQ" | "dateSlot" | "dateOther" | "dateWhen" | "dateGo" | "resultQ" | "resultPassed" | "resultNot" | "resultNote" | "resultGo" | "resultHint" | "enrol" | "enrolQ" | "enrolAfter" | "enrolGo" | "back" | "backQ" | "backNote" | "backDefault" | "backAfter" | "backGo", string>;
export type DeskLabels = Record<"applicant" | "guardian" | "class" | "submitted" | "complete" | "interview" | "status" | "online" | "selectAll" | "start" | "review" | "go" | "cancel" | "dismiss" | "never", string>
  & { quick: QuickLabels; selected: string; selectRow: string; confirm: Record<Mode, string>; done: string; unchanged: string; failed: string };

/**
 * The applications of the desk, one row each, with a tick box on every row. Ticking some shows what can be done with them together
 * (start the review, mark as reviewed, give to a reviewer). A consequential action asks first, and afterwards the result says what was
 * done, what needed nothing and what could not be done and why. Accepting is never offered here.
 */
export function DeskTable({ rows, labels, canVerify, action, quick, empty, slots, view }: {
  /** "interview": everyone listed has a confirmed interview date, so only the date, class and guardian are shown (no status, no completeness, no ticking). */
  view: "review" | "interview"; empty: string; slots: { value: string; label: string; classIds: string[] | null }[]; rows: DeskLine[]; labels: DeskLabels; canVerify: boolean;
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  quick: (prev: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode | null>(null);
  const [state, formAction, pending] = useActionState(async (prev: ActionState, form: FormData) => { const r = await action(prev, form); if (r?.ok) { setPicked([]); setMode(null); } return r; }, null);
  // Accept and Decline sit on the row of the application; each asks in a pop-up first, and the server applies the same rules as the full page.
  const [ask, setAsk] = useState<{ row: DeskLine; kind: Kind } | null>(null);
  const [slot, setSlot] = useState("");
  const [result, setResult] = useState("");
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
  const openAsk = (r: DeskLine, kind: Kind) => { setDone(null); setFail(null); setSlot((slots.find((x) => x.classIds && (x.classIds.length === 0 || (r.classId !== null && x.classIds.includes(r.classId)))) ?? slots[0])?.value ?? ""); setResult(""); setAsk({ row: r, kind }); };
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
  const selectable = canVerify && view === "review";

  // The interview date: one of the days the school set, or another date and time. Used when giving a date and when accepting an application under review.
  const dateFields = (
    <div className="space-y-3 text-sm">
      {slots.length > 0 && (
        <label className="block">
          <span className="font-medium">{q.dateSlot}</span>
          <select name="slot" defaultValue={slot} onChange={(e) => setSlot(e.target.value)} className="mt-1 block min-h-11 w-full rounded-md border border-line bg-surface px-3">
            {slots.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            <option value="">{q.dateOther}</option>
          </select>
        </label>
      )}
      {(slots.length === 0 || slot === "") && (
        <label className="block">
          <span className="font-medium">{q.dateWhen}</span>
          <input type="datetime-local" name="scheduledAt" required className="mt-1 block min-h-11 w-full rounded-md border border-line bg-surface px-3" />
        </label>
      )}
    </div>
  );

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
              <span className="ml-auto text-xs text-muted">{labels.never}</span>
            </>
          ) : (
            <>
              <span className="basis-full text-ink sm:basis-auto">{labels.confirm[mode].replace("{n}", String(picked.length))}</span>
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
              {selectable && <th scope="col" className="w-10 px-1.5 py-3"><input type="checkbox" aria-label={labels.selectAll} checked={all} onChange={() => setPicked(all ? [] : rows.map((r) => r.id))} className="size-4 accent-brand-600" /></th>}
              {(view === "interview" ? [labels.applicant, labels.interview, labels.class, labels.guardian, q.column] : [labels.applicant, labels.status, labels.complete, labels.interview, labels.class, labels.guardian, q.column]).map((h, i) => <th key={i} scope="col" className="px-1.5 py-3 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr
                key={r.id}
                onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,input,label,select")) router.push(`/admissions/${r.id}`); }}
                className={`cursor-pointer ${picked.includes(r.id) ? "bg-tint" : "hover:bg-canvas"}`}
              >
                {selectable && <td className="px-1.5 py-3"><input type="checkbox" aria-label={labels.selectRow.replace("{name}", r.name)} checked={picked.includes(r.id)} onChange={() => toggle(r.id)} className="size-4 accent-brand-600" /></td>}
                <td className="min-w-36 px-1.5 py-3">
                  <Link href={`/admissions/${r.id}`} className="font-semibold text-link hover:underline">{r.name}</Link>
                  <span className="block text-xs tabular-nums text-muted">{r.applicationNo}</span><span className="block text-xs text-muted">{r.submitted}{r.online ? ` · ${labels.online}` : ""}</span>
                </td>
                {view === "review" && (
                  <>
                <td className="px-1.5 py-3">
                  <span className="flex items-center gap-1.5">
                    <Badge tone={r.stateTone}>{r.stateLabel}</Badge>
                    {r.attention.length > 0 && <span title={r.attention.join("\n")} className="inline-flex text-warn"><AlertTriangle className="size-4" aria-label={r.attention.join(", ")} /></span>}
                  </span>
                  <span role="img" aria-label={r.stepLabel} title={r.stepLabel} className="mt-1.5 flex w-24 gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => <span key={n} className={`h-1 flex-1 rounded-sm ${n <= r.step ? (r.stateTone === "bad" ? "bg-bad" : "bg-brand-500") : "bg-line"}`} />)}
                  </span>
                </td>
                <td className="px-1.5 py-3" title={r.missing.join(", ")}>
                  <span className="flex items-center gap-2"><span aria-hidden className="h-1.5 w-12 overflow-hidden rounded-sm bg-line"><span className="block h-full" style={{ width: `${r.percent}%`, background: r.percent === 100 ? "var(--color-ok)" : r.percent >= 60 ? "var(--color-warn)" : "var(--color-bad)" }} /></span><span className="tabular-nums">{r.percent}%</span></span>
                  {r.missing.length > 0 && <span className="block max-w-[11rem] truncate text-xs text-muted">{r.missing.join(", ")}</span>}
                </td>
                  </>
                )}
                <td className="px-1.5 py-3">
                  {view === "interview" ? (
                    <>
                      <span className="flex items-center gap-1.5 font-medium">
                        {r.interviewDetail ?? r.interviewLabel}
                        {r.attention.length > 0 && <span title={r.attention.join("\n")} className="inline-flex text-warn"><AlertTriangle className="size-4" aria-label={r.attention.join(", ")} /></span>}
                      </span>
                      {r.state !== "INTERVIEW_SCHEDULED" && <span className="mt-0.5 block text-xs text-muted">{r.stateLabel}</span>}
                    </>
                  ) : (
                    <><span className="block">{r.interviewLabel}</span>{r.interviewDetail && <span className="block whitespace-nowrap text-xs text-muted">{r.interviewDetail}</span>}</>
                  )}
                </td>
                <td className="whitespace-nowrap px-1.5 py-3">{r.className ?? "—"}</td>
                <td className="px-1.5 py-3"><span className="block">{r.guardian ?? "—"}</span><span className="block text-xs tabular-nums text-muted">{r.phone ?? ""}</span></td>
                <td className="whitespace-nowrap px-1.5 py-3">
                  <span className="inline-flex items-center gap-1.5">
                    <Link href={`/admissions/${r.id}`} aria-label={`${q.view}: ${r.name}`} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[13px] font-medium text-ink transition-colors hover:border-brand-500 hover:bg-tint"><Eye className="size-3.5 text-link" aria-hidden />{q.view}</Link>
                    {r.acts.map((a) => {
                      const text = { DECLINE: q.decline, DATE: q.date, RESULT: q.result, ENROL: q.enrol, BACK: q.back, REVIEW: q.accept, ACCEPT: q.accept }[a.kind];
                      const Icon = { DECLINE: Ban, DATE: CalendarPlus, RESULT: ClipboardCheck, ENROL: UserPlus, BACK: Undo2, REVIEW: Check, ACCEPT: Check }[a.kind];
                      const tone = a.kind === "DECLINE" ? "text-bad" : a.kind === "REVIEW" || a.kind === "ACCEPT" ? "text-ok" : a.kind === "BACK" ? "text-warn" : "text-link";
                      const hover = a.kind === "DECLINE" ? "hover:border-bad/60 hover:bg-bad/10" : a.kind === "REVIEW" || a.kind === "ACCEPT" ? "hover:border-ok/60 hover:bg-ok/10" : a.kind === "BACK" ? "hover:border-warn/60 hover:bg-warn/10" : "hover:border-brand-500 hover:bg-tint";
                      return (
                        <span key={a.kind} title={a.why ?? undefined}>
                          <button type="button" disabled={a.why !== null} aria-label={`${text}: ${r.name}`} onClick={() => openAsk(r, a.kind)} className={`group inline-flex min-h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[13px] font-medium text-ink transition-colors ${hover} disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-surface`}>
                            <Icon className={`size-3.5 ${tone} group-disabled:text-muted`} aria-hidden />{text}
                          </button>
                        </span>
                      );
                    })}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      <dialog ref={dialog} onClose={closeAsk} className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink shadow-[var(--shadow-lift)] backdrop:bg-black/60">
        {ask && (
          <form onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); startTransition(() => quickForm(data)); }} className="space-y-4 p-5">
            <input type="hidden" name="id" value={ask.row.id} />
            <input type="hidden" name="name" value={ask.row.name} />
            <input type="hidden" name="kind" value={ask.kind} />
            <h2 className="text-lg font-semibold text-heading">
              {({ REVIEW: q.reviewQ, ACCEPT: q.acceptQ, ENROL: q.enrolQ, DECLINE: q.declineQ, DATE: q.dateQ, RESULT: q.resultQ, BACK: q.backQ })[ask.kind].replace("{name}", ask.row.name).replace("{class}", ask.row.className2)}
            </h2>
            {ask.kind === "REVIEW" && (
              <>
                <p className="text-sm text-muted">{ask.row.interviewDetail ? q.reviewHasDate.replace("{date}", ask.row.interviewDetail) : ask.row.afterReview === "placement" ? q.reviewToAccepted : q.reviewToInterview}</p>
                {ask.row.afterReview === "interview" && !ask.row.interviewDetail && dateFields}
                {ask.row.pendingDocs > 0 && (
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="papersChecked" required className="mt-1 size-4 accent-brand-600" /><span>{q.papersChecked.replace("{n}", String(ask.row.pendingDocs))}</span></label>
                )}
              </>
            )}
            {ask.kind === "ACCEPT" && <p className="text-sm text-muted">{q.acceptAfter}</p>}
            {ask.kind === "ENROL" && <p className="text-sm text-muted">{q.enrolAfter}</p>}
            {ask.kind === "BACK" && (
              <>
                <input name="note" required maxLength={500} autoFocus defaultValue={ask.row.missing.length ? q.backDefault.replace("{list}", ask.row.missing.join(", ")) : ""} aria-label={q.backNote} placeholder={q.backNote} className="min-h-11 w-full rounded-md border border-line bg-surface px-3" />
                <p className="text-xs text-muted">{q.backAfter}</p>
              </>
            )}
            {ask.kind === "DECLINE" && <input name="reason" required maxLength={300} autoFocus aria-label={q.declineReason} placeholder={q.declineReason} className="min-h-11 w-full rounded-md border border-line bg-surface px-3" />}
            {ask.kind === "DATE" && dateFields}
            {ask.kind === "RESULT" && (
              <div className="space-y-3 text-sm">
                <div className="flex gap-4">
                  <label className="flex items-center gap-2"><input type="radio" name="outcome" value="PASSED" required checked={result === "PASSED"} onChange={() => setResult("PASSED")} className="size-4 accent-brand-600" />{q.resultPassed}</label>
                  <label className="flex items-center gap-2"><input type="radio" name="outcome" value="NOT_PASSED" checked={result === "NOT_PASSED"} onChange={() => setResult("NOT_PASSED")} className="size-4 accent-brand-600" />{q.resultNot}</label>
                </div>
                {result === "PASSED" && ask.row.pendingDocs > 0 && (
                  <label className="flex items-start gap-2"><input type="checkbox" name="papersChecked" required className="mt-1 size-4 accent-brand-600" /><span>{q.papersChecked.replace("{n}", String(ask.row.pendingDocs))}</span></label>
                )}
                <input name="note" maxLength={500} aria-label={q.resultNote} placeholder={q.resultNote} className="min-h-11 w-full rounded-md border border-line bg-surface px-3" />
                <p className="text-xs text-muted">{q.resultHint}</p>
              </div>
            )}
            {fail && <p role="alert" className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{fail} <Link href={`/admissions/${ask.row.id}`} className="font-semibold underline">{q.open}</Link></p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeAsk} className="min-h-10 rounded-md px-4 text-sm text-muted hover:text-ink">{q.cancel}</button>
              <button disabled={quickPending} className={`min-h-10 rounded-md px-4 text-sm font-semibold text-white disabled:opacity-60 ${ask.kind === "DECLINE" ? "bg-bad hover:opacity-90" : "bg-brand-700 hover:bg-brand-800"}`}>
                {({ DECLINE: q.declineGo, DATE: q.dateGo, RESULT: q.resultGo, ENROL: q.enrolGo, BACK: q.backGo, REVIEW: q.confirm, ACCEPT: q.confirm })[ask.kind]}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
