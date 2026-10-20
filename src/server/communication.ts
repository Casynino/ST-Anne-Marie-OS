import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Db, type Tx } from "@/lib/db";
import { invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { formatMoney } from "@/lib/finance/money";
import { makeT, type Locale } from "@/lib/i18n";
import { getSmsAdapter } from "@/lib/sms/adapter";
import { actorOf, writeAudit } from "@/server/audit";
import { loadFinance } from "@/server/balances";
import { optText, parse, text, uuid } from "@/lib/validation";

/*
 * Outbound communication. Every message to a parent is an outbox event (see notifications.ts) that is created in a
 * transaction and delivered later; what happened to it is read back from the events and their deliveries.
 * SMS is "submitted" only when a configured provider accepted it and "delivered" only on a verified delivery report.
 */

// ───────────────────────── Templates ─────────────────────────

export const TEMPLATES = {
  absence: { vars: ["student", "date", "class", "session"] },
  fees: { vars: ["student", "amount", "due", "school"] },
  results: { vars: ["student", "term", "school"] },
} as const;
export type TemplateKey = keyof typeof TEMPLATES;
const TEMPLATE_KEYS = Object.keys(TEMPLATES) as TemplateKey[];

export const defaultTemplate = (key: TemplateKey, locale: Locale): string => makeT(locale)(`notify.${key}.sms` as never);

export function renderText(body: string, vars: Record<string, string | number>): string {
  return body.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** The school's wording for a system message, or the built-in text. */
export async function resolveTemplate(client: Db | Tx, schoolId: string, key: TemplateKey, locale: Locale): Promise<string> {
  const row = await client.messageTemplate.findUnique({ where: { schoolId_key_locale: { schoolId, key, locale } } });
  return row?.body ?? defaultTemplate(key, locale);
}

export async function listTemplates(ctx: AuthContext) {
  requirePermission(ctx, "comms.manage");
  const rows = await db.messageTemplate.findMany({ where: { schoolId: ctx.schoolId } });
  return TEMPLATE_KEYS.flatMap((key) =>
    (["EN", "SW"] as const).map((locale) => {
      const row = rows.find((r) => r.key === key && r.locale === locale);
      return { key, locale, vars: TEMPLATES[key].vars as readonly string[], body: row?.body ?? defaultTemplate(key, locale), custom: !!row, defaultBody: defaultTemplate(key, locale) };
    }),
  );
}

const templateSchema = z.object({ key: z.enum(["absence", "fees", "results"]), locale: z.enum(["EN", "SW"]), body: z.string().trim().max(320, "Maximum 320 characters") });

function unknownVars(body: string, allowed: readonly string[]): string[] {
  return [...new Set([...body.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].filter((v) => !allowed.includes(v));
}

/** An empty text restores the built-in wording. Only the listed {variables} may be used. */
export async function saveTemplate(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "comms.manage");
  const d = parse(templateSchema, input);
  if (!d.body) {
    await db.$transaction(async (tx) => {
      await tx.messageTemplate.deleteMany({ where: { schoolId: ctx.schoolId, key: d.key, locale: d.locale } });
      await writeAudit(tx, actorOf(ctx), { action: "template.reset", entityType: "MessageTemplate", entityId: `${d.key}:${d.locale}`, summary: d.key });
    });
    return;
  }
  const bad = unknownVars(d.body, TEMPLATES[d.key].vars);
  if (bad.length) throw invalid("Please correct the highlighted fields.", { body: `Unknown variable ${bad.map((b) => `{${b}}`).join(", ")}. You can use: ${TEMPLATES[d.key].vars.map((v) => `{${v}}`).join(" ")}` });
  await db.$transaction(async (tx) => {
    await tx.messageTemplate.upsert({
      where: { schoolId_key_locale: { schoolId: ctx.schoolId, key: d.key, locale: d.locale } },
      create: { schoolId: ctx.schoolId, key: d.key, locale: d.locale, body: d.body, updatedById: ctx.userId },
      update: { body: d.body, updatedById: ctx.userId },
    });
    await writeAudit(tx, actorOf(ctx), { action: "template.update", entityType: "MessageTemplate", entityId: `${d.key}:${d.locale}`, summary: d.key });
  });
}

// ───────────────────────── Audience ─────────────────────────

const audienceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ALL") }),
  z.object({ type: z.literal("CLASS"), classIds: z.array(uuid()).min(1, "Choose at least one class"), streamId: z.string().uuid().optional() }),
  z.object({ type: z.literal("LEVEL"), levelId: uuid() }),
  z.object({ type: z.literal("ARREARS"), classId: z.string().uuid().optional(), overdueOnly: z.boolean().default(true), minOutstanding: z.number().int().min(1).default(1) }),
]);
export type Audience = z.infer<typeof audienceSchema>;

export type Recipient = { guardianId: string; studentId: string; studentName: string; guardianName: string; vars: Record<string, string> };

async function studentsInAudience(client: Db | Tx, schoolId: string, a: Audience) {
  const year = await client.academicYear.findFirst({ where: { schoolId, isCurrent: true }, select: { id: true } });
  if (!year) throw invalid("There is no current academic year, so there are no enrolled students to reach.");
  let classIds: string[] | undefined;
  if (a.type === "CLASS") classIds = a.classIds;
  if (a.type === "LEVEL") classIds = (await client.schoolClass.findMany({ where: { schoolId, levelId: a.levelId }, select: { id: true } })).map((c) => c.id);
  if (a.type === "ARREARS" && a.classId) classIds = [a.classId];
  if (classIds && (await client.schoolClass.count({ where: { schoolId, id: { in: classIds } } })) !== new Set(classIds).size) throw notFound("Class");
  if (a.type === "CLASS" && a.streamId && !(await client.stream.findFirst({ where: { id: a.streamId, schoolId, classId: { in: a.classIds } }, select: { id: true } }))) throw invalid("Please correct the highlighted fields.", { streamId: "That stream does not belong to the chosen classes" });
  const rows = await client.studentEnrollment.findMany({
    where: { schoolId, academicYearId: year.id, status: "ACTIVE", student: { status: "ENROLLED" }, ...(classIds ? { classId: { in: classIds } } : {}), ...(a.type === "CLASS" && a.streamId ? { streamId: a.streamId } : {}) },
    select: { student: { select: { id: true, firstName: true, middleName: true, lastName: true } } },
  });
  return [...new Map(rows.map((r) => [r.student.id, r.student])).values()];
}

/** Guardians who receive notifications for the students in the audience. Fee reminders go per child; notices per guardian. */
export async function resolveRecipients(client: Db | Tx, schoolId: string, kind: "ANNOUNCEMENT" | "FEE_REMINDER", a: Audience): Promise<Recipient[]> {
  if (kind === "FEE_REMINDER" && a.type !== "ARREARS") throw invalid("Please correct the highlighted fields.", { audience: "A fee reminder goes to the parents of students who owe fees" });
  if (kind === "ANNOUNCEMENT" && a.type === "ARREARS") throw invalid("Please correct the highlighted fields.", { audience: "Use a fee reminder to write to parents who owe fees" });
  let students = await studentsInAudience(client, schoolId, a);
  const vars = new Map<string, Record<string, string>>();
  if (a.type === "ARREARS") {
    const school = await client.school.findUniqueOrThrow({ where: { id: schoolId }, select: { currency: true } });
    const fin = await loadFinance(client, schoolId, students.map((s) => s.id));
    students = students.filter((s) => {
      const l = fin.get(s.id)!.ledger;
      const owed = a.overdueOnly ? l.overdue : l.outstanding;
      if (owed < a.minOutstanding) return false;
      const dues = [...l.invoices.values()].flatMap((b) => (a.overdueOnly ? b.overdue.map((o) => o.dueDate) : b.schedule.filter((x) => x.paid < x.amount).map((x) => x.dueDate))).sort();
      vars.set(s.id, { amount: formatMoney(owed, school.currency), due: dues[0] ?? "" });
      return true;
    });
  }
  const links = await client.studentGuardian.findMany({ where: { schoolId, studentId: { in: students.map((s) => s.id) }, receivesNotifications: true }, include: { guardian: { select: { id: true, fullName: true } } }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] });
  const name = (s: { firstName: string; middleName: string | null; lastName: string }) => [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");
  const sById = new Map(students.map((s) => [s.id, s]));
  const out: Recipient[] = [];
  const seen = new Set<string>();
  for (const l of links) {
    const key = kind === "FEE_REMINDER" ? `${l.guardianId}:${l.studentId}` : l.guardianId; // a notice reaches a parent once, however many children they have
    if (seen.has(key)) continue;
    seen.add(key);
    const s = sById.get(l.studentId)!;
    out.push({ guardianId: l.guardianId, studentId: l.studentId, studentName: name(s), guardianName: l.guardian.fullName, vars: { student: name(s), ...(vars.get(l.studentId) ?? {}) } });
  }
  return out;
}

// ───────────────────────── Broadcasts ─────────────────────────

const ANNOUNCEMENT_VARS = ["student", "school"] as const;
const FEE_VARS = ["student", "amount", "due", "school"] as const;

const broadcastSchema = z.object({
  kind: z.enum(["ANNOUNCEMENT", "FEE_REMINDER"]),
  title: text(120),
  bodyEn: z.string().trim().min(1, "Required").max(640, "Maximum 640 characters"),
  bodySw: optText(640),
  audience: audienceSchema,
  sendSms: z.boolean().default(true),
  sendInApp: z.boolean().default(true),
  sendAt: z.coerce.date().optional(),
});

function permFor(ctx: AuthContext, kind: "ANNOUNCEMENT" | "FEE_REMINDER") {
  requirePermission(ctx, kind === "FEE_REMINDER" ? "comms.fee_reminder" : "comms.send");
}

/** GSM-7 messages hold 160 characters (153 per part when joined); anything else falls back to 70 (67). */
export function smsParts(body: string): number {
  const gsm = /^[\x20-\x7E\n\r£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà€]*$/.test(body);
  const single = gsm ? 160 : 70, multi = gsm ? 153 : 67;
  return body.length <= single ? 1 : Math.ceil(body.length / multi);
}

function validateBodies(d: z.infer<typeof broadcastSchema>) {
  const allowed = d.kind === "FEE_REMINDER" ? FEE_VARS : ANNOUNCEMENT_VARS;
  for (const [field, body] of [["bodyEn", d.bodyEn], ["bodySw", d.bodySw]] as const) {
    if (!body) continue;
    const bad = unknownVars(body, allowed);
    if (bad.length) throw invalid("Please correct the highlighted fields.", { [field]: `Unknown variable ${bad.map((b) => `{${b}}`).join(", ")}. You can use: ${allowed.map((v) => `{${v}}`).join(" ")}` });
  }
  if (!d.sendSms && !d.sendInApp) throw invalid("Please correct the highlighted fields.", { sendSms: "Choose SMS, in-app, or both" });
  if (d.kind === "FEE_REMINDER" && !d.bodyEn.includes("{amount}")) throw invalid("Please correct the highlighted fields.", { bodyEn: "A fee reminder must include {amount} so parents see what is owed" });
  if (d.sendAt) {
    if (d.sendAt.getTime() < Date.now() - 5 * 60_000) throw invalid("Please correct the highlighted fields.", { sendAt: "Choose a time that has not passed" });
    if (d.sendAt.getTime() > Date.now() + 60 * 86_400_000) throw invalid("Please correct the highlighted fields.", { sendAt: "Schedule at most 60 days ahead" });
  }
}

export async function previewBroadcast(ctx: AuthContext, input: unknown) {
  const d = parse(broadcastSchema, input);
  permFor(ctx, d.kind);
  validateBodies(d);
  const recipients = await resolveRecipients(db, ctx.schoolId, d.kind, d.audience);
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { name: true } });
  const guardianIds = [...new Set(recipients.map((r) => r.guardianId))];
  const withPortal = await db.guardian.count({ where: { schoolId: ctx.schoolId, id: { in: guardianIds }, userId: { not: null }, user: { status: "ACTIVE" } } });
  const sample = recipients.slice(0, 3).map((r) => renderText(d.bodyEn, { ...r.vars, school: school.name }));
  const recent = d.kind === "FEE_REMINDER" ? await db.broadcast.findFirst({ where: { schoolId: ctx.schoolId, kind: "FEE_REMINDER", cancelledAt: null, createdAt: { gte: new Date(Date.now() - 3 * 86_400_000) } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }) : null;
  return {
    recipients: recipients.length, guardians: guardianIds.length, inAppReachable: withPortal, sms: d.sendSms ? recipients.length : 0, smsConfigured: getSmsAdapter().isConfigured(),
    smsParts: Math.max(...sample.map(smsParts), smsParts(d.bodyEn)), sample, recentReminderAt: recent?.createdAt ?? null,
  };
}

export async function createBroadcast(ctx: AuthContext, input: unknown) {
  const d = parse(broadcastSchema, input);
  permFor(ctx, d.kind);
  validateBodies(d);
  const recipients = await resolveRecipients(db, ctx.schoolId, d.kind, d.audience);
  if (!recipients.length) throw invalid("Please correct the highlighted fields.", { audience: "No parent matches this audience (parents must be linked to an enrolled student and have notifications switched on)" });
  const sendAt = d.sendAt ?? new Date();
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { name: true } });
  return db.$transaction(async (tx) => {
    const b = await tx.broadcast.create({ data: { schoolId: ctx.schoolId, kind: d.kind, title: d.title, bodyEn: d.bodyEn, bodySw: d.bodySw ?? null, audience: d.audience as unknown as Prisma.InputJsonValue, sendSms: d.sendSms, sendInApp: d.sendInApp, sendAt, recipientCount: recipients.length, createdById: ctx.userId } });
    await tx.notificationEvent.createMany({
      data: recipients.map((r) => ({
        schoolId: ctx.schoolId, type: d.kind, broadcastId: b.id, studentId: r.studentId, guardianId: r.guardianId, nextAttemptAt: sendAt,
        dedupeKey: d.kind === "FEE_REMINDER" ? `bc:${b.id}:${r.guardianId}:${r.studentId}` : `bc:${b.id}:${r.guardianId}`,
        payload: { title: d.title, bodyEn: d.bodyEn, bodySw: d.bodySw ?? null, studentName: r.studentName, guardianName: r.guardianName, school: school.name, sendSms: d.sendSms, sendInApp: d.sendInApp, vars: r.vars } as unknown as Prisma.InputJsonValue,
      })),
    });
    await writeAudit(tx, actorOf(ctx), { action: d.kind === "FEE_REMINDER" ? "broadcast.fee_reminder" : "broadcast.send", entityType: "Broadcast", entityId: b.id, summary: d.title, changes: { recipients: recipients.length, audience: d.audience, sendSms: d.sendSms, sendInApp: d.sendInApp, scheduled: sendAt.getTime() > Date.now() + 60_000 } });
    return b;
  });
}

/** Stops everything that has not been processed yet; messages already sent stay as history. */
export async function cancelBroadcast(ctx: AuthContext, id: string) {
  const b = await db.broadcast.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!b) throw notFound("Broadcast");
  permFor(ctx, b.kind);
  let stopped = 0;
  await db.$transaction(async (tx) => {
    if (!b.cancelledAt) await tx.broadcast.update({ where: { id }, data: { cancelledAt: new Date(), cancelledById: ctx.userId } });
    stopped = (await tx.notificationEvent.updateMany({ where: { schoolId: ctx.schoolId, broadcastId: id, status: "PENDING" }, data: { status: "CANCELLED" } })).count;
    await writeAudit(tx, actorOf(ctx), { action: "broadcast.cancel", entityType: "Broadcast", entityId: id, summary: b.title, changes: { stopped } });
  });
  return { stopped };
}

export async function listBroadcasts(ctx: AuthContext) {
  requirePermission(ctx, "comms.read");
  const rows = await db.broadcast.findMany({ where: { schoolId: ctx.schoolId }, orderBy: { createdAt: "desc" }, take: 100 });
  const stats = await db.notificationEvent.groupBy({ by: ["broadcastId", "status"], where: { schoolId: ctx.schoolId, broadcastId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
  return rows.map((b) => {
    const s = Object.fromEntries(stats.filter((x) => x.broadcastId === b.id).map((x) => [x.status, x._count._all]));
    return { ...b, pending: s.PENDING ?? 0, processed: s.PROCESSED ?? 0, failed: s.FAILED ?? 0, cancelled: s.CANCELLED ?? 0 };
  });
}

export async function getBroadcast(ctx: AuthContext, id: string) {
  requirePermission(ctx, "comms.read");
  const b = await db.broadcast.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!b) throw notFound("Broadcast");
  const [events, deliveries, author] = await Promise.all([
    db.notificationEvent.groupBy({ by: ["status"], where: { schoolId: ctx.schoolId, broadcastId: id }, _count: { _all: true } }),
    db.notificationDelivery.groupBy({ by: ["channel", "status"], where: { schoolId: ctx.schoolId, event: { broadcastId: id } }, _count: { _all: true } }),
    db.user.findUnique({ where: { id: b.createdById }, select: { fullName: true } }),
  ]);
  const ev = Object.fromEntries(events.map((e) => [e.status, e._count._all]));
  return {
    broadcast: b, author: author?.fullName ?? "—", events: { pending: ev.PENDING ?? 0, processed: ev.PROCESSED ?? 0, failed: ev.FAILED ?? 0, cancelled: ev.CANCELLED ?? 0 },
    deliveries: deliveries.map((d) => ({ channel: d.channel, status: d.status, count: d._count._all })),
  };
}

// ───────────────────────── Preferences ─────────────────────────

export const CATEGORIES = ["ABSENCE", "FEES", "RESULTS", "ANNOUNCEMENTS"] as const;

export async function getMyPreferences(ctx: AuthContext) {
  const rows = await db.notificationPreference.findMany({ where: { userId: ctx.userId } });
  return CATEGORIES.map((category) => {
    const r = rows.find((x) => x.category === category);
    return { category, smsEnabled: r?.smsEnabled ?? true, inAppEnabled: r?.inAppEnabled ?? true };
  });
}

const prefSchema = z.object({ category: z.enum(CATEGORIES), smsEnabled: z.boolean(), inAppEnabled: z.boolean() });

export async function setMyPreference(ctx: AuthContext, input: unknown) {
  const d = parse(prefSchema, input);
  await db.$transaction(async (tx) => {
    await tx.notificationPreference.upsert({ where: { userId_category: { userId: ctx.userId, category: d.category } }, create: { userId: ctx.userId, ...d }, update: { smsEnabled: d.smsEnabled, inAppEnabled: d.inAppEnabled } });
    await writeAudit(tx, actorOf(ctx), { action: "preferences.update", entityType: "User", entityId: ctx.userId, summary: d.category, changes: { smsEnabled: d.smsEnabled, inAppEnabled: d.inAppEnabled } });
  });
}

