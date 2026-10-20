import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import { backupHealth, backupStatus } from "@/server/backups";
import { createTestSchool, createTestUser } from "../helpers";

let admin: AuthContext, head: AuthContext, registrar: AuthContext;
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;

beforeAll(async () => {
  const school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  head = (await createTestUser(school.id, ["head_teacher"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
});

describe("backup records", () => {
  it("only Super Admin sees them by default", async () => {
    expect(admin.permissions.has("backup.read")).toBe(true);
    expect(await code(backupStatus(head))).toBe("FORBIDDEN");
    expect(await code(backupStatus(registrar))).toBe("FORBIDDEN");
    await backupStatus(admin);
  });

  it("the database refuses to change or remove a record, and a success needs a checksum and a size", async () => {
    const at = new Date();
    await expect(db.$executeRaw`INSERT INTO backup_runs (id, kind, status, "startedAt") VALUES (gen_random_uuid(), 'BACKUP', 'SUCCESS', ${at})`).rejects.toThrow(); // no sha256/size
    await db.$executeRaw`INSERT INTO backup_runs (id, kind, status, "startedAt", "fileName", "sizeBytes", sha256, location) VALUES (gen_random_uuid(), 'BACKUP', 'SUCCESS', ${at}, 'test.dump', 1234, 'abc123', 'test')`;
    await expect(db.$executeRaw`UPDATE backup_runs SET note = 'edited'`).rejects.toThrow();
    await expect(db.$executeRaw`DELETE FROM backup_runs`).rejects.toThrow();
  });

  it("reports the newest success as current and lists what was recorded", async () => {
    const h = await backupHealth();
    expect(h.level).toBe("ok");
    const s = await backupStatus(admin);
    expect(s.runs.some((r) => r.fileName === "test.dump" && r.ok)).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/postgres(ql)?:\/\//); // no connection string can leak through this view
  });
});
