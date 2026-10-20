import { z } from "zod";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { conflict, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext, type RequestMeta } from "@/lib/auth/context";
import { parseDateOnly, todayInTimezone } from "@/lib/dates";
import { centsOf, formatMoney } from "@/lib/finance/money";
import { getProvider, getProviders, type NormalizedEvent } from "@/lib/payments/providers";
import { actorOf, writeAudit, type AuditActor } from "@/server/audit";
import { postPaymentTx } from "@/server/payments";
import { optUuid, parse, text, uuid } from "@/lib/validation";

export const MAX_WEBHOOK_BYTES = 256 * 1024;
const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";

type Reply = { status: number; body: Record<string, unknown> };

async function resolveSchool(env: Record<string, string | undefined>) {
  const code = env.PAYMENTS_SCHOOL_CODE?.trim();
  if (code) return db.school.findUnique({ where: { code } });
  const schools = await db.school.findMany({ take: 2, orderBy: { createdAt: "asc" } });
  return schools.length === 1 ? schools[0]! : null; // several schools and no explicit code: refuse rather than guess
}

/** Matches the payer's reference to exactly one student (admission number, or the number of one of their invoices). */
async function matchReference(schoolId: string, reference: string | null) {
  if (!reference) return { students: [] as string[], invoiceId: null as string | null };
  const ref = reference.trim();
  const [byAdmission, byInvoice] = await Promise.all([
    db.student.findMany({ where: { schoolId, admissionNo: { equals: ref, mode: "insensitive" } }, select: { id: true } }),
    db.invoice.findMany({ where: { schoolId, number: { equals: ref, mode: "insensitive" }, status: "ISSUED" }, select: { id: true, studentId: true } }),
  ]);
  const students = [...new Set([...byAdmission.map((s) => s.id), ...byInvoice.map((i) => i.studentId)])];
  return { students, invoiceId: students.length === 1 && byInvoice.length === 1 ? byInvoice[0]!.id : null };
}

/**
 * Handles one provider notification. Order matters: refuse unknown/unconfigured providers, verify the signature on the
 * exact raw body, store the event once (unique per provider event id, so retries are harmless), and only then, for a
 * verified SUCCESS event that matches exactly one student, record a payment. Pending and failed notifications are stored
 * and never create money. Anything that cannot be matched waits in the reconciliation queue for a person.
 */
export async function processProviderEvent(providerKey: string, rawBody: string, headers: { get(name: string): string | null }, meta: RequestMeta, env: Record<string, string | undefined> = process.env): Promise<Reply> {
  const provider = getProvider(providerKey, env);
  if (!provider) return { status: 404, body: { error: "Unknown provider" } };
  if (!provider.configured) return { status: 503, body: { error: "This provider is not configured" } };
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) return { status: 413, body: { error: "Payload too large" } };
  if (!provider.verify(rawBody, headers)) return { status: 401, body: { error: "Invalid signature" } };

  let event: NormalizedEvent;
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
    event = provider.parse(payload);
  } catch {
    return { status: 422, body: { error: "Unrecognised payload" } };
  }
  const school = await resolveSchool(env);
  if (!school) return { status: 503, body: { error: "School could not be determined" } };

  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  let eventId: string;
  try {
    const row = await db.paymentEvent.create({
      data: {
        schoolId: school.id, provider: provider.key, providerEventId: event.providerEventId, providerStatus: event.status, status: event.status === "SUCCESS" ? "UNMATCHED" : "NOT_SUCCESSFUL",
        amount: event.amountCents === null ? null : (event.amountCents / 100).toFixed(2), currency: event.currency, reference: event.reference, msisdn: event.msisdn, occurredAt: event.occurredAt,
        payloadHash, payload: payload as object,
      },
    });
    eventId = row.id;
  } catch (e) {
    if (isUnique(e)) {
      const existing = await db.paymentEvent.findUnique({ where: { schoolId_provider_providerEventId: { schoolId: school.id, provider: provider.key, providerEventId: event.providerEventId } } });
      return { status: 200, body: { duplicate: true, status: existing?.status ?? null } };
    }
    throw e;
  }
  if (event.status !== "SUCCESS") return { status: 200, body: { status: "NOT_SUCCESSFUL" } };

  const note = (n: string) => db.paymentEvent.update({ where: { id: eventId }, data: { note: n, processedAt: new Date() } });
  if (event.amountCents === null || event.amountCents <= 0) { await note("Amount missing or not positive"); return { status: 200, body: { status: "UNMATCHED" } }; }
  if (event.currency !== school.currency) { await note(`Currency ${event.currency ?? "(none)"} is not ${school.currency}`); return { status: 200, body: { status: "UNMATCHED" } }; }
  const match = await matchReference(school.id, event.reference);
  if (match.students.length !== 1) { await note(match.students.length === 0 ? "No student matches the reference" : "The reference matches more than one student"); return { status: 200, body: { status: "UNMATCHED" } }; }

  const actor: AuditActor = { schoolId: school.id, actorId: null, actorName: `Provider: ${provider.name}`, meta };
  try {
    await db.$transaction(async (tx) => {
      const today = todayInTimezone(school.timezone);
      const on = event.occurredAt ? todayInTimezone(school.timezone, event.occurredAt) : today;
      const { payment } = await postPaymentTx(tx, {
        schoolId: school.id, actor, createdById: null, studentId: match.students[0]!, amountCents: event.amountCents!, method: provider.method, provider: provider.key, reference: event.providerEventId,
        receivedOn: parseDateOnly(on > today ? today : on)!, payerName: event.msisdn ? `MSISDN ${event.msisdn}` : null, notes: event.reference ? `Payer reference: ${event.reference}` : null,
        targetInvoiceId: match.invoiceId, source: "PROVIDER", auditExtra: { providerEventId: event.providerEventId },
      });
      await tx.paymentEvent.update({ where: { id: eventId }, data: { status: "POSTED", paymentId: payment.id, studentId: match.students[0]!, processedAt: new Date() } });
    });
    return { status: 200, body: { status: "POSTED" } };
  } catch (e) {
    // Posting failed after the event was stored: it stays in the queue for a person; the provider is told to retry later.
    console.error(JSON.stringify({ level: "error", msg: "provider_event_post_failed", provider: provider.key, error: e instanceof Error ? e.message : String(e) }));
    await note("Posting failed; resolve it from the reconciliation queue").catch(() => undefined);
    return { status: 500, body: { error: "Could not record the payment" } };
  }
}

// ───────────────────────── Reconciliation queue ─────────────────────────

export function providerStatuses(ctx: AuthContext, env: Record<string, string | undefined> = process.env) {
  requirePermission(ctx, "finance.reconcile");
  return getProviders(env).map((p) => ({ key: p.key, name: p.name, configured: p.configured }));
}

export async function listPaymentEvents(ctx: AuthContext, filter: { status?: string; page?: number } = {}) {
  requirePermission(ctx, "finance.reconcile");
  const pageSize = 25;
  const page = Math.max(1, filter.page ?? 1);
  const where = { schoolId: ctx.schoolId, ...(filter.status ? { status: filter.status as never } : {}) };
  const [items, total] = await Promise.all([
    db.paymentEvent.findMany({ where, orderBy: { receivedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    db.paymentEvent.count({ where }),
  ]);
  return { items: items.map((e) => ({ ...e, amountCents: e.amount === null ? null : centsOf(e.amount) })), total, page, pageSize };
}

export async function countUnmatchedEvents(ctx: AuthContext): Promise<number> {
  requirePermission(ctx, "finance.reconcile");
  return db.paymentEvent.count({ where: { schoolId: ctx.schoolId, status: "UNMATCHED" } });
}

const assignSchema = z.object({ studentId: uuid(), targetInvoiceId: optUuid() });

/** A person confirms which student a verified, unmatched payment belongs to. Only SUCCESS events can be assigned. */
export async function assignPaymentEvent(ctx: AuthContext, eventId: string, input: unknown) {
  requirePermission(ctx, "finance.reconcile");
  const d = parse(assignSchema, input);
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { timezone: true, currency: true } });
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM payment_events WHERE id = ${eventId}::uuid FOR UPDATE`;
    const ev = await tx.paymentEvent.findFirst({ where: { id: eventId, schoolId: ctx.schoolId } });
    if (!ev) throw notFound("Notification");
    if (ev.status !== "UNMATCHED") throw conflict("This notification has already been handled.");
    if (ev.providerStatus !== "SUCCESS" || ev.amount === null || centsOf(ev.amount) <= 0 || ev.currency !== school.currency) throw conflict("Only a successful notification in the school currency can be turned into a payment.");
    const provider = getProvider(ev.provider);
    const today = todayInTimezone(school.timezone);
    const on = ev.occurredAt ? todayInTimezone(school.timezone, ev.occurredAt) : today;
    const { payment } = await postPaymentTx(tx, {
      schoolId: ctx.schoolId, actor: actorOf(ctx), createdById: ctx.userId, studentId: d.studentId, amountCents: centsOf(ev.amount), method: provider?.method ?? "MOBILE_MONEY", provider: ev.provider, reference: ev.providerEventId,
      receivedOn: parseDateOnly(on > today ? today : on)!, payerName: ev.msisdn ? `MSISDN ${ev.msisdn}` : null, notes: ev.reference ? `Payer reference: ${ev.reference}` : null,
      targetInvoiceId: d.targetInvoiceId ?? null, source: "PROVIDER", auditExtra: { providerEventId: ev.providerEventId, matchedBy: "reconciliation" },
    });
    await tx.paymentEvent.update({ where: { id: eventId }, data: { status: "POSTED", paymentId: payment.id, studentId: d.studentId, resolvedById: ctx.userId, processedAt: new Date(), note: ev.note ? `${ev.note} → matched by a person` : "Matched by a person" } });
    await writeAudit(tx, actorOf(ctx), { action: "payment_event.assign", entityType: "PaymentEvent", entityId: eventId, summary: formatMoney(centsOf(ev.amount)), changes: { studentId: d.studentId, paymentId: payment.id } });
  });
}

export async function rejectPaymentEvent(ctx: AuthContext, eventId: string, input: unknown) {
  requirePermission(ctx, "finance.reconcile");
  const { reason } = parse(z.object({ reason: text(300) }), input);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM payment_events WHERE id = ${eventId}::uuid FOR UPDATE`;
    const ev = await tx.paymentEvent.findFirst({ where: { id: eventId, schoolId: ctx.schoolId } });
    if (!ev) throw notFound("Notification");
    if (ev.status !== "UNMATCHED") throw conflict("This notification has already been handled.");
    await tx.paymentEvent.update({ where: { id: eventId }, data: { status: "REJECTED", resolvedById: ctx.userId, processedAt: new Date(), note: reason } });
    await writeAudit(tx, actorOf(ctx), { action: "payment_event.reject", entityType: "PaymentEvent", entityId: eventId, summary: ev.reference ?? ev.providerEventId, reason });
  });
}

