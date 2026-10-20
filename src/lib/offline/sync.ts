import { getDeviceId, listOps, putOp, recoverInterrupted, type QueuedOp } from "./store";

export type SyncReport = {
  attempted: number;
  applied: number;
  conflicts: number;
  failed: number;
  /** Still queued (network down or server error); will be retried. */
  pending: number;
  unauthenticated: boolean;
  networkError: boolean;
};

const BATCH = 20;
let inFlight: Promise<SyncReport> | null = null;

type ServerResult = { opId: string | null; outcome: "APPLIED" | "CONFLICT" | "REJECTED" | "RETRY"; code?: string; reason?: string; message?: string };

const toPayload = (op: QueuedOp) => ({
  clientOpId: op.opId,
  kind: op.kind,
  classId: op.classId,
  streamId: op.streamId,
  sessionId: op.sessionId,
  date: op.date,
  entries: op.entries,
  clientCreatedAt: op.clientCreatedAt,
});

/**
 * Sends queued operations to the server in creation order. An operation becomes "synced" ONLY after the
 * server's response says APPLIED. Network errors and 5xx leave it queued for the next attempt; because the
 * server de-duplicates on the operation id, a request whose response was lost is safe to send again.
 */
export function syncQueue(userId: string, fetchImpl: typeof fetch = fetch): Promise<SyncReport> {
  inFlight ??= doSync(userId, fetchImpl).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doSync(userId: string, fetchImpl: typeof fetch): Promise<SyncReport> {
  const report: SyncReport = { attempted: 0, applied: 0, conflicts: 0, failed: 0, pending: 0, unauthenticated: false, networkError: false };
  await recoverInterrupted(userId);
  const queue = (await listOps(userId)).filter((o) => o.state === "queued");
  if (!queue.length) return report;
  const deviceId = await getDeviceId();

  for (let i = 0; i < queue.length; i += BATCH) {
    const batch = queue.slice(i, i + BATCH);
    for (const op of batch) await putOp({ ...op, state: "syncing", attempts: op.attempts + 1, updatedAt: new Date().toISOString() });
    report.attempted += batch.length;

    const requeue = async (code: string) => {
      for (const op of batch) await putOp({ ...op, state: "queued", attempts: op.attempts + 1, lastCode: code, lastMessage: undefined, updatedAt: new Date().toISOString() });
      report.pending += batch.length;
    };

    let res: Response;
    try {
      res = await fetchImpl("/api/attendance/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ deviceId, ops: batch.map(toPayload) }),
      });
    } catch {
      report.networkError = true;
      await requeue("NETWORK");
      break; // stay in order: later batches wait for the connection
    }
    if (res.status === 401) {
      report.unauthenticated = true;
      await requeue("UNAUTHENTICATED");
      break;
    }
    if (!res.ok) {
      if (res.status >= 500) {
        report.networkError = true;
        await requeue("SERVER_ERROR");
        break;
      }
      for (const op of batch) await putOp({ ...op, state: "failed", attempts: op.attempts + 1, lastCode: `HTTP_${res.status}`, updatedAt: new Date().toISOString() });
      report.failed += batch.length;
      continue;
    }
    let results: ServerResult[];
    try {
      results = ((await res.json()) as { results: ServerResult[] }).results;
    } catch {
      await requeue("BAD_RESPONSE");
      break;
    }
    for (const op of batch) {
      const r = results.find((x) => x.opId === op.opId);
      const base = { ...op, attempts: op.attempts + 1, updatedAt: new Date().toISOString() };
      if (!r || r.outcome === "RETRY") {
        await putOp({ ...base, state: "queued", lastCode: r?.code ?? "NO_RESULT" });
        report.pending++;
      } else if (r.outcome === "APPLIED") {
        await putOp({ ...base, state: "synced", lastCode: r.code, lastMessage: undefined });
        report.applied++;
      } else if (r.outcome === "CONFLICT") {
        await putOp({ ...base, state: "conflict", lastCode: r.code });
        report.conflicts++;
      } else {
        await putOp({ ...base, state: "failed", lastCode: r.reason ?? r.code, lastMessage: r.message });
        report.failed++;
      }
    }
  }
  return report;
}
