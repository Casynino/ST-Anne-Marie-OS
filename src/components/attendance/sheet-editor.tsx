"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, CloudOff, Loader2, Lock, RefreshCw } from "lucide-react";
import { makeT, type Locale } from "@/lib/i18n";
import { registerKey, type AttendanceStatusValue, type DownloadedSheet, type OpEntry, type QueuedOp } from "@/lib/offline/store";
import { useOutbox } from "./use-outbox";
import { OpStatus } from "./op-status";

const STATUSES: AttendanceStatusValue[] = ["PRESENT", "ABSENT", "LATE", "EXCUSED"];
const STYLE: Record<AttendanceStatusValue, string> = {
  PRESENT: "border-ok bg-ok text-white",
  ABSENT: "border-bad bg-bad text-white",
  LATE: "border-warn bg-warn text-white",
  EXCUSED: "border-brand-600 bg-brand-600 text-white",
};

type Marks = Record<string, { status: AttendanceStatusValue | null; note: string }>;
export type EditorSheet = DownloadedSheet & {
  canTake: boolean;
  register: (DownloadedSheet["register"] & { startedByName?: string | null; finalisedByName?: string | null; finalisedAt?: string | Date | null }) | null;
};

function baseMarks(sheet: EditorSheet, latest: QueuedOp | undefined): Marks {
  const out: Marks = {};
  for (const s of sheet.students) {
    const r = sheet.records[s.id];
    out[s.id] = { status: r?.status ?? null, note: r?.note ?? "" };
  }
  // Local changes the server may not have yet (queued, in flight, failed) or has just confirmed.
  if (latest && latest.state !== "conflict") for (const e of latest.entries) if (e.studentId in out) out[e.studentId] = { status: e.status, note: e.note ?? "" };
  return out;
}

const fmtDate = (iso: string, locale: Locale) => new Intl.DateTimeFormat(locale === "SW" ? "sw-TZ" : "en-GB", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${iso}T00:00:00Z`));

/**
 * Mobile-first attendance form. Every save goes through the on-device outbox: it is stored first, then
 * sent; the screen says "Saved on the server" only after the server confirmed.
 */
export function SheetEditor({ userId, locale, sheet, source, onClose }: { userId: string; locale: Locale; sheet: EditorSheet; source: "server" | "device"; onClose?: () => void }) {
  const t = useMemo(() => makeT(locale), [locale]);
  const router = useRouter();
  const outbox = useOutbox(userId);
  const key = registerKey(userId, sheet.class.id, sheet.stream?.id ?? null, sheet.session.id, sheet.date);
  const mine = outbox.ops.filter((o) => o.registerKey === key);
  const latest = mine[mine.length - 1];

  const [marks, setMarks] = useState<Marks>(() => baseMarks(sheet, undefined));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);

  // Adopt the outbox state once it has loaded, unless the teacher already started editing.
  useEffect(() => {
    if (!dirty) setMarks(baseMarks(sheet, latest));
  }, [sheet, latest, dirty]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = t("att.leave");
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, t]);

  // After the server confirms a submission, reload server data so the page shows the truth.
  const confirmedId = latest?.state === "synced" ? latest.opId : null;
  useEffect(() => {
    if (source === "server" && confirmedId) router.refresh();
  }, [confirmedId, source, router]);

  const serverFinal = sheet.register?.status === "FINALISED";
  const localFinal = latest?.kind === "FINALISE" && (latest.state === "queued" || latest.state === "syncing" || latest.state === "synced");
  const conflicted = latest?.state === "conflict";
  const readOnly = !sheet.canTake || serverFinal || Boolean(localFinal) || conflicted;

  const students = sheet.students;
  const markable = students.filter((s) => !sheet.markedElsewhere.includes(s.id));
  const markedCount = markable.filter((s) => marks[s.id]?.status).length;
  const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
  for (const s of markable) {
    const st = marks[s.id]?.status;
    if (st) counts[st]++;
  }
  const unmarked = markable.length - markedCount;

  const setStatus = (id: string, status: AttendanceStatusValue) => {
    setDirty(true);
    setMarks((m) => ({ ...m, [id]: { status, note: status === "PRESENT" ? "" : (m[id]?.note ?? "") } }));
  };
  const setNote = (id: string, note: string) => {
    setDirty(true);
    setMarks((m) => ({ ...m, [id]: { status: m[id]?.status ?? null, note } }));
  };
  const markAllPresent = () => {
    setDirty(true);
    setMarks((m) => Object.fromEntries(Object.entries(m).map(([id, v]) => [id, v.status || sheet.markedElsewhere.includes(id) ? v : { status: "PRESENT" as const, note: "" }])));
  };

  const submit = async (kind: "SAVE_DRAFT" | "FINALISE") => {
    if (kind === "FINALISE" && !window.confirm(t("att.finalise.confirm"))) return;
    const entries: OpEntry[] = markable.flatMap((s) => {
      const m = marks[s.id];
      return m?.status ? [{ studentId: s.id, status: m.status, ...(m.note.trim() ? { note: m.note.trim() } : {}) }] : [];
    });
    if (!entries.length) return;
    const label = `${sheet.class.name}${sheet.stream ? ` ${sheet.stream.name}` : ""} · ${fmtDate(sheet.date, locale)} · ${sheet.session.name}`;
    setBusy(true);
    setDirectError(null);
    try {
      for (const failed of mine.filter((o) => o.state === "failed")) await outbox.discard(failed.opId);
      if (outbox.supported) {
        await outbox.enqueue({ userId, kind, classId: sheet.class.id, streamId: sheet.stream?.id ?? null, sessionId: sheet.session.id, date: sheet.date, entries, label });
        setDirty(false);
      } else {
        // No IndexedDB (very old/private browser): send directly; nothing can be queued for later.
        const res = await fetch("/api/attendance/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ops: [{ clientOpId: crypto.randomUUID(), kind, classId: sheet.class.id, streamId: sheet.stream?.id ?? null, sessionId: sheet.session.id, date: sheet.date, entries }] }),
        });
        const data = (await res.json()) as { results?: { outcome: string; code?: string }[] };
        const r = data.results?.[0];
        if (r?.outcome === "APPLIED") {
          setDirty(false);
          router.refresh();
        } else setDirectError(r?.code ?? "FAILED");
      }
    } catch {
      setDirectError("NETWORK");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">
          {sheet.class.name}
          {sheet.stream ? ` · ${sheet.stream.name}` : ""}
        </h2>
        <span className="text-sm text-muted">
          {fmtDate(sheet.date, locale)} · {sheet.session.name}
        </span>
        {onClose && (
          <button type="button" onClick={onClose} className="ml-auto min-h-11 rounded-lg border border-line bg-white px-3 text-sm font-medium hover:bg-canvas">
            {t("off.back")}
          </button>
        )}
      </div>

      <ConnectionLine t={t} online={outbox.online} unsynced={outbox.unsynced} syncing={outbox.syncing} onSync={outbox.sync} />

      {outbox.needsSignIn && (
        <p role="alert" className="mb-3 flex gap-2 rounded-lg border border-warn/30 bg-amber-50 px-3 py-2 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("off.signInAgain")}
        </p>
      )}
      {!outbox.supported && <p className="mb-3 rounded-lg border border-line bg-white px-3 py-2 text-sm text-muted">{t("off.unsupported")}</p>}
      {directError && <p role="alert" className="mb-3 rounded-lg border border-bad/30 bg-red-50 px-3 py-2 text-sm text-bad">{t("off.reason.generic", { message: directError })}</p>}

      {mine.slice(-2).map((op) => (
        <OpStatus
          key={op.opId}
          op={op}
          t={t}
          onRetry={() => outbox.retry(op.opId)}
          onDiscard={async () => {
            await outbox.discard(op.opId);
            setDirty(false);
            if (source === "server") router.refresh();
          }}
        />
      ))}

      {sheet.register?.status === "FINALISED" && (
        <p className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm">
          <Lock className="size-4 shrink-0 text-muted" aria-hidden />
          {t("att.finalisedBy", { name: sheet.register.finalisedByName ?? "—", when: sheet.register.finalisedAt ? new Intl.DateTimeFormat(locale === "SW" ? "sw-TZ" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(sheet.register.finalisedAt)) : "—" })}
        </p>
      )}
      {sheet.register?.status === "DRAFT" && sheet.register.startedByName && <p className="mb-3 text-sm text-muted">{t("att.startedBy", { name: sheet.register.startedByName })}</p>}
      {!sheet.canTake && !serverFinal && <p className="mb-3 text-sm text-muted">{t("att.readOnly")}</p>}

      {students.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-white px-4 py-8 text-center text-sm text-muted">{t("att.noStudents")}</p>
      ) : (
        <>
          {!readOnly && (
            <button type="button" onClick={markAllPresent} className="mb-3 min-h-12 w-full rounded-xl border border-ok bg-white px-4 text-base font-semibold text-ok hover:bg-green-50 sm:w-auto">
              {t("att.markAll")}
            </button>
          )}
          <ul className="space-y-2" aria-label={t("att.students")}>
            {students.map((s) => {
              const m = marks[s.id] ?? { status: null, note: "" };
              const elsewhere = sheet.markedElsewhere.includes(s.id);
              return (
                <li key={s.id} className="rounded-xl border border-line bg-white p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 break-words font-medium">{s.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted">{s.admissionNo}</span>
                  </div>
                  {elsewhere ? (
                    <p className="mt-1 text-sm text-warn">{t("att.markedElsewhere")}</p>
                  ) : readOnly ? (
                    <p className="mt-1 text-sm">
                      {m.status ? <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${STYLE[m.status]}`}>{t(`att.status.${m.status}`)}</span> : <span className="text-muted">{t("att.unmarked")}</span>}
                      {m.note && <span className="ml-2 text-muted">{m.note}</span>}
                    </p>
                  ) : (
                    <>
                      <div role="radiogroup" aria-label={s.name} className="mt-2 grid grid-cols-4 gap-1.5">
                        {STATUSES.map((st) => {
                          const on = m.status === st;
                          return (
                            <button
                              key={st}
                              type="button"
                              role="radio"
                              aria-checked={on}
                              onClick={() => setStatus(s.id, st)}
                              className={`min-h-12 rounded-lg border px-1 text-[13px] font-semibold leading-tight ${on ? STYLE[st] : "border-line bg-white text-ink hover:bg-canvas"}`}
                            >
                              {t(`att.status.${st}`)}
                            </button>
                          );
                        })}
                      </div>
                      {m.status && m.status !== "PRESENT" && (
                        <input
                          type="text"
                          value={m.note}
                          maxLength={200}
                          onChange={(e) => setNote(s.id, e.target.value)}
                          placeholder={t("att.note")}
                          aria-label={`${t("att.note")} – ${s.name}`}
                          className="mt-2 block min-h-11 w-full rounded-lg border border-line px-3 text-base"
                        />
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Sticky action bar */}
          <div className="sticky bottom-0 z-10 -mx-3 mt-4 border-t border-line bg-white px-3 py-3 sm:mx-0 sm:rounded-xl sm:border">
            <p className="mb-2 text-sm">
              <strong>{t("att.marked", { marked: markedCount, total: markable.length })}</strong>
              <span className="block text-muted sm:ml-2 sm:inline">{t("att.summary", { present: counts.PRESENT, absent: counts.ABSENT, late: counts.LATE, excused: counts.EXCUSED })}</span>
            </p>
            {!readOnly && unmarked > 0 && <p className="mb-2 text-sm text-warn">{t("att.unmarkedLeft", { count: unmarked })}</p>}
            {!readOnly && (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={busy || markedCount === 0} onClick={() => submit("SAVE_DRAFT")} className="min-h-12 rounded-xl border border-brand-700 bg-white px-3 text-base font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50">
                  {t("att.saveDraft")}
                </button>
                <button type="button" disabled={busy || unmarked > 0 || markable.length === 0 || sheet.markedElsewhere.length > 0} onClick={() => submit("FINALISE")} className="min-h-12 rounded-xl bg-brand-700 px-3 text-base font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
                  {busy ? <Loader2 className="mx-auto size-5 animate-spin" aria-hidden /> : t("att.finalise")}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function ConnectionLine({ t, online, unsynced, syncing, onSync }: { t: ReturnType<typeof makeT>; online: boolean; unsynced: number; syncing: boolean; onSync: () => void }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm" role="status" aria-live="polite">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${online ? "bg-green-50 text-ok ring-green-200" : "bg-amber-50 text-warn ring-amber-200"}`}>
        {online ? <CheckCircle2 className="size-3.5" aria-hidden /> : <CloudOff className="size-3.5" aria-hidden />}
        {online ? t("off.online") : t("off.offline")}
      </span>
      <span className="text-muted">{unsynced > 0 ? t("off.unsynced", { count: unsynced }) : t("off.allSynced")}</span>
      {unsynced > 0 && (
        <button type="button" onClick={onSync} disabled={syncing || !online} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm font-medium hover:bg-canvas disabled:opacity-50">
          <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} aria-hidden /> {syncing ? t("off.syncing") : t("off.syncNow")}
        </button>
      )}
      {!online && <span className="basis-full text-muted">{t("off.offline.hint")}</span>}
    </div>
  );
}
