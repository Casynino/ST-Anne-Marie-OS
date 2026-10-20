import { Prisma, type DeliveryStatus, type NotificationCategory } from "@/generated/prisma/client";
import { db, type Tx } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { makeT, type Locale } from "@/lib/i18n";
import { getSmsAdapter } from "@/lib/sms/adapter";
import { renderText, resolveTemplate } from "@/server/communication";

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
 * Times are compared in UTC explicitly: Prisma stores timestamps as UTC without a zone, so a database session in another
 * time zone (the local one is Africa/Dar_es_Salaam) must not shift scheduled sends or retry delays.
 * Claims up to `limit` due events (lease via nextAttemptAt + SKIP LOCKED, so parallel workers never take
 * the same event) and runs each through the channels. Returns counts for observability.
 */
export async function processPendingEvents(opts: { schoolId?: string; limit?: number } = {}): Promise<{ claimed: number; processed: number; failed: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const claimed = await db.$queryRaw<{ id: string }[]>`
    UPDATE notification_events SET attempts = attempts + 1, "nextAttemptAt" = (now() AT TIME ZONE 'UTC') + make_interval(mins => ${LEASE_MINUTES}::int)
    WHERE id IN (
      SELECT id FROM notification_events
      WHERE status = 'PENDING' AND "nextAttemptAt" <= (now() AT TIME ZONE 'UTC') ${opts.schoolId ? Prisma.sql`AND "schoolId" = ${opts.schoolId}::uuid` : Prisma.empty}
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

type Rendered = { title: string; inApp: string; sms: string; category: NotificationCategory; link: string | null; sendSms: boolean; sendInApp: boolean };

/** What to tell this guardian, in their language, from the event's stored payload and the school's wording. */
async function renderEvent(ev: { type: string; schoolId: string; studentId: string; payload: unknown }, locale: Locale): Promise<Rendered> {
  const t = makeT(locale);
  const p = ev.payload as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  const vars = { ...((p.vars as Record<string, string> | undefined) ?? {}), student: str("studentName"), school: str("school") } as Record<string, string | number>;
  const flags = { sendSms: p.sendSms !== false, sendInApp: p.sendInApp !== false };
  if (ev.type === "ABSENCE") {
    const v = { student: str("studentName"), date: str("date"), class: str("streamName") ? `${str("className")} ${str("streamName")}` : str("className"), session: str("sessionName") };
    const custom = await db.messageTemplate.findUnique({ where: { schoolId_key_locale: { schoolId: ev.schoolId, key: "absence", locale } } });
    return { title: t("notify.absence.title", v), inApp: custom ? renderText(custom.body, v) : t("notify.absence.body", v), sms: custom ? renderText(custom.body, v) : t("notify.absence.sms", v), category: "ABSENCE", link: `/family/${ev.studentId}`, ...flags };
  }
  if (ev.type === "RESULTS_READY") {
    const v = { student: str("studentName"), term: str("term"), school: str("school") };
    const body = renderText(await resolveTemplate(db, ev.schoolId, "results", locale), v);
    return { title: t("notify.results.title", v), inApp: body, sms: body, category: "RESULTS", link: `/family/${ev.studentId}`, ...flags };
  }
  const body = renderText(locale === "SW" && str("bodySw") ? str("bodySw") : str("bodyEn"), vars);
  const fees = ev.type === "FEE_REMINDER";
  return { title: str("title") || t("notify.announcement.title"), inApp: body, sms: body, category: fees ? "FEES" : "ANNOUNCEMENTS", link: fees ? `/family/${ev.studentId}/fees` : null, ...flags };
}

async function processOne(eventId: string) {
  const ev = await db.notificationEvent.findUnique({ where: { id: eventId }, include: { deliveries: true } });
  if (!ev || ev.status !== "PENDING") return;
  const guardian = await db.guardian.findFirst({ where: { id: ev.guardianId, schoolId: ev.schoolId }, include: { user: { select: { id: true, locale: true, status: true } } } });
  const school = await db.school.findUniqueOrThrow({ where: { id: ev.schoolId }, select: { defaultLocale: true } });
  const portalUser = guardian?.user && guardian.user.status === "ACTIVE" ? guardian.user : null;
  const locale: Locale = portalUser?.locale ?? school.defaultLocale;
  const msg = await renderEvent(ev, locale);
  const pref = portalUser ? await db.notificationPreference.findUnique({ where: { userId_category: { userId: portalUser.id, category: msg.category } } }) : null;
  const upsertDelivery = (channel: "IN_APP" | "SMS", status: DeliveryStatus, detail?: string, providerRef?: string) =>
    db.notificationDelivery.upsert({
      where: { eventId_channel: { eventId, channel } },
      create: { schoolId: ev.schoolId, eventId, channel, status, detail, providerRef, attempts: 1 },
      update: { status, detail, providerRef, attempts: { increment: 1 } },
    });

  // In-app: stored for guardians with a portal account.
  if (!ev.deliveries.some((d) => d.channel === "IN_APP")) {
    if (!msg.sendInApp) await upsertDelivery("IN_APP", "SKIPPED", "In-app was not selected for this message");
    else if (!portalUser) await upsertDelivery("IN_APP", "SKIPPED", "Guardian has no portal account");
    else if (pref && !pref.inAppEnabled) await upsertDelivery("IN_APP", "SKIPPED", "Guardian opted out of in-app messages of this kind");
    else {
      await db.inAppNotification.createMany({ data: [{ schoolId: ev.schoolId, eventId, userId: portalUser.id, title: msg.title, body: msg.inApp, link: msg.link }], skipDuplicates: true });
      await upsertDelivery("IN_APP", "STORED");
    }
  }

  // SMS: only through the adapter. No provider configured → skipped, never "sent".
  const sms = ev.deliveries.find((d) => d.channel === "SMS");
  if (!sms || sms.status === "QUEUED" || sms.status === "FAILED") {
    const adapter = getSmsAdapter();
    if (!msg.sendSms) {
      await upsertDelivery("SMS", "SKIPPED", "SMS was not selected for this message");
    } else if (!guardian) {
      await upsertDelivery("SMS", "SKIPPED", "Guardian record no longer exists");
    } else if (pref && !pref.smsEnabled) {
      await upsertDelivery("SMS", "SKIPPED", "Guardian opted out of SMS of this kind");
    } else if (!adapter.isConfigured()) {
      await upsertDelivery("SMS", "SKIPPED", "SMS provider not configured");
    } else {
      const res = await adapter.send({ to: guardian.phone, body: msg.sms, reference: eventId });
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

/** Results-ready notices: one per guardian who receives notifications. Safe to call again (deduped per card version). */
export async function createResultsReadyEvents(tx: Tx, schoolId: string, cards: { id: string; version: number; studentId: string; studentName: string; termName: string }[]): Promise<number> {
  if (!cards.length) return 0;
  const school = await tx.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true } });
  const links = await tx.studentGuardian.findMany({ where: { schoolId, studentId: { in: cards.map((c) => c.studentId) }, receivesNotifications: true }, select: { studentId: true, guardianId: true } });
  const rows = links.flatMap((l) => {
    const c = cards.find((x) => x.studentId === l.studentId);
    return c ? [{ schoolId, type: "RESULTS_READY" as const, dedupeKey: `results:${c.id}:v${c.version}:${l.guardianId}`, studentId: l.studentId, guardianId: l.guardianId, payload: { studentName: c.studentName, term: c.termName, school: school.name } as unknown as Prisma.InputJsonValue }] : [];
  });
  if (!rows.length) return 0;
  return (await tx.notificationEvent.createMany({ data: rows, skipDuplicates: true })).count;
}

/** A submission that no provider report confirmed within a day is "unknown": not delivered, not failed. */
export async function markStaleSubmissionsUnknown(hours = 24): Promise<number> {
  const res = await db.notificationDelivery.updateMany({ where: { channel: "SMS", status: "SUBMITTED", updatedAt: { lt: new Date(Date.now() - hours * 3_600_000) } }, data: { status: "UNKNOWN", detail: "No delivery report received from the provider" } });
  return res.count;
}

// ───────────────────────── Reads ─────────────────────────

export async function listNotificationEvents(ctx: AuthContext, opts: { status?: string; page?: number } = {}) {
  requirePermission(ctx, "notification.read");
  const pageSize = 25;
  const page = Math.max(1, opts.page ?? 1);
  const statuses = ["PENDING", "PROCESSED", "CANCELLED", "FAILED"] as const;
  const where: Prisma.NotificationEventWhereInput = {
    schoolId: ctx.schoolId,
    type: "ABSENCE", // this list backs the attendance-alerts screen; notices and reminders are under Communication
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

export async function markAllNotificationsRead(ctx: AuthContext) {
  await db.inAppNotification.updateMany({ where: { schoolId: ctx.schoolId, userId: ctx.userId, readAt: null }, data: { readAt: new Date() } });
}
