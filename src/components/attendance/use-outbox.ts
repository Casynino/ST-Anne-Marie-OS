"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deleteOp, enqueueSubmission, listOps, recoverInterrupted, requeueOp, type QueuedOp } from "@/lib/offline/store";
import { syncQueue } from "@/lib/offline/sync";

const CHANGED = "sam-outbox-changed";
const notifyChanged = () => window.dispatchEvent(new Event(CHANGED));

export type Outbox = {
  ops: QueuedOp[];
  online: boolean;
  syncing: boolean;
  needsSignIn: boolean;
  supported: boolean;
  unsynced: number;
  sync: () => Promise<void>;
  enqueue: (p: Parameters<typeof enqueueSubmission>[0]) => Promise<QueuedOp>;
  discard: (opId: string) => Promise<void>;
  retry: (opId: string) => Promise<void>;
};

/**
 * Reads the device outbox and keeps it syncing. "online" reflects both the browser's flag and whether the
 * last sync attempt actually reached the server, so a captive portal or dead mobile data shows as offline.
 */
export function useOutbox(userId: string | null): Outbox {
  const [ops, setOps] = useState<QueuedOp[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [supported, setSupported] = useState(true);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      setOps(await listOps(userId));
    } catch {
      setSupported(false);
    }
  }, [userId]);

  const sync = useCallback(async () => {
    if (!userId || busy.current) return;
    busy.current = true;
    setSyncing(true);
    try {
      const report = await syncQueue(userId);
      setNeedsSignIn(report.unauthenticated);
      setOnline(report.networkError ? false : navigator.onLine);
    } catch {
      setSupported(false);
    } finally {
      busy.current = false;
      setSyncing(false);
      await refresh();
      notifyChanged();
    }
  }, [userId, refresh]);

  useEffect(() => {
    setOnline(navigator.onLine);
    if (!userId) return;
    void (async () => {
      try {
        await recoverInterrupted(userId);
      } catch {
        setSupported(false);
        return;
      }
      await refresh();
      void sync();
    })();
    const onOnline = () => {
      setOnline(true);
      void sync();
    };
    const onOffline = () => setOnline(false);
    const onChanged = () => void refresh();
    const onVisible = () => document.visibilityState === "visible" && void sync();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(CHANGED, onChanged);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void sync(), 30_000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(CHANGED, onChanged);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [userId, refresh, sync]);

  const enqueue: Outbox["enqueue"] = async (p) => {
    const op = await enqueueSubmission(p);
    await refresh();
    notifyChanged();
    void sync();
    return op;
  };
  const discard = async (opId: string) => {
    await deleteOp(opId);
    await refresh();
    notifyChanged();
  };
  const retry = async (opId: string) => {
    await requeueOp(opId);
    await refresh();
    void sync();
  };

  return { ops, online, syncing, needsSignIn, supported, unsynced: ops.filter((o) => o.state === "queued" || o.state === "syncing" || o.state === "failed").length, sync, enqueue, discard, retry };
}
