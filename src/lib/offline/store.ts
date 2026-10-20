import { idb, STORES } from "./idb";

/*
 * Offline data model (per device, per signed-in user):
 *  - sheets: class lists the user explicitly downloaded (what the server returned, verbatim).
 *    Nothing that was not downloaded is ever offered offline.
 *  - ops: the outbox. Each op has a client-generated UUID; the server applies it at most once.
 */

export type SheetEntry = { id: string; admissionNo: string; name: string };
export type DownloadedSheet = {
  date: string;
  academicYearId: string;
  class: { id: string; name: string };
  stream: { id: string; name: string } | null;
  session: { id: string; code: string; name: string; nameSw: string | null };
  register: { id: string; status: "DRAFT" | "FINALISED" } | null;
  students: SheetEntry[];
  records: Record<string, { status: AttendanceStatusValue; note: string | null }>;
  markedElsewhere: string[];
};
export type AttendanceStatusValue = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";

export type SheetRecord = { key: string; userId: string; downloadedAt: string; timezone: string; sheet: DownloadedSheet };

export type OpState = "queued" | "syncing" | "synced" | "failed" | "conflict";
export type OpEntry = { studentId: string; status: AttendanceStatusValue; note?: string };
export type QueuedOp = {
  opId: string;
  userId: string;
  registerKey: string;
  kind: "SAVE_DRAFT" | "FINALISE";
  classId: string;
  streamId: string | null;
  sessionId: string;
  date: string;
  entries: OpEntry[];
  label: string;
  state: OpState;
  attempts: number;
  /** Server code for the last outcome (e.g. ALREADY_FINALISED) or a transport code (NETWORK, UNAUTHENTICATED). */
  lastCode?: string;
  lastMessage?: string;
  clientCreatedAt: string;
  updatedAt: string;
};

export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const registerKey = (userId: string, classId: string, streamId: string | null, sessionId: string, date: string) => `${userId}|${classId}|${streamId ?? ""}|${sessionId}|${date}`;

// ───────────────────────── Device id ─────────────────────────

export async function getDeviceId(): Promise<string> {
  const row = await idb.get<{ key: string; value: string }>(STORES.meta, "deviceId");
  if (row) return row.value;
  const value = uuid();
  await idb.put(STORES.meta, { key: "deviceId", value });
  return value;
}

// ───────────────────────── Device session ─────────────────────────

/** Who last used the app on this device (written while online). The offline page has no server-rendered user data. */
export type DeviceSession = { userId: string; locale: "EN" | "SW"; timezone: string; fullName: string };

export async function saveDeviceSession(s: DeviceSession) {
  await idb.put(STORES.meta, { key: "session", ...s });
}

export async function loadDeviceSession(): Promise<DeviceSession | null> {
  const row = await idb.get<DeviceSession & { key: string }>(STORES.meta, "session");
  return row ? { userId: row.userId, locale: row.locale, timezone: row.timezone, fullName: row.fullName } : null;
}

/** Sign-out: personal data (class lists, who was signed in) goes; unsynced operations stay so no work is lost. */
export async function clearDownloadedSheets() {
  await idb.clear(STORES.sheets);
  await idb.delete(STORES.meta, "session");
}

/** Removes confirmed operations older than `olderThanMs` (they only exist to show "synced" on screen). */
export async function purgeSynced(userId: string, olderThanMs: number) {
  const cutoff = Date.now() - olderThanMs;
  for (const op of await listOps(userId)) if (op.state === "synced" && Date.parse(op.updatedAt) < cutoff) await deleteOp(op.opId);
}

// ───────────────────────── Sheets ─────────────────────────

export async function saveSheets(userId: string, sheets: DownloadedSheet[], meta: { downloadedAt: string; timezone: string }) {
  for (const sheet of sheets) {
    const key = registerKey(userId, sheet.class.id, sheet.stream?.id ?? null, sheet.session.id, sheet.date);
    await idb.put(STORES.sheets, { key, userId, downloadedAt: meta.downloadedAt, timezone: meta.timezone, sheet } satisfies SheetRecord);
  }
}

export async function listSheets(userId: string): Promise<SheetRecord[]> {
  return (await idb.getAll<SheetRecord>(STORES.sheets)).filter((s) => s.userId === userId).sort((a, b) => a.sheet.class.name.localeCompare(b.sheet.class.name) || a.sheet.date.localeCompare(b.sheet.date));
}

export async function getSheet(key: string): Promise<SheetRecord | undefined> {
  return idb.get<SheetRecord>(STORES.sheets, key);
}

/** Removes downloaded lists for dates before `keepFrom` (yyyy-mm-dd). Unsynced ops are never touched. */
export async function pruneSheets(userId: string, keepFrom: string) {
  for (const s of await listSheets(userId)) if (s.sheet.date < keepFrom) await idb.delete(STORES.sheets, s.key);
}

// ───────────────────────── Outbox ─────────────────────────

export async function listOps(userId: string): Promise<QueuedOp[]> {
  return (await idb.getAll<QueuedOp>(STORES.ops)).filter((o) => o.userId === userId).sort((a, b) => a.clientCreatedAt.localeCompare(b.clientCreatedAt));
}

export async function putOp(op: QueuedOp) {
  await idb.put(STORES.ops, op);
}

export async function deleteOp(opId: string) {
  await idb.delete(STORES.ops, opId);
}

/**
 * Queues the current state of a register. If an earlier op for the same register has never been sent
 * (attempts = 0) it is replaced in place — the server cannot have seen it. Otherwise a new op is added:
 * reusing an id the server may already have processed would make the server ignore the new content.
 */
export async function enqueueSubmission(p: {
  userId: string;
  kind: QueuedOp["kind"];
  classId: string;
  streamId: string | null;
  sessionId: string;
  date: string;
  entries: OpEntry[];
  label: string;
  now?: Date;
}): Promise<QueuedOp> {
  const key = registerKey(p.userId, p.classId, p.streamId, p.sessionId, p.date);
  const now = (p.now ?? new Date()).toISOString();
  const existing = (await listOps(p.userId)).find((o) => o.registerKey === key && o.state === "queued" && o.attempts === 0);
  const op: QueuedOp = existing
    ? { ...existing, kind: p.kind, entries: p.entries, label: p.label, updatedAt: now }
    : {
        opId: uuid(),
        userId: p.userId,
        registerKey: key,
        kind: p.kind,
        classId: p.classId,
        streamId: p.streamId,
        sessionId: p.sessionId,
        date: p.date,
        entries: p.entries,
        label: p.label,
        state: "queued",
        attempts: 0,
        clientCreatedAt: now,
        updatedAt: now,
      };
  await putOp(op);
  return op;
}

/** Returns a failed op to the queue (same id: if the server did process it, the replay is harmless). */
export async function requeueOp(opId: string) {
  const op = await idb.get<QueuedOp>(STORES.ops, opId);
  if (op && op.state === "failed") await putOp({ ...op, state: "queued", lastCode: undefined, lastMessage: undefined, updatedAt: new Date().toISOString() });
}

/** Operations interrupted mid-flight (tab closed while "syncing") go back to the queue. */
export async function recoverInterrupted(userId: string) {
  for (const op of await listOps(userId)) if (op.state === "syncing") await putOp({ ...op, state: "queued" });
}

export const isUnsynced = (o: QueuedOp) => o.state === "queued" || o.state === "syncing" || o.state === "failed";

/** Everything stored on this device. Called on sign-out and from the "remove offline data" button. */
export async function clearAllOfflineData() {
  await Promise.all([idb.clear(STORES.sheets), idb.clear(STORES.ops)]);
}
