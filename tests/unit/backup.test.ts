import { describe, expect, it } from "vitest";
import { BACKUP_FRESH_HOURS, backupFileName, backupLevel, compareCounts, isRestoreTarget, pgEnvFromUrl } from "@/lib/backup";

describe("backup helpers", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  it("grades the age of the newest backup", () => {
    expect(backupLevel(null, now)).toEqual({ level: "none", ageHours: null });
    expect(backupLevel(new Date(now.getTime() - 3 * 3_600_000), now).level).toBe("ok");
    expect(backupLevel(new Date(now.getTime() - (BACKUP_FRESH_HOURS + 1) * 3_600_000), now).level).toBe("warn");
    expect(backupLevel(new Date(now.getTime() - 73 * 3_600_000), now).level).toBe("bad");
    expect(backupLevel(new Date(now.getTime() + 3_600_000), now).ageHours).toBe(0); // a clock skew never gives a negative age
  });

  it("names files by UTC time so they sort", () => {
    expect(backupFileName(new Date("2026-01-02T03:04:05Z"))).toBe("stanne-20260102-030405Z.dump");
    const a = backupFileName(new Date("2026-10-21T09:00:00Z")), b = backupFileName(new Date("2026-10-21T10:00:00Z"));
    expect([b, a].sort()).toEqual([a, b]);
  });

  it("keeps the password out of the command line and passes ssl options through", () => {
    const env = pgEnvFromUrl("postgresql://neon_user:p%40ss%2Fw0rd@ep-x.eu-central-1.aws.neon.tech:5433/neondb?sslmode=require&channel_binding=require");
    expect(env).toMatchObject({ PGHOST: "ep-x.eu-central-1.aws.neon.tech", PGPORT: "5433", PGDATABASE: "neondb", PGUSER: "neon_user", PGPASSWORD: "p@ss/w0rd", PGSSLMODE: "require", PGCHANNELBINDING: "require" });
    expect(pgEnvFromUrl("postgresql://me@localhost/stanne_dev")).toMatchObject({ PGHOST: "localhost", PGPORT: "5432", PGDATABASE: "stanne_dev" });
  });

  it("only throw-away databases named *_restore are restore targets", () => {
    expect(isRestoreTarget("postgresql://me@localhost/stanne_restore")).toBe(true);
    for (const u of ["postgresql://me@localhost/stanne_dev", "postgresql://me@localhost/neondb", "postgresql://me@localhost/restore_stanne", "not a url", "postgresql://me@localhost/x_restore_backup"]) expect(isRestoreTarget(u)).toBe(false);
  });

  it("compares restored counts table by table", () => {
    expect(compareCounts({ a: 1, b: 2 }, { a: 1, b: 2 })).toEqual([]);
    expect(compareCounts({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual(["b: expected 2 rows, restored 3"]);
    expect(compareCounts({ a: 1 }, {})).toEqual(["a: missing in the restored copy (expected 1 rows)"]);
    expect(compareCounts({ a: 1 }, { a: 1, extra: 0 })).toEqual(["extra: not in the backup record"]);
  });
});
