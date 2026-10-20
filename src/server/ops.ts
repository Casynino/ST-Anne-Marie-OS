import { db } from "@/lib/db";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { parseDateOnly, todayInTimezone, formatDateOnly } from "@/lib/dates";
import { backupHealth } from "@/server/backups";
import { schoolTimezone } from "@/server/learning-access";

/*
 * Read-only monitoring for the dashboard: who signs in and what the team does (from the audit trail and sessions), failed sign-ins
 * (from login_attempts), and the health of the system (errors, scheduled jobs, backups, speed, size). Activity and security need
 * audit.read; the system panel needs backup.read (Super Admin by default). Nothing here changes data.
 */

export type DayPoint = { date: string; parts: Record<string, number> };
const DAYS = 14;
const ms = (n: number) => n * 86_400_000;

const localDate = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** The last `n` calendar dates in the school's time zone, oldest first. */
export function lastDates(tz: string, n = DAYS, now = new Date()): string[] {
  const today = parseDateOnly(todayInTimezone(tz, now)) as Date;
  return Array.from({ length: n }, (_, i) => formatDateOnly(new Date(today.getTime() - ms(n - 1 - i))));
}

/** "Chrome · Mac", "Safari · iPhone/iPad", "Opera · Android". Unknown agents read as "Unknown device". */
export function describeDevice(ua: string | null | undefined): { label: string; mobile: boolean } {
  if (!ua) return { label: "Unknown device", mobile: false };
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iPhone/iPad" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "device";
  return { label: `${browser} · ${os}`, mobile: os === "Android" || os === "iPhone/iPad" };
}

/** Phone numbers keep only their first four and last two digits; e-mail addresses are shown as typed (the viewer is an administrator). */
export function maskIdentifier(id: string): string {
  const digits = id.replace(/\D/g, "");
  return !id.includes("@") && digits.length >= 8 ? `${id.slice(0, 4)}${"•".repeat(Math.max(2, id.length - 6))}${id.slice(-2)}` : id;
}

const humanize = (type: string) => type.replace(/([a-z])([A-Z])/g, "$1 $2");

const bucket = (days: string[], rows: { date: string; key: string }[]): DayPoint[] => {
  const map = new Map<string, Record<string, number>>(days.map((d) => [d, {}]));
  for (const r of rows) { const m = map.get(r.date); if (m) m[r.key] = (m[r.key] ?? 0) + 1; }
  return days.map((d) => ({ date: d, parts: map.get(d)! }));
};

// ───────────────────────── Activity ─────────────────────────

export async function activityPanel(ctx: AuthContext) {
  requirePermission(ctx, "audit.read");
  const tz = await schoolTimezone(ctx.schoolId);
  const days = lastDates(tz);
  const since = new Date(Date.now() - ms(DAYS));
  const sinceWeek = new Date(Date.now() - ms(7));
  const school = ctx.schoolId;

  const [logins, actionRows, hourRows, areaRows, activeRows, failed24, online, staffUsers, portalNever] = await Promise.all([
    db.auditLog.findMany({ where: { schoolId: school, action: "auth.login", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 5000, select: { actorId: true, createdAt: true, ip: true, userAgent: true } }),
    db.$queryRaw<{ d: string; k: string; n: bigint }[]>`
      SELECT to_char(((a."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS d,
             CASE WHEN a."actorId" IS NULL THEN 'visitor' WHEN u."type" = 'STAFF' THEN 'staff' ELSE 'family' END AS k, count(*) AS n
      FROM audit_logs a LEFT JOIN users u ON u.id = a."actorId"
      WHERE a."schoolId" = ${school}::uuid AND a."createdAt" >= ${since} AND a.action NOT LIKE 'auth.%' GROUP BY 1, 2`,
    db.$queryRaw<{ h: number; n: bigint }[]>`
      SELECT EXTRACT(HOUR FROM ((a."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}))::int AS h, count(*) AS n
      FROM audit_logs a WHERE a."schoolId" = ${school}::uuid AND a."createdAt" >= ${since} AND a.action NOT LIKE 'auth.%' GROUP BY 1`,
    db.$queryRaw<{ t: string; n: bigint }[]>`
      SELECT a."entityType" AS t, count(*) AS n FROM audit_logs a
      WHERE a."schoolId" = ${school}::uuid AND a."createdAt" >= ${sinceWeek} AND a.action NOT LIKE 'auth.%' GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
    db.$queryRaw<{ id: string; name: string | null; n: bigint }[]>`
      SELECT a."actorId"::text AS id, max(a."actorName") AS name, count(*) AS n FROM audit_logs a
      WHERE a."schoolId" = ${school}::uuid AND a."createdAt" >= ${sinceWeek} AND a."actorId" IS NOT NULL AND a.action NOT LIKE 'auth.%' GROUP BY 1 ORDER BY 3 DESC LIMIT 5`,
    db.auditLog.count({ where: { schoolId: school, action: "auth.login_failed", createdAt: { gte: new Date(Date.now() - ms(1)) } } }),
    db.session.findMany({ where: { user: { schoolId: school }, lastSeenAt: { gte: new Date(Date.now() - 10 * 60_000) }, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" }, select: { userId: true, lastSeenAt: true } }),
    db.user.findMany({ where: { schoolId: school, type: "STAFF", status: "ACTIVE", createdAt: { lt: new Date(Date.now() - 3 * 86_400_000) }, OR: [{ lastLoginAt: null }, { lastLoginAt: { lt: new Date(Date.now() - ms(30)) } }] }, orderBy: { lastLoginAt: { sort: "asc", nulls: "first" } }, take: 6, select: { id: true, fullName: true, lastLoginAt: true, roles: { select: { role: { select: { name: true } } } } } }),
    db.user.count({ where: { schoolId: school, type: { in: ["GUARDIAN", "STUDENT"] }, status: "ACTIVE", lastLoginAt: null } }),
  ]);

  // Who the sign-ins and online sessions belong to, and their (first) role.
  const userIds = [...new Set([...logins.map((l) => l.actorId), ...online.map((o) => o.userId)].filter((x): x is string => !!x))];
  const users = await db.user.findMany({ where: { id: { in: userIds }, schoolId: school }, select: { id: true, fullName: true, roles: { select: { role: { select: { name: true } } } } } });
  const info = new Map(users.map((u) => [u.id, { name: u.fullName, role: u.roles.map((r) => r.role.name).sort()[0] ?? "—" }]));

  const loginRows = logins.map((l) => ({ date: localDate(l.createdAt, tz), key: (l.actorId && info.get(l.actorId)?.role) || "—" }));
  const totals = new Map<string, number>();
  for (const r of loginRows) totals.set(r.key, (totals.get(r.key) ?? 0) + 1);
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
  const signInsByRole = bucket(days, loginRows.map((r) => ({ date: r.date, key: top.includes(r.key) ? r.key : "Other" })));
  const roleSeries = [...top, ...(loginRows.some((r) => !top.includes(r.key)) ? ["Other"] : [])];

  const actionDays = days.map((d) => ({ date: d, parts: { staff: 0, family: 0, visitor: 0 } as Record<string, number> }));
  for (const r of actionRows) { const p = actionDays.find((x) => x.date === r.d); if (p) p.parts[r.k] = Number(r.n); }
  const hours = Array.from({ length: 24 }, (_, h) => Number(hourRows.find((r) => r.h === h)?.n ?? 0));
  const peak = Math.max(...hours);

  const dayAgo = Date.now() - ms(1);
  return {
    tz, days,
    signedInToday: new Set(logins.filter((l) => l.createdAt.getTime() >= dayAgo && l.actorId).map((l) => l.actorId)).size,
    actions14: actionRows.reduce((n, r) => n + Number(r.n), 0),
    signIns14: logins.length,
    failed24,
    signInsByRole: { series: roleSeries, days: signInsByRole },
    actionsByKind: actionDays,
    hours, peakHour: peak > 0 ? hours.indexOf(peak) : null,
    areas: areaRows.map((r) => ({ label: humanize(r.t), value: Number(r.n) })),
    recentSignIns: logins.slice(0, 10).map((l) => ({ userId: l.actorId, name: (l.actorId && info.get(l.actorId)?.name) || "—", role: (l.actorId && info.get(l.actorId)?.role) || "—", device: describeDevice(l.userAgent), ip: l.ip, at: l.createdAt })),
    online: online.map((o) => ({ userId: o.userId, name: info.get(o.userId)?.name ?? "—", role: info.get(o.userId)?.role ?? "—", at: o.lastSeenAt })),
    mostActive: activeRows.map((r) => ({ name: r.name ?? "—", count: Number(r.n) })),
    inactive: staffUsers.map((u) => ({ name: u.fullName, role: u.roles.map((r) => r.role.name).sort()[0] ?? "—", lastLoginAt: u.lastLoginAt })),
    portalNeverSignedIn: portalNever,
  };
}

// ───────────────────────── Security ─────────────────────────

export async function securityPanel(ctx: AuthContext, opts: { addressLimit?: number } = {}) {
  requirePermission(ctx, "audit.read");
  const tz = await schoolTimezone(ctx.schoolId);
  const days = lastDates(tz);
  const since = new Date(Date.now() - ms(DAYS));
  const fails = await db.loginAttempt.findMany({ where: { success: false, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 3000 });
  const week = fails.filter((f) => f.createdAt.getTime() >= Date.now() - ms(7));

  // Repeats of the same account from the same address within a minute are shown once with a count.
  const latest: { identifier: string; ip: string | null; at: Date; repeats: number }[] = [];
  for (const f of fails) {
    const prev = latest[latest.length - 1];
    if (prev && prev.identifier === f.identifier && prev.ip === f.ip && prev.at.getTime() - f.createdAt.getTime() < 60_000) prev.repeats += 1;
    else latest.push({ identifier: f.identifier, ip: f.ip, at: f.createdAt, repeats: 1 });
  }
  const byIp = new Map<string, { tries: number; accounts: Set<string>; last: Date }>();
  for (const f of week) {
    const key = f.ip ?? "unknown";
    const e = byIp.get(key) ?? { tries: 0, accounts: new Set<string>(), last: f.createdAt };
    e.tries += 1; e.accounts.add(f.identifier); if (f.createdAt > e.last) e.last = f.createdAt;
    byIp.set(key, e);
  }
  const yours = await db.auditLog.count({ where: { schoolId: ctx.schoolId, action: "auth.login_failed", actorId: ctx.userId, createdAt: { gte: new Date(Date.now() - ms(1)) } } });
  return {
    days,
    failed24: fails.filter((f) => f.createdAt.getTime() >= Date.now() - ms(1)).length,
    failed14: fails.length,
    perDay: bucket(days, fails.map((f) => ({ date: localDate(f.createdAt, tz), key: "failed" }))),
    latest: latest.slice(0, 6).map((l) => ({ ...l, identifier: maskIdentifier(l.identifier) })),
    byAddress: [...byIp.entries()].sort((a, b) => b[1].tries - a[1].tries).slice(0, opts.addressLimit ?? 6).map(([ip, e]) => ({ ip, tries: e.tries, accounts: e.accounts.size, last: e.last })),
    yourFailed24: yours,
  };
}

// ───────────────────────── The system ─────────────────────────

/** Scheduled jobs the system expects, and how long a run may be overdue before it is called late. */
const EXPECTED_JOBS = [{ name: "notifications", label: "Notification worker", maxAgeHours: 26 }] as const;

async function timed<T>(label: string, fn: () => Promise<T>) {
  const t = performance.now();
  await fn();
  return { label, ms: Math.max(1, Math.round(performance.now() - t)) };
}

export async function systemPanel(ctx: AuthContext) {
  requirePermission(ctx, "backup.read");
  const day = new Date(Date.now() - ms(1));
  const [errors, lastError, runs, backup, speed, size, tables, docs, learn] = await Promise.all([
    db.errorEvent.findMany({ where: { occurredAt: { gte: day } }, select: { name: true, message: true } }),
    db.errorEvent.findFirst({ orderBy: { occurredAt: "desc" } }),
    Promise.all(EXPECTED_JOBS.map((j) => db.jobRun.findFirst({ where: { name: j.name }, orderBy: { finishedAt: "desc" } }))),
    backupHealth(),
    (async () => [
      await timed("studentSearch", () => db.student.findMany({ where: { schoolId: ctx.schoolId, OR: [{ firstName: { contains: "a", mode: "insensitive" } }, { lastName: { contains: "a", mode: "insensitive" } }] }, take: 25 })),
      await timed("auditLookup", () => db.auditLog.findMany({ where: { schoolId: ctx.schoolId }, orderBy: { createdAt: "desc" }, take: 25 })),
      await timed("invoiceList", () => db.invoice.findMany({ where: { schoolId: ctx.schoolId }, orderBy: { createdAt: "desc" }, take: 25 })),
      await timed("signInLookup", () => db.user.findFirst({ where: { schoolId: ctx.schoolId, email: "nobody@example.invalid" } })),
    ])(),
    db.$queryRaw<{ b: bigint }[]>`SELECT pg_database_size(current_database()) AS b`,
    db.$queryRaw<{ name: string; rows: bigint; bytes: bigint }[]>`SELECT relname AS name, n_live_tup AS rows, pg_total_relation_size(relid) AS bytes FROM pg_stat_user_tables ORDER BY 3 DESC LIMIT 6`,
    db.document.aggregate({ where: { schoolId: ctx.schoolId, deletedAt: null }, _sum: { sizeBytes: true }, _count: true }),
    db.learningFile.aggregate({ where: { schoolId: ctx.schoolId, deletedAt: null }, _sum: { sizeBytes: true }, _count: true }),
  ]);
  const jobs = EXPECTED_JOBS.map((j, i) => {
    const r = runs[i];
    const ageH = r ? (Date.now() - r.finishedAt.getTime()) / 3_600_000 : null;
    return { name: j.name, label: j.label, lastAt: r?.finishedAt ?? null, ok: !!r && r.ok, onTime: ageH !== null && ageH <= j.maxAgeHours };
  });
  const lastJob = runs.filter((r): r is NonNullable<typeof r> => !!r).sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime())[0] ?? null;
  return {
    errors24: new Set(errors.map((e) => `${e.name}|${e.message}`)).size,
    lastError: lastError ? { at: lastError.occurredAt, name: lastError.name, message: lastError.message, source: lastError.source } : null,
    jobs, jobsGood: jobs.filter((j) => j.ok && j.onTime).length, lastJobAt: lastJob?.finishedAt ?? null,
    backup,
    speed: speed.map((s) => ({ ...s, level: s.ms < 150 ? "ok" : s.ms < 600 ? "warn" : "bad" }) as { label: string; ms: number; level: "ok" | "warn" | "bad" }),
    dbBytes: Number(size[0]?.b ?? 0),
    tables: tables.map((t) => ({ name: t.name, rows: Number(t.rows), bytes: Number(t.bytes) })),
    files: { count: docs._count + learn._count, bytes: Number(docs._sum.sizeBytes ?? 0) + Number(learn._sum.sizeBytes ?? 0) },
  };
}
