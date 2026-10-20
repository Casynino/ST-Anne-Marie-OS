/** Pure helpers for the backup scripts and the backup status page. No I/O here, so they are unit-tested. */

export const BACKUP_FRESH_HOURS = 26; // one nightly run plus slack
export const BACKUP_STALE_HOURS = 72; // three missed nights

export type BackupLevel = "ok" | "warn" | "bad" | "none";

/** How old the newest successful backup is, as a traffic light. `none` means no backup has ever been recorded. */
export function backupLevel(lastSuccessAt: Date | null, now: Date = new Date()): { level: BackupLevel; ageHours: number | null } {
  if (!lastSuccessAt) return { level: "none", ageHours: null };
  const ageHours = Math.max(0, (now.getTime() - lastSuccessAt.getTime()) / 3_600_000);
  return { level: ageHours <= BACKUP_FRESH_HOURS ? "ok" : ageHours <= BACKUP_STALE_HOURS ? "warn" : "bad", ageHours };
}

/** stanne-20261021-230501Z.dump (UTC, sortable). */
export function backupFileName(at: Date, prefix = "stanne"): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${prefix}-${at.getUTCFullYear()}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}-${p(at.getUTCHours())}${p(at.getUTCMinutes())}${p(at.getUTCSeconds())}Z.dump`;
}

/**
 * libpq environment for a postgres:// URL, so the password never appears on a command line (visible to other users of the machine).
 * sslmode and channel_binding from the query string are passed through.
 */
export function pgEnvFromUrl(url: string): Record<string, string> {
  const u = new URL(url);
  const env: Record<string, string> = { PGHOST: u.hostname, PGPORT: u.port || "5432", PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, "")) };
  if (u.username) env.PGUSER = decodeURIComponent(u.username);
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  const ssl = u.searchParams.get("sslmode");
  if (ssl) env.PGSSLMODE = ssl;
  const cb = u.searchParams.get("channel_binding");
  if (cb) env.PGCHANNELBINDING = cb;
  return env;
}

/** A restore test may only ever write into a database whose name says it is a throw-away restore target. */
export function isRestoreTarget(url: string): boolean {
  try { return /_restore$/.test(decodeURIComponent(new URL(url).pathname.replace(/^\//, ""))); } catch { return false; }
}

export type TableCounts = Record<string, number>;

/** Differences between the counts recorded at backup time and the counts found in the restored copy. Empty = identical. */
export function compareCounts(expected: TableCounts, actual: TableCounts): string[] {
  const out: string[] = [];
  for (const [t, n] of Object.entries(expected)) {
    if (!(t in actual)) out.push(`${t}: missing in the restored copy (expected ${n} rows)`);
    else if (actual[t] !== n) out.push(`${t}: expected ${n} rows, restored ${actual[t]}`);
  }
  for (const t of Object.keys(actual)) if (!(t in expected)) out.push(`${t}: not in the backup record`);
  return out;
}

/** The tables worth showing on the status page (the rest are in the record). */
export const KEY_TABLES = ["schools", "users", "students", "student_enrollments", "invoices", "payments", "receipts", "report_cards", "audit_logs"] as const;
