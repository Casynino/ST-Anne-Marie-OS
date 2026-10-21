"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { Ban, CalendarPlus, Check, ClipboardCheck, Undo2, UserPlus } from "lucide-react";
import type { ActionState } from "@/lib/action";

/*
 * The steps of an application as buttons (Accept, Send back, Decline, Set date, Result, Enrol), each asking in a pop-up first. Shared by the
 * Admissions list (one pop-up for every row) and the application page (the same buttons at the top). The server applies the same rules
 * wherever the button is pressed, and says why when it refuses.
 */

export type Kind = "REVIEW" | "ACCEPT" | "DECLINE" | "DATE" | "RESULT" | "ENROL" | "BACK";
export type QuickLabels = Record<"column" | "view" | "accept" | "decline" | "date" | "result" | "acceptQ" | "acceptAfter" | "declineQ" | "declineReason" | "declineGo" | "confirm" | "open" | "cancel" | "reviewQ" | "reviewToInterview" | "reviewToAccepted" | "reviewHasDate" | "papersChecked" | "dateQ" | "dateSlot" | "dateOther" | "dateWhen" | "dateGo" | "resultQ" | "resultPassed" | "resultNot" | "resultNote" | "resultGo" | "resultHint" | "enrol" | "enrolQ" | "enrolAfter" | "enrolGo" | "back" | "backQ" | "backNote" | "backDefault" | "backAfter" | "backGo", string>;
export type QuickSlot = { value: string; label: string; classIds: string[] | null };
/** What the buttons and pop-ups need to know about one application. */
export type QuickLine = {
  id: string; name: string; className2: string; classId: string | null; acts: { kind: Kind; why: string | null }[];
  afterReview: "interview" | "placement"; pendingDocs: number; missing: string[]; interviewDetail: string | null;
};
type Quick = (prev: ActionState, form: FormData) => Promise<ActionState>;

export function useQuickActions({ labels, dismiss, quick, slots }: { labels: QuickLabels; dismiss: string; quick: Quick; slots: QuickSlot[] }) {
  const q = labels;
  const [ask, setAsk] = useState<{ row: QuickLine; kind: Kind } | null>(null);
  const [slot, setSlot] = useState("");
  const [result, setResult] = useState("");
  const [done, setDone] = useState<{ name: string; text: string } | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [, quickForm, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const name = String(form.get("name") ?? "");
    const r = await quick(prev, form);
    if (r?.ok) { setDone({ name, text: r.message ?? "" }); setAsk(null); setFail(null); }
    else if (r) setFail(r.error);
    return r;
  }, null);
  const open = (r: QuickLine, kind: Kind) => {
    setDone(null); setFail(null); setResult("");
    // the interview day that covers the applicant's class comes first
    setSlot((slots.find((x) => x.classIds && (x.classIds.length === 0 || (r.classId !== null && x.classIds.includes(r.classId)))) ?? slots[0])?.value ?? "");
    setAsk({ row: r, kind });
  };
  const close = () => { setAsk(null); setFail(null); };
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (ask && !d.open) d.showModal();
    if (!ask && d.open) d.close();
  }, [ask]);

  // The interview date: one of the days the school set, or another date and time.
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

  const banner: ReactNode = done && (
    <p role="status" className="flex flex-wrap items-center gap-x-3 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm"><span className="font-semibold text-ok">{done.name}</span><span>{done.text}</span><button type="button" onClick={() => setDone(null)} className="ml-auto text-link hover:underline">{dismiss}</button></p>
  );

  const popup: ReactNode = (
    <dialog ref={dialog} onClose={close} className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink shadow-[var(--shadow-lift)] backdrop:bg-black/60">
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
            <button type="button" onClick={close} className="min-h-10 rounded-md px-4 text-sm text-muted hover:text-ink">{q.cancel}</button>
            <button disabled={pending} className={`min-h-10 rounded-md px-4 text-sm font-semibold text-white disabled:opacity-60 ${ask.kind === "DECLINE" ? "bg-bad hover:opacity-90" : "bg-brand-700 hover:bg-brand-800"}`}>
              {({ DECLINE: q.declineGo, DATE: q.dateGo, RESULT: q.resultGo, ENROL: q.enrolGo, BACK: q.backGo, REVIEW: q.confirm, ACCEPT: q.confirm })[ask.kind]}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );

  return { open, banner, popup };
}

/** The buttons for the steps this application is at. `size` "md" is for the application page, "sm" for the list. */
export function ActionButtons({ row, labels: q, open, size = "sm" }: { row: QuickLine; labels: QuickLabels; open: (row: QuickLine, kind: Kind) => void; size?: "sm" | "md" }) {
  const box = size === "md" ? "min-h-10 px-3 text-sm" : "min-h-8 px-2.5 text-[13px]";
  return (
    <>
      {row.acts.map((a) => {
        const text = { DECLINE: q.decline, DATE: q.date, RESULT: q.result, ENROL: q.enrol, BACK: q.back, REVIEW: q.accept, ACCEPT: q.accept }[a.kind];
        const Icon = { DECLINE: Ban, DATE: CalendarPlus, RESULT: ClipboardCheck, ENROL: UserPlus, BACK: Undo2, REVIEW: Check, ACCEPT: Check }[a.kind];
        const tone = a.kind === "DECLINE" ? "text-bad" : a.kind === "REVIEW" || a.kind === "ACCEPT" ? "text-ok" : a.kind === "BACK" ? "text-warn" : "text-link";
        const hover = a.kind === "DECLINE" ? "hover:border-bad/60 hover:bg-bad/10" : a.kind === "REVIEW" || a.kind === "ACCEPT" ? "hover:border-ok/60 hover:bg-ok/10" : a.kind === "BACK" ? "hover:border-warn/60 hover:bg-warn/10" : "hover:border-brand-500 hover:bg-tint";
        return (
          <span key={a.kind} title={a.why ?? undefined}>
            <button type="button" disabled={a.why !== null} aria-label={`${text}: ${row.name}`} onClick={() => open(row, a.kind)} className={`group inline-flex items-center gap-1.5 rounded-md border border-line bg-surface font-medium text-ink transition-colors ${box} ${hover} disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-surface`}>
              <Icon className={`size-3.5 ${tone} group-disabled:text-muted`} aria-hidden />{text}
            </button>
          </span>
        );
      })}
    </>
  );
}

/** The same buttons at the top of an application's own page, with the same pop-ups and the result message under them. */
export function QuickBar({ line, labels, dismiss, quick, slots }: { line: QuickLine; labels: QuickLabels; dismiss: string; quick: Quick; slots: QuickSlot[] }) {
  const { open, banner, popup } = useQuickActions({ labels, dismiss, quick, slots });
  return (
    <div className="space-y-2">
      {line.acts.length > 0 && <div className="flex flex-wrap gap-2"><ActionButtons row={line} labels={labels} open={open} size="md" /></div>}
      {banner}
      {popup}
    </div>
  );
}
