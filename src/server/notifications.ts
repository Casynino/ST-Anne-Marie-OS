import { Prisma, type DeliveryStatus } from "@/generated/prisma/client";
import { db, type Tx } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { makeT } from "@/lib/i18n";
import { getSmsAdapter } from "@/lib/sms/adapter";

/*
 * Notification events: a durable outbox. An event is created inside the same transaction that
 * finalises attendance, then processed asynchronously (right after the request, and by the
 * /api/jobs/notifications endpoint) with a lease so concurrent workers never double-process.
 *
 * Channels today: IN_APP (stored for guardians that have a portal account) and SMS (adapter boundary;
 * no provider chosen, so it is recorded as SKIPPED). Nothing here ever claims "delivered".
 */

const MAX_ATTEMPTS = 5;
const LEASE_MINUTES = 5;
const CONCURRENCY = 8;

export type AbsenceEventContext = { className: string; streamName: string | null; sessionName: string; date: string };
type AbsencePayload = AbsenceEventContext & { studentName: string; admissionNo: string; guardianName: string };

const eventKey = (attendanceId: string, guardianId: string) => `absence:${attendanceId}:${guardianId}`;

/**
 * One event per linked guardian who receives notifications, per absent record. Safe to call repeatedly
 * (edits, corrections, sync retries): existing events are never duplicated; an event cancelled by an
 * earlier correction is revived if the student is marked absent again. Returns how many became pending.
 */
export async function createAbsenceEvents(tx: Tx, schoolId: string, records: { attendanceId: string; studentId: string }[], info: AbsenceEventContext): Promise<number> {
  if (!records.length) return 0;
  const studentIds = [...new Set(records.map((r) => r.studentId))];
  const [links, students] = await Promise.all([
    tx.studentGuardian.findMany({ where: { schoolId, studentId: { in: studentIds }, receivesNotifications: true }, include: { guardian: { select: { id: true, fullName: true } } } }),
    tx.student.findMany({ where: { schoolId, id: { in: studentIds } }, select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true } }),
  ]);
  const rows = records.flatMap((r) => {
    const s = students.find((x) => x.id === r.studentId);
    if (!s) return [];
    const studentName = [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");
    return links
      .filter((l) => l.studentId === r.studentId)
      .map((l) => ({
        schoolId,
        type: "ABSENCE" as const,
        dedupeKey: eventKey(r.attendanceId, l.guardianId),
        studentId: r.studentId,
        guardianId: l.guardianId,
        attendanceId: r.attendanceId,
        payload: { ...info, studentName, admissionNo: s.admissionNo, guardianName: l.guardian.fullName } satisfies AbsencePayload as unknown as Prisma.InputJsonValue,
      }));
  });
  if (!rows.length) return 0;
  const created = await tx.notificationEvent.createMany({ data: rows, skipDuplicates: true });
  const revived = await tx.notificationEvent.updateMany({
    where: { schoolId, dedupeKey: { in: rows.map((r) => r.dedupeKey) }, status: "CANCELLED" },
    data: { status: "PENDING", attempts: 0, lastError: null, nextAttemptAt: new Date() },
  });
  return created.count + revived.count;
}

/** A record stopped being ABSENT: events not yet processed are cancelled (already-processed ones stay as history). */
export async function cancelAbsenceEvents(tx: Tx, schoolId: string, attendanceIds: string[]): Promise<number> {
  if (!attendanceIds.length) return 0;
  const res = await tx.notificationEvent.updateMany({ where: { schoolId, attendanceId: { in: attendanceIds }, status: "PENDING" }, data: { status: "CANCELLED" } });
  return res.count;
}

// ───────────────────────── Processing ─────────────────────────

const backoffMs = (attempts: number) => Math.min(60, 2 ** attempts) * 60_000;

/**
 * Claims up to `limit` due events (lease via nextAttemptAt + SKIP LOCKED, so parallel workers never take
 * the same event) and runs each through the channels. Returns counts for observability.
 */
export async function processPendingEvents(opts: { schoolId?: string; limit?: number } = {}): Promise<{ claimed: number; processed: number; failed: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const claimed = await db.$queryRaw<{ id: string }[]>`
    UPDATE notification_events SET attempts = attempts + 1, "nextAttemptAt" = now() + make_interval(mins => ${LEASE_MINUTES}::int)
    WHERE id IN (
      SELECT id FROM notification_events
      WHERE status = 'PENDING' AND "nextAttemptAt" <= now() ${opts.schoolId ? Prisma.sql`AND "schoolId" = ${opts.schoolId}::uuid` : Prisma.empty}
      ORDER BY "createdAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  let processed = 0;
  let failed = 0;
  const run = async (id: string) => {
    try {
      await processOne(id);
      processed++;
    } catch (e) {
      failed++;
      const ev = await db.notificationEvent.findUnique({ where: { id }, select: { attempts: true } });
      const exhausted = (ev?.attempts ?? MAX_ATTEMPTS) >= MAX_ATTEMPTS;
      await db.notificationEvent.update({
        where: { id },
        data: { lastError: (e instanceof Error ? e.message : String(e)).slice(0, 300), ...(exhausted ? { status: "FAILED" } : { nextAttemptAt: new Date(Date.now() + backoffMs(ev?.attempts ?? 1)) }) },
      });
    }
  };
  // Bounded concurrency: a class with many absences must not make finalising slow.
  for (let i = 0; i < claimed.length; i += CONCURRENCY) await Promise.all(claimed.slice(i, i + CONCURRENCY).map(({ id }) => run(id)));
  return { claimed: claimed.length, processed, failed };
}

async function processOne(eventId: string) {
  const ev = await db.notificationEvent.findUnique({ where: { id: eventId }, include: { deliveries: true } });
  if (!ev || ev.status !== "PENDING") return;
  const payload = ev.payload as unknown as AbsencePayload;
  const guardian = await db.guardian.findFirst({ where: { id: ev.guardianId, schoolId: ev.schoolId }, include: { user: { select: { id: true, locale: true, status: true } } } });
  const school = await db.school.findUniqueOrThrow({ where: { id: ev.schoolId }, select: { defaultLocale: true } });
  const vars = {
    student: payload.studentName,
    date: payload.date,
    class: payload.streamName ? `${payload.className} ${payload.streamName}` : payload.className,
    session: payload.sessionName,
  };
  const upsertDelivery = (channel: "IN_APP" | "SMS", status: DeliveryStatus, detail?: string, providerRef?: string) =>
    db.notificationDelivery.upsert({
      where: { eventId_channel: { eventId, channel } },
      create: { schoolId: ev.schoolId, eventId, channel, status, detail, providerRef, attempts: 1 },
      update: { status, detail, providerRef, attempts: { increment: 1 } },
    });

  // In-app: stored for guardians with a portal account (the portal arrives in Phase 4).
  if (!ev.deliveries.some((d) => d.channel === "IN_APP")) {
    if (guardian?.user && guardian.user.status === "ACTIVE") {
      const t = makeT(guardian.user.locale);
      await db.inAppNotification.createMany({
        data: [{ schoolId: ev.schoolId, eventId, userId: guardian.user.id, title: t("notify.absence.title", vars), body: t("notify.absence.body", vars) }],
        skipDuplicates: true,
      });
      await upsertDelivery("IN_APP", "STORED");
    } else {
      await upsertDelivery("IN_APP", "SKIPPED", "Guardian has no portal account");
    }
  }

  // SMS: only through the adapter. No provider configured → skipped, never "sent".
  const sms = ev.deliveries.find((d) => d.channel === "SMS");
  if (!sms || sms.status === "QUEUED" || sms.status === "FAILED") {
    const adapter = getSmsAdapter();
    if (!guardian) {
      await upsertDelivery("SMS", "SKIPPED", "Guardian record no longer exists");
    } else if (!adapter.isConfigured()) {
      await upsertDelivery("SMS", "SKIPPED", "SMS provider not configured");
    } else {
      const body = makeT(school.defaultLocale)("notify.absence.sms", vars);
      const res = await adapter.send({ to: guardian.phone, body, reference: eventId });
      if (res.status === "SUBMITTED") {
        await upsertDelivery("SMS", "SUBMITTED", "Accepted by provider; not yet confirmed delivered", res.providerRef);
      } else {
        await upsertDelivery("SMS", "FAILED", res.error);
        if (res.retryable) throw new Error(`SMS submission failed: ${res.error}`);
      }
    }
  }
  await db.notificationEvent.update({ where: { id: eventId }, data: { status: "PROCESSED", processedAt: new Date(), lastError: null } });
}

// ───────────────────────── Reads ─────────────────────────

export async function listNotificationEvents(ctx: AuthContext, opts: { status?: string; page?: number } = {}) {
  requirePermission(ctx, "notification.read");
  const pageSize = 25;
  const page = Math.max(1, opts.page ?? 1);
  const statuses = ["PENDING", "PROCESSED", "CANCELLED", "FAILED"] as const;
  const where: Prisma.NotificationEventWhereInput = {
    schoolId: ctx.schoolId,
    ...(opts.status && (statuses as readonly string[]).includes(opts.status) ? { status: opts.status as (typeof statuses)[number] } : {}),
  };
  const [items, total, pending] = await Promise.all([
    db.notificationEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { deliveries: true } }),
    db.notificationEvent.count({ where }),
    db.notificationEvent.count({ where: { schoolId: ctx.schoolId, status: "PENDING" } }),
  ]);
  return {
    items: items.map((e) => ({ id: e.id, status: e.status, createdAt: e.createdAt, lastError: e.lastError, attempts: e.attempts, payload: e.payload as unknown as AbsencePayload, deliveries: e.deliveries.map((d) => ({ channel: d.channel, status: d.status, detail: d.detail })) })),
    total,
    page,
    pageSize,
    pending,
  };
}

export async function listMyNotifications(ctx: AuthContext) {
  return db.inAppNotification.findMany({ where: { schoolId: ctx.schoolId, userId: ctx.userId }, orderBy: { createdAt: "desc" }, take: 50 });
}

export async function countMyUnread(ctx: AuthContext): Promise<number> {
  return db.inAppNotification.count({ where: { schoolId: ctx.schoolId, userId: ctx.userId, readAt: null } });
}

export async function markNotificationRead(ctx: AuthContext, id: string) {
  const res = await db.inAppNotification.updateMany({ where: { id, schoolId: ctx.schoolId, userId: ctx.userId, readAt: null }, data: { readAt: new Date() } });
  if (!res.count && !(await db.inAppNotification.findFirst({ where: { id, schoolId: ctx.schoolId, userId: ctx.userId } }))) throw notFound("Notification");
}
