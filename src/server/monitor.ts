import { db } from "@/lib/db";

/*
 * Best-effort monitoring writes for the system dashboard. Nothing here may ever break or slow a request: every function swallows its
 * own failures. Messages are cut short and scrubbed (no e-mail addresses, no long digit runs such as phone or card numbers, no
 * newlines), and rows are trimmed after 30 days.
 */

export function scrub(message: string): string {
  return message
    .replace(/\s+/g, " ")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\d{6,}/g, "[number]")
    .trim()
    .slice(0, 200);
}

export async function recordServerError(source: "action" | "api" | "job", e: unknown, where?: string, userId?: string): Promise<void> {
  try {
    const name = e instanceof Error ? e.name.slice(0, 80) : "Error";
    await db.errorEvent.create({ data: { source, name, message: scrub(e instanceof Error ? e.message : String(e)), where: where?.slice(0, 120) ?? null, userId: userId ?? null } });
    if (Math.random() < 0.02) await db.errorEvent.deleteMany({ where: { occurredAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } });
  } catch { /* monitoring must never fail a request */ }
}

export async function recordJobRun(name: string, startedAt: Date, ok: boolean, summary?: Record<string, unknown>): Promise<void> {
  try {
    await db.jobRun.create({ data: { name, startedAt, ok, summary: (summary ?? undefined) as never } });
    if (Math.random() < 0.05) await db.jobRun.deleteMany({ where: { finishedAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } });
  } catch { /* ignore */ }
}
