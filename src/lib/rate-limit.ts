import { db } from "@/lib/db";

/**
 * Sliding-window limiter backed by the database (no Redis). Returns false when `key` already has
 * `max` events inside `windowMs`; otherwise records one and returns true. A burst of parallel
 * requests may overshoot slightly, which is acceptable for abuse protection on public forms.
 */
export async function consumeRateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  const since = new Date(Date.now() - windowMs);
  const used = await db.rateLimitEvent.count({ where: { key, createdAt: { gte: since } } });
  if (used >= max) return false;
  await db.rateLimitEvent.create({ data: { key } });
  // Opportunistic cleanup keeps the table small without a scheduler.
  if (Math.random() < 0.02) await db.rateLimitEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } } });
  return true;
}
