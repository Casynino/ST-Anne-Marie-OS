import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/lib/offline/idb";
import { clearAllOfflineData, enqueueSubmission, listOps, listSheets, putOp, recoverInterrupted, requeueOp, saveSheets, uuid, type DownloadedSheet } from "@/lib/offline/store";
import { syncQueue } from "@/lib/offline/sync";

const USER = "user-1";
const base = { userId: USER, classId: "c1", streamId: null, sessionId: "s1", date: "2026-10-20", label: "Std I" };
const entries = [{ studentId: "a", status: "PRESENT" as const }];

const reply = (results: unknown[], status = 200) => new Response(JSON.stringify({ results }), { status, headers: { "content-type": "application/json" } });
const fetchWith = (fn: (ops: { clientOpId: string }[]) => Response | Promise<Response>): typeof fetch =>
  (async (_url: unknown, init?: RequestInit) => fn(JSON.parse(String(init?.body)).ops)) as typeof fetch;

beforeEach(async () => {
  await clearAllOfflineData();
});

describe("offline outbox", () => {
  it("replaces an unsent operation in place but never reuses the id of one that may have reached the server", async () => {
    const a = await enqueueSubmission({ ...base, kind: "SAVE_DRAFT", entries });
    const b = await enqueueSubmission({ ...base, kind: "FINALISE", entries: [{ studentId: "a", status: "ABSENT" }] });
    expect(b.opId).toBe(a.opId);
    expect((await listOps(USER))).toHaveLength(1);
    expect((await listOps(USER))[0]!.kind).toBe("FINALISE");
    await putOp({ ...b, attempts: 1 }); // a send was attempted
    const c = await enqueueSubmission({ ...base, kind: "FINALISE", entries });
    expect(c.opId).not.toBe(a.opId);
    expect(await listOps(USER)).toHaveLength(2);
  });

  it("generates RFC 4122 v4 identifiers", () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("keeps operations queued — never 'synced' — while the network is down, then syncs them", async () => {
    const op = await enqueueSubmission({ ...base, kind: "FINALISE", entries });
    const down = fetchWith(() => {
      throw new TypeError("Failed to fetch");
    });
    const r1 = await syncQueue(USER, down);
    expect(r1).toMatchObject({ networkError: true, applied: 0, pending: 1 });
    let [stored] = await listOps(USER);
    expect(stored).toMatchObject({ opId: op.opId, state: "queued", lastCode: "NETWORK", attempts: 1 });

    const up = fetchWith((ops) => reply(ops.map((o) => ({ opId: o.clientOpId, outcome: "APPLIED", code: "FINALISED" }))));
    const r2 = await syncQueue(USER, up);
    expect(r2).toMatchObject({ applied: 1, networkError: false });
    [stored] = await listOps(USER);
    expect(stored!.state).toBe("synced");
  });

  it("re-sends the same operation id after a lost response, so the server can answer with a replay", async () => {
    const op = await enqueueSubmission({ ...base, kind: "FINALISE", entries });
    const seen: string[] = [];
    const lostResponse = fetchWith((ops) => {
      seen.push(...ops.map((o) => o.clientOpId));
      throw new TypeError("connection reset after the server processed it");
    });
    await syncQueue(USER, lostResponse);
    expect((await listOps(USER))[0]!.state).toBe("queued");
    const answered = fetchWith((ops) => {
      seen.push(...ops.map((o) => o.clientOpId));
      return reply(ops.map((o) => ({ opId: o.clientOpId, outcome: "APPLIED", code: "FINALISED", replay: true })));
    });
    await syncQueue(USER, answered);
    expect(seen).toEqual([op.opId, op.opId]); // identical id both times
    expect((await listOps(USER))[0]!.state).toBe("synced");
  });

  it("maps server outcomes: conflict, rejection with reason, transient retry and expired session", async () => {
    const mk = (cls: string) => enqueueSubmission({ ...base, classId: cls, kind: "FINALISE", entries });
    const [c, r, t] = [await mk("c-conflict"), await mk("c-reject"), await mk("c-retry")];
    const server = fetchWith(() =>
      reply([
        { opId: c.opId, outcome: "CONFLICT", code: "ALREADY_FINALISED" },
        { opId: r.opId, outcome: "REJECTED", code: "VALIDATION", reason: "ROSTER_CHANGED", message: "class list changed" },
        { opId: t.opId, outcome: "RETRY", code: "SERVER_ERROR" },
      ]),
    );
    const report = await syncQueue(USER, server);
    expect(report).toMatchObject({ conflicts: 1, failed: 1, pending: 1, applied: 0 });
    const byId = Object.fromEntries((await listOps(USER)).map((o) => [o.opId, o]));
    expect(byId[c.opId]).toMatchObject({ state: "conflict", lastCode: "ALREADY_FINALISED" });
    expect(byId[r.opId]).toMatchObject({ state: "failed", lastCode: "ROSTER_CHANGED" });
    expect(byId[t.opId]!.state).toBe("queued");

    // Failed operations are only re-sent when the user asks; conflicts never are.
    expect((await syncQueue(USER, fetchWith(() => reply([])))).attempted).toBe(1);
    await requeueOp(r.opId);
    expect((await listOps(USER)).find((o) => o.opId === r.opId)!.state).toBe("queued");

    const signedOut = await syncQueue(USER, fetchWith(() => new Response("{}", { status: 401 })));
    expect(signedOut.unauthenticated).toBe(true);
    expect((await listOps(USER)).filter((o) => o.state === "queued").length).toBeGreaterThan(0);
  });

  it("returns operations interrupted mid-sync to the queue and wipes everything on request", async () => {
    const op = await enqueueSubmission({ ...base, kind: "SAVE_DRAFT", entries });
    await putOp({ ...op, state: "syncing" });
    await recoverInterrupted(USER);
    expect((await listOps(USER))[0]!.state).toBe("queued");
    const sheet = { date: "2026-10-20", academicYearId: "y", class: { id: "c1", name: "Std I" }, stream: null, session: { id: "s1", code: "DAY", name: "Full day", nameSw: null }, register: null, students: [], records: {}, markedElsewhere: [] } satisfies DownloadedSheet;
    await saveSheets(USER, [sheet], { downloadedAt: new Date().toISOString(), timezone: "Africa/Dar_es_Salaam" });
    await saveSheets("someone-else", [sheet], { downloadedAt: new Date().toISOString(), timezone: "UTC" });
    expect(await listSheets(USER)).toHaveLength(1); // other users' downloads are invisible
    await clearAllOfflineData();
    expect(await listOps(USER)).toHaveLength(0);
    expect(await listSheets(USER)).toHaveLength(0);
    await closeDb();
  });
});
