import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import { authenticate, MAX_FAILURES_PER_IDENTIFIER } from "@/lib/auth/login";
import { activityPanel, securityPanel, systemPanel } from "@/server/ops";
import { recordJobRun, recordServerError } from "@/server/monitor";
import { createTestSchool, createTestUser } from "../helpers";

let admin: AuthContext, registrar: AuthContext, teacher: AuthContext;
let email: string;
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const meta = (ip: string) => ({ ip, userAgent: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36" });
const PASSWORD = "Passw0rd-test-1";

beforeAll(async () => {
  const school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  const t = await createTestUser(school.id, ["class_teacher"]);
  teacher = t.ctx;
  email = t.user.email!;
});

describe("sign-in history", () => {
  const ip = "203.0.113." + (10 + Math.floor(Math.random() * 200));

  it("a success no longer erases the history, but failures before it stop counting towards the lock", async () => {
    for (let i = 0; i < MAX_FAILURES_PER_IDENTIFIER - 1; i++) expect(await code(authenticate(email, "wrong-password-" + i, meta(ip)))).toBe("UNAUTHENTICATED");
    await authenticate(email, PASSWORD, meta(ip)); // succeeds; 4 earlier failures are behind us now
    for (let i = 0; i < MAX_FAILURES_PER_IDENTIFIER - 1; i++) expect(await code(authenticate(email, "again-wrong-" + i, meta(ip)))).toBe("UNAUTHENTICATED"); // still not locked
    expect(await db.loginAttempt.count({ where: { identifier: email, success: false } })).toBeGreaterThanOrEqual(8); // history kept
    expect(await code(authenticate(email, "one-more-wrong", meta(ip)))).toBe("UNAUTHENTICATED"); // 5th since the success
    expect(await code(authenticate(email, PASSWORD, meta(ip)))).toBe("RATE_LIMITED"); // now locked, even with the right password
  });

  it("the security panel shows failures per address and account, without any password", async () => {
    const s = await securityPanel(admin, { addressLimit: 500 }); // the shared test database has many other addresses
    expect(s.failed24).toBeGreaterThanOrEqual(9);
    const row = s.byAddress.find((a) => a.ip === ip)!;
    expect(row.tries).toBeGreaterThanOrEqual(9);
    expect(row.accounts).toBe(1);
    expect(s.latest.some((l) => l.identifier === email && l.repeats >= 2)).toBe(true); // repeats within a minute are merged
    expect(JSON.stringify(s)).not.toMatch(/wrong-password|again-wrong|one-more-wrong|Passw0rd/);
    expect(s.perDay.reduce((n, d) => n + (d.parts.failed ?? 0), 0)).toBe(s.failed14);
  });

  it("the activity panel lists the sign-in with its device and who is online", async () => {
    const a = await activityPanel(admin);
    const mine = a.recentSignIns.find((r) => r.userId === teacher.userId)!;
    expect(mine).toMatchObject({ role: "Class Teacher", ip });
    expect(mine.device.label).toBe("Chrome · Android");
    expect(a.signedInToday).toBeGreaterThanOrEqual(1);
    expect(a.signInsByRole.series).toContain("Class Teacher");
    expect(a.actionsByKind.length).toBe(14);
    expect(a.hours).toHaveLength(24);
  });

  it("only people with audit.read see activity and security; only backup.read sees the system", async () => {
    expect(await code(activityPanel(registrar))).toBe("FORBIDDEN");
    expect(await code(securityPanel(registrar))).toBe("FORBIDDEN");
    expect(await code(systemPanel(registrar))).toBe("FORBIDDEN");
    expect(await code(systemPanel(teacher))).toBe("FORBIDDEN");
  });
});

describe("system panel", () => {
  it("counts recorded errors (scrubbed) and scheduled-job runs, and times real queries", async () => {
    await recordServerError("action", new Error("Cannot save for amina@example.com with phone 0712345678"), "test");
    await recordServerError("api", new Error("Another failure"), "test-route");
    await recordJobRun("notifications", new Date(Date.now() - 1000), true, { sent: 3 });
    const s = await systemPanel(admin);
    expect(s.errors24).toBeGreaterThanOrEqual(2);
    expect(s.lastError).not.toBeNull();
    expect(JSON.stringify(s)).not.toMatch(/amina@example|0712345678/);
    const job = s.jobs.find((j) => j.name === "notifications")!;
    expect(job).toMatchObject({ ok: true, onTime: true });
    expect(s.jobsGood).toBe(1);
    expect(s.speed).toHaveLength(4);
    expect(s.speed.every((q) => q.ms >= 1)).toBe(true);
    expect(s.dbBytes).toBeGreaterThan(0);
    expect(s.tables.length).toBeGreaterThan(0);
  });

  it("a failed job run is reported as not good", async () => {
    await recordJobRun("notifications", new Date(), false, { error: "Error" });
    const s = await systemPanel(admin);
    expect(s.jobs[0]!.ok).toBe(false);
    expect(s.jobsGood).toBe(0);
    await recordJobRun("notifications", new Date(), true); // leave the shared test database healthy
  });
});
