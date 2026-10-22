"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { makeT, type Locale } from "@/lib/i18n";
import { clearAllOfflineData, listSheets, pruneSheets, purgeSynced, saveDeviceSession, saveSheets, type DownloadedSheet, type SheetRecord } from "@/lib/offline/store";
import { ConnectionLine } from "./sheet-editor";
import { OpStatus } from "./op-status";
import { useOutbox } from "./use-outbox";
import { registerOfflineSupport } from "./sw-register";

/** Download class lists, see what is on this device and what has not synced. Shown on the attendance home page. */
export function OfflinePanel({ userId, locale, timezone, fullName, canTake }: { userId: string; locale: Locale; timezone: string; fullName: string; canTake: boolean }) {
  const t = useMemo(() => makeT(locale), [locale]);
  const outbox = useOutbox(userId);
  const [sheets, setSheets] = useState<SheetRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      setSheets(await listSheets(userId));
    } catch {
      /* IndexedDB unavailable: the outbox hook reports it */
    }
  }, [userId]);

  useEffect(() => {
    void (async () => {
      try {
        await saveDeviceSession({ userId, locale, timezone, fullName });
        await purgeSynced(userId, 2 * 86_400_000);
      } catch {
        /* unsupported */
      }
      await reload();
    })();
    if (canTake) registerOfflineSupport();
  }, [userId, locale, timezone, fullName, canTake, reload]);

  const download = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/attendance/roster", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { downloadedAt: string; timezone: string; today: string; date: string; sheets: DownloadedSheet[] };
      await saveSheets(userId, data.sheets, { downloadedAt: data.downloadedAt, timezone: data.timezone });
      await pruneSheets(userId, data.today);
      await reload();
      setMessage({ ok: true, text: t("off.downloaded", { count: data.sheets.length, date: data.date }) });
      registerOfflineSupport(); // makes sure the offline page itself is cached too
    } catch {
      setMessage({ ok: false, text: t("off.downloadFailed") });
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!window.confirm(t("off.clear.confirm"))) return;
    await clearAllOfflineData();
    await reload();
    await outbox.sync();
  };

  const fmt = (iso: string) => new Intl.DateTimeFormat(locale === "SW" ? "sw-TZ" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(iso));

  return (
    <section className="mb-5 rounded-xl border border-line bg-surface p-4" aria-label={t("off.title")}>
      <ConnectionLine t={t} online={outbox.online} unsynced={outbox.unsynced} syncing={outbox.syncing} onSync={outbox.sync} />
      {outbox.needsSignIn && <p role="alert" className="mb-3 rounded-lg border border-warn/30 bg-amber-50 px-3 py-2 text-sm text-warn">{t("off.signInAgain")}</p>}
      {outbox.ops.filter((o) => o.state !== "synced").map((op) => (
        <OpStatus key={op.opId} op={op} t={t} showLabel onRetry={() => outbox.retry(op.opId)} onDiscard={() => outbox.discard(op.opId)} />
      ))}
      {canTake && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={download} disabled={busy || !outbox.online} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-700 px-4 text-base font-semibold text-white hover:bg-brand-800 disabled:opacity-50 btn-primary">
              <Download className="size-5" aria-hidden /> {busy ? t("off.downloading") : t("off.download")}
            </button>
            <Link href="/offline-attendance" className="inline-flex min-h-12 items-center rounded-xl border border-line px-4 text-base font-medium hover:bg-canvas">
              {t("off.title")}
            </Link>
          </div>
          {message && (
            <p role="status" className={`mt-2 text-sm ${message.ok ? "text-ok" : "text-bad"}`}>
              {message.text}
            </p>
          )}
          {sheets.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t("off.noDownloads")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-line text-sm">
              {sheets.map((s) => (
                <li key={s.key} className="flex flex-wrap justify-between gap-2 py-2">
                  <span className="font-medium">
                    {s.sheet.class.name}
                    {s.sheet.stream ? ` · ${s.sheet.stream.name}` : ""} · {s.sheet.session.name} · {s.sheet.date}
                  </span>
                  <span className="text-muted">{t("off.downloadedAt", { when: fmt(s.downloadedAt) })}</span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={clear} className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm text-muted hover:text-ink">
            <Trash2 className="size-4" aria-hidden /> {t("off.clear")}
          </button>
          <p className="text-xs text-muted">{t("off.clear.hint")}</p>
        </>
      )}
    </section>
  );
}
