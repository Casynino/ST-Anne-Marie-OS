import { db } from "@/lib/db";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { backupLevel, KEY_TABLES, type BackupLevel, type TableCounts } from "@/lib/backup";

/*
 * Read-only view of backup_runs. The rows are written by scripts/backup.ts after a copy really exists and its checksum is known;
 * nothing in the app can add, change or remove them, so this page can only report what the scripts recorded.
 */

/** Traffic light for the newest successful backup (also used by the dashboard). No permission check: callers decide who sees it. */
export async function backupHealth(): Promise<{ level: BackupLevel; ageHours: number | null; lastSuccessAt: Date | null }> {
  const last = await db.backupRun.findFirst({ where: { kind: "BACKUP", status: "SUCCESS" }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } });
  return { ...backupLevel(last?.finishedAt ?? null), lastSuccessAt: last?.finishedAt ?? null };
}

export async function backupStatus(ctx: AuthContext) {
  requirePermission(ctx, "backup.read");
  const [health, runs, lastRestore] = await Promise.all([
    backupHealth(),
    db.backupRun.findMany({ orderBy: { finishedAt: "desc" }, take: 30 }),
    db.backupRun.findFirst({ where: { kind: "RESTORE_TEST" }, orderBy: { finishedAt: "desc" } }),
  ]);
  const latestBackup = runs.find((r) => r.kind === "BACKUP" && r.status === "SUCCESS");
  const counts = (latestBackup?.rowCounts as { tables?: TableCounts } | null)?.tables ?? null;
  return {
    ...health,
    lastRestore: lastRestore ? { ok: lastRestore.status === "SUCCESS", at: lastRestore.finishedAt, note: lastRestore.note } : null,
    keyCounts: counts ? KEY_TABLES.filter((t) => t in counts).map((t) => ({ table: t, rows: counts[t]! })) : [],
    totalRows: counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null,
    tableCount: counts ? Object.keys(counts).length : null,
    runs: runs.map((r) => ({ id: r.id, kind: r.kind, ok: r.status === "SUCCESS", at: r.finishedAt, fileName: r.fileName, sizeBytes: r.sizeBytes === null ? null : Number(r.sizeBytes), sha256: r.sha256, location: r.location, note: r.note })),
  };
}
