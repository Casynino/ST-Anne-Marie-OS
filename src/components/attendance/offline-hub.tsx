"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { makeT, type Locale } from "@/lib/i18n";
import { listSheets, loadDeviceSession, purgeSynced, type DeviceSession, type SheetRecord } from "@/lib/offline/store";
import { todayInTimezone } from "@/lib/dates";
import { SheetEditor, ConnectionLine, type EditorSheet } from "./sheet-editor";
import { OpStatus } from "./op-status";
import { useOutbox } from "./use-outbox";
import { registerOfflineSupport } from "./sw-register";

/**
 * The offline page: renders entirely from IndexedDB. It offers only class lists that were downloaded,
 * and only for the day they were downloaded for — nothing else is promised as available offline.
 */
export function OfflineHub() {
  const [session, setSession] = useState<DeviceSession | null | undefined>(undefined);
  const [sheets, setSheets] = useState<SheetRecord[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const locale: Locale = session?.locale ?? "EN";
  const t = useMemo(() => makeT(locale), [locale]);
  const outbox = useOutbox(session?.userId ?? null);

  useEffect(() => {
    registerOfflineSupport();
    void (async () => {
      try {
        const s = await loadDeviceSession();
        setSession(s);
        if (s) {
          await purgeSynced(s.userId, 2 * 86_400_000);
          setSheets(await listSheets(s.userId));
        }
      } catch {
        setSession(null);
      }
    })();
  }, []);

  if (session === undefined) return <p className="text-sm text-muted">…</p>;
  if (session === null) return <p className="rounded-xl border border-dashed border-line bg-surface px-4 py-8 text-center text-sm text-muted">{makeT("EN")("off.noDownloads")}</p>;

  const today = todayInTimezone(session.timezone);
  const open = sheets.find((s) => s.key === openKey);

  if (open) {
    const sheet: EditorSheet = { ...open.sheet, canTake: true, register: open.sheet.register };
    return <SheetEditor userId={session.userId} locale={locale} sheet={sheet} source="device" onClose={() => setOpenKey(null)} />;
  }

  return (
    <div>
      <p className="mb-3 text-sm text-muted">{t("off.intro")}</p>
      <ConnectionLine t={t} online={outbox.online} unsynced={outbox.unsynced} syncing={outbox.syncing} onSync={outbox.sync} />
      {outbox.needsSignIn && <p role="alert" className="mb-3 rounded-lg border border-warn/30 bg-amber-50 px-3 py-2 text-sm text-warn">{t("off.signInAgain")}</p>}
      {outbox.ops.filter((o) => o.state !== "synced").map((op) => (
        <OpStatus key={op.opId} op={op} t={t} showLabel onRetry={() => outbox.retry(op.opId)} onDiscard={() => outbox.discard(op.opId)} />
      ))}
      {sheets.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface px-4 py-8 text-center text-sm text-muted">{t("off.noDownloads")}</p>
      ) : (
        <ul className="space-y-2">
          {sheets.map((s) => {
            const stale = s.sheet.date !== today;
            return (
              <li key={s.key} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {s.sheet.class.name}
                    {s.sheet.stream ? ` · ${s.sheet.stream.name}` : ""}
                  </p>
                  <p className="text-sm text-muted">
                    {s.sheet.session.name} · {s.sheet.date} · {s.sheet.students.length}
                  </p>
                  {stale && <p className="text-sm text-warn">{t("off.staleDate", { date: s.sheet.date })}</p>}
                </div>
                <button type="button" onClick={() => setOpenKey(s.key)} className="min-h-12 rounded-xl bg-brand-700 px-5 text-base font-semibold text-white hover:bg-brand-800">
                  {t("off.open")}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-4 text-sm">
        <Link href="/attendance" className="text-link hover:underline">
          {t("att.title")}
        </Link>
      </p>
    </div>
  );
}
