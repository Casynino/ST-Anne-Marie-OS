import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext, type RequestMeta } from "@/lib/auth/context";
import { consumeRateLimit } from "@/lib/rate-limit";
import { actorOf, writeAudit } from "@/server/audit";
import { checkbox, optEmailField, optPhoneField, optText, parse, text } from "@/lib/validation";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const enquirySchema = z
  .object({
    name: text(100),
    phone: optPhoneField(),
    email: optEmailField(),
    topic: optText(60),
    message: z.string().trim().min(10, "Please write at least a few words").max(2000, "Maximum 2000 characters"),
    consent: checkbox(),
  })
  .superRefine((v, c) => {
    if (!v.phone && !v.email) c.addIssue({ code: "custom", path: ["phone"], message: "Give a phone number or an email address so the school can reply" });
    if (!v.consent) c.addIssue({ code: "custom", path: ["consent"], message: "You must agree to continue" });
  });

/**
 * Public contact form. Unauthenticated, so the service enforces everything: honeypot, per-connection and
 * per-school rate limits, strict validation. The message is stored before anything is reported as sent.
 */
export async function submitEnquiry(schoolId: string, input: Record<string, unknown>, meta: RequestMeta): Promise<{ saved: boolean }> {
  if (typeof input.website === "string" && input.website.trim() !== "") return { saved: true }; // honeypot: bots learn nothing
  const school = await db.school.findUnique({ where: { id: schoolId }, select: { id: true } });
  if (!school) throw new AppError("NOT_FOUND", "School not found.");
  const ip = meta.ip ?? "unknown";
  const ok = (await consumeRateLimit(`enquiry:ip:${ip}`, 5, HOUR)) && (await consumeRateLimit(`enquiry:school:${school.id}`, 500, DAY));
  if (!ok) throw new AppError("RATE_LIMITED", "Too many messages from this connection. Please try again later or call the school.");
  const d = parse(enquirySchema, input);
  await db.$transaction(async (tx) => {
    const row = await tx.enquiry.create({ data: { schoolId: school.id, name: d.name, phone: d.phone, email: d.email, topic: d.topic, message: d.message, consentAt: new Date() } });
    await writeAudit(tx, { schoolId: school.id, actorId: null, actorName: "Website visitor", meta }, { action: "enquiry.create", entityType: "Enquiry", entityId: row.id, summary: d.topic ?? "Contact form" });
  });
  return { saved: true };
}

export async function listEnquiries(ctx: AuthContext, opts: { status?: string; page?: number } = {}) {
  requirePermission(ctx, "enquiry.read");
  const pageSize = 25;
  const page = Math.max(1, opts.page ?? 1);
  const status = ["NEW", "IN_PROGRESS", "RESOLVED"].includes(opts.status ?? "") ? (opts.status as "NEW") : undefined;
  const where = { schoolId: ctx.schoolId, ...(status ? { status } : {}) };
  const [items, total, counts] = await Promise.all([
    db.enquiry.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    db.enquiry.count({ where }),
    db.enquiry.groupBy({ by: ["status"], where: { schoolId: ctx.schoolId }, _count: { _all: true } }),
  ]);
  return { items, total, page, pageSize, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number> };
}

const updateSchema = z.object({ status: z.enum(["NEW", "IN_PROGRESS", "RESOLVED"]), internalNote: optText(1000) });

export async function updateEnquiry(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "enquiry.manage");
  const d = parse(updateSchema, input);
  const row = await db.enquiry.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!row) throw notFound("Enquiry");
  await db.$transaction(async (tx) => {
    await tx.enquiry.update({ where: { id }, data: { status: d.status, internalNote: d.internalNote ?? null, handledById: ctx.userId, handledAt: new Date() } });
    await writeAudit(tx, actorOf(ctx), { action: "enquiry.update", entityType: "Enquiry", entityId: id, summary: row.name, changes: { status: [row.status, d.status] } });
  });
}

export async function countNewEnquiries(ctx: AuthContext): Promise<number | null> {
  if (!ctx.permissions.has("enquiry.read")) return null;
  return db.enquiry.count({ where: { schoolId: ctx.schoolId, status: "NEW" } });
}
