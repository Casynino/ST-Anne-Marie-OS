/**
 * Database backup and restore test. Run from a machine that has the PostgreSQL client tools (pg_dump, pg_restore)
 * of the SAME OR A NEWER major version than the database server. Never run by the web app itself.
 *
 *   npm run db:backup                         one backup (custom-format dump + checksum), recorded in backup_runs
 *   npm run db:backup -- --verify [file]      restore a dump (default: newest) into RESTORE_TEST_DATABASE_URL and compare every table
 *
 * Environment: DATABASE_URL (source; for production use the DIRECT Neon connection, not the pooler), BACKUP_DIR (default ./backups),
 * BACKUP_KEEP (local copies to keep, default 14), BACKUP_UPLOAD=s3 (also copy to the S3_* bucket under backups/),
 * RESTORE_TEST_DATABASE_URL (a throw-away database whose name ends in _restore).
 * The password is passed to the tools through the environment, never on a command line, and is never printed or recorded.
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { backupFileName, compareCounts, isRestoreTarget, pgEnvFromUrl, type TableCounts } from "../src/lib/backup";
import { S3CompatibleStorage } from "../src/lib/storage/s3";

const fail = (m: string): never => { throw new Error(m); };
const sourceUrl = () => process.env.DATABASE_URL ?? fail("DATABASE_URL is not set.");
const dir = () => path.resolve(process.env.BACKUP_DIR ?? "backups");

function run(cmd: string, args: string[], env: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "inherit", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += String(d); });
    p.on("error", (e) => reject(new Error(`${cmd} could not start (${(e as NodeJS.ErrnoException).code ?? e.message}). Install the PostgreSQL client tools.`)));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} failed (exit ${code}): ${err.trim().slice(-600)}`))));
  });
}

async function sha256(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

/** Exact row count of every table, read inside the given transaction so it matches the dump taken from the same snapshot. */
async function countTables(c: Client): Promise<TableCounts> {
  const tables = (await c.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY 1")).rows;
  const out: TableCounts = {};
  for (const { table_name } of tables) out[table_name] = Number((await c.query(`SELECT count(*) AS n FROM "${table_name.replace(/"/g, '""')}"`)).rows[0]!.n);
  return out;
}

async function record(row: { kind: "BACKUP" | "RESTORE_TEST"; ok: boolean; startedAt: Date; fileName?: string; sizeBytes?: number; sha256?: string; location?: string; rowCounts?: unknown; note?: string }) {
  const c = new Client({ connectionString: sourceUrl() });
  await c.connect();
  try {
    await c.query(
      `INSERT INTO backup_runs (id, kind, status, "startedAt", "finishedAt", "fileName", "sizeBytes", sha256, location, "rowCounts", note)
       VALUES ($1, $2::"BackupKind", $3::"BackupStatus", $4, now(), $5, $6, $7, $8, $9, $10)`,
      [randomUUID(), row.kind, row.ok ? "SUCCESS" : "FAILED", row.startedAt, row.fileName ?? null, row.sizeBytes ?? null, row.sha256 ?? null, row.location ?? null, row.rowCounts ? JSON.stringify(row.rowCounts) : null, row.note?.slice(0, 1000) ?? null],
    );
  } finally { await c.end(); }
}

async function backup() {
  const startedAt = new Date();
  const fileName = backupFileName(startedAt);
  const file = path.join(dir(), fileName);
  await mkdir(dir(), { recursive: true });
  try {
    // One snapshot for both the dump and the counts, so a restore test can compare exactly even while the school is working.
    const c = new Client({ connectionString: sourceUrl() });
    await c.connect();
    let counts: TableCounts;
    try {
      await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const snapshot = (await c.query<{ s: string }>("SELECT pg_export_snapshot() AS s")).rows[0]!.s;
      await run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", `--snapshot=${snapshot}`, `--file=${file}`], pgEnvFromUrl(sourceUrl()));
      counts = await countTables(c);
      await c.query("COMMIT");
    } finally { await c.end(); }

    const info = await stat(file);
    if (info.size === 0) fail("The backup file is empty.");
    const digest = await sha256(file);
    let location = file;
    if (process.env.BACKUP_UPLOAD === "s3") {
      const { S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
      if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) fail("BACKUP_UPLOAD=s3 needs S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.");
      await new S3CompatibleStorage({ endpoint: S3_ENDPOINT!, bucket: S3_BUCKET!, region: S3_REGION ?? "auto", accessKeyId: S3_ACCESS_KEY_ID!, secretAccessKey: S3_SECRET_ACCESS_KEY! }).put(`backups/${fileName}`, await readFile(file), { contentType: "application/octet-stream" });
      location = `s3://${S3_BUCKET}/backups/${fileName}`;
    }
    await record({ kind: "BACKUP", ok: true, startedAt, fileName, sizeBytes: info.size, sha256: digest, location, rowCounts: { tables: counts, total: Object.values(counts).reduce((a, b) => a + b, 0) } });
    console.log(`Backup OK: ${fileName} (${(info.size / 1024).toFixed(0)} KB, sha256 ${digest.slice(0, 12)}…, ${Object.keys(counts).length} tables). Stored at ${location}.`);

    const keep = Math.max(3, Number(process.env.BACKUP_KEEP ?? 14));
    const old = (await readdir(dir())).filter((f) => /^stanne-\d{8}-\d{6}Z\.dump$/.test(f)).sort().reverse().slice(keep);
    for (const f of old) await rm(path.join(dir(), f));
    if (old.length) console.log(`Removed ${old.length} older local copy(ies); kept the newest ${keep}.`);
  } catch (e) {
    const note = e instanceof Error ? e.message : String(e);
    await rm(file, { force: true });
    await record({ kind: "BACKUP", ok: false, startedAt, note }).catch(() => undefined);
    throw e;
  }
}

async function verify(arg?: string) {
  const startedAt = new Date();
  const target = process.env.RESTORE_TEST_DATABASE_URL ?? fail("RESTORE_TEST_DATABASE_URL is not set.");
  if (!isRestoreTarget(target)) fail("RESTORE_TEST_DATABASE_URL must point to a throw-away database whose name ends in _restore. Nothing was done.");
  if (target === sourceUrl()) fail("The restore target is the live database. Nothing was done.");
  const file = arg ? path.resolve(arg) : path.join(dir(), (await readdir(dir())).filter((f) => /^stanne-\d{8}-\d{6}Z\.dump$/.test(f)).sort().reverse()[0] ?? fail("No backup file found."));
  const fileName = path.basename(file);
  try {
    const digest = await sha256(file);
    const src = new Client({ connectionString: sourceUrl() });
    await src.connect();
    let expected: { tables?: TableCounts } | null = null;
    try {
      const r = await src.query(`SELECT "rowCounts" FROM backup_runs WHERE kind = 'BACKUP' AND status = 'SUCCESS' AND sha256 = $1 ORDER BY "finishedAt" DESC LIMIT 1`, [digest]);
      if (!r.rows[0]) fail("This file does not match any recorded backup (its checksum is unknown). It may be damaged or not made by this system.");
      expected = r.rows[0].rowCounts as { tables?: TableCounts };
    } finally { await src.end(); }
    await run("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--exit-on-error", `--dbname=${new URL(target).pathname.slice(1)}`, file], pgEnvFromUrl(target));
    const dst = new Client({ connectionString: target });
    await dst.connect();
    let actual: TableCounts;
    try { await dst.query("BEGIN READ ONLY"); actual = await countTables(dst); await dst.query("COMMIT"); } finally { await dst.end(); }
    const diffs = compareCounts(expected?.tables ?? {}, actual);
    if (diffs.length) fail(`The restored copy differs from the backup record: ${diffs.slice(0, 5).join("; ")}${diffs.length > 5 ? ` (+${diffs.length - 5} more)` : ""}`);
    const info = await stat(file);
    await record({ kind: "RESTORE_TEST", ok: true, startedAt, fileName, sizeBytes: info.size, sha256: digest, rowCounts: { tables: actual, total: Object.values(actual).reduce((a, b) => a + b, 0) }, note: `Checksum matches the record; restored into a scratch database; all ${Object.keys(actual).length} tables have exactly the recorded number of rows.` });
    console.log(`Restore test OK: ${fileName} restored; checksum matches; ${Object.keys(actual).length} tables identical to the backup record.`);
  } catch (e) {
    await record({ kind: "RESTORE_TEST", ok: false, startedAt, fileName, note: e instanceof Error ? e.message : String(e) }).catch(() => undefined);
    throw e;
  }
}

const args = process.argv.slice(2);
(args[0] === "--verify" ? verify(args[1]) : backup()).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
