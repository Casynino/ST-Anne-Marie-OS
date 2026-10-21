import { randomBytes, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { AppError, conflict, forbidden, notFound } from "@/lib/errors";
import { requireAnyPermission, type AuthContext, type RequestMeta } from "@/lib/auth/context";
import { centsOf, formatMoney } from "@/lib/finance/money";
import { getProviders } from "@/lib/payments/providers";
import { actorOf, writeAudit } from "@/server/audit";
import { getFeeSettings } from "@/server/fees";
import { getAdmissionPolicy } from "@/server/admission-policy";
import { allocateNumber } from "@/server/invoices";
import { openTask } from "@/server/workflow";
import { fromStored, insertOnlineApplication, isUniqueViolation, prepareOnline, STATUS_PUBLIC, type StoredForm } from "@/server/online-application";

/*
 * The online application fee. A family that applies online gets an account first and the application is saved as a DRAFT with a payment
 * reference (APF-XXXXXXXX). The draft becomes a real application, visible to the Admissions Office, only when the payment provider
 * CONFIRMS the payment for that reference. Nothing here ever marks a fee as paid on the family's word: the confirmation comes from the
 * provider's signed notification (see payment-events.ts), or, for local testing only, from the sandbox below.
 *
 * The sandbox stands in for the provider on a developer's computer. It is off unless PAYMENTS_SANDBOX=1 AND the app is not running in
 * production, and everything it produces is labelled as a test.
 */

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newFeeReference(): string {
  let s = "";
  for (const b of randomBytes(8)) s += ALPHABET[b % ALPHABET.length];
  return `APF-${s}`;
}
export const isFeeReference = (r: string | null | undefined) => /^APF-[A-Z0-9]{8}$/i.test((r ?? "").trim());

export const sandboxEnabled = (env: Record<string, string | undefined> = process.env) => env.PAYMENTS_SANDBOX === "1" && env.NODE_ENV !== "production";

/** Whether a family can really pay online: a provider is configured and the school has told families how to pay (or the local sandbox is on). */
export async function paymentSetup(schoolId: string, env: Record<string, string | undefined> = process.env) {
  const sandbox = sandboxEnabled(env);
  const instructions = (await getFeeSettings(db, schoolId)).paymentInstructions.trim();
  const provider = getProviders(env).some((p) => p.configured);
  return { sandbox, instructions, ready: sandbox || (provider && instructions.length > 0) };
}

/** What the public form needs to know: the fee, and whether online payment can actually be offered. */
export async function applicationFeeInfo(schoolId: string, env: Record<string, string | undefined> = process.env) {
  const [policy, school, setup] = await Promise.all([getAdmissionPolicy(db, schoolId), db.school.findUnique({ where: { id: schoolId }, select: { currency: true } }), paymentSetup(schoolId, env)]);
  return { feeCents: policy.applicationFeeCents, currency: school?.currency ?? "TZS", ready: setup.ready, sandbox: setup.sandbox };
}

// ───────────────────────── Confirmation (provider notification or sandbox) ─────────────────────────

export type FeeOutcome = "SUBMITTED" | "ALREADY" | "HOLD" | "UNKNOWN" | "MISMATCH" | "DUPLICATE_PAYMENT";
export type FeeResult = { outcome: FeeOutcome; draftId?: string; note?: string };

/**
 * Records a confirmed application-fee payment and submits the application. Idempotent: the same provider event never does it twice, and a
 * second payment for a reference that is already paid is reported (never silently absorbed). An amount that differs from the fee, or a
 * different currency, changes nothing and is left for Finance. If the money arrived but the application cannot be created (for example a
 * matching application appeared in the meantime) the draft is kept as PAID_HOLD and Finance gets a task: the payment is never lost.
 */
export async function confirmApplicationFee(a: { schoolId: string; reference: string; provider: string; providerEventId: string; amountCents: number; currency: string | null; at?: Date | null; meta: RequestMeta }): Promise<FeeResult> {
  const school = await db.school.findUniqueOrThrow({ where: { id: a.schoolId }, select: { id: true, timezone: true, currency: true } });
  const reference = a.reference.trim().toUpperCase();
  const draft = await db.applicationDraft.findUnique({ where: { schoolId_reference: { schoolId: a.schoolId, reference } } });
  if (!draft) return { outcome: "UNKNOWN" };
  if (draft.paymentProvider === a.provider && draft.paymentEventId === a.providerEventId) return { outcome: "ALREADY", draftId: draft.id };
  if (draft.paidAt) return { outcome: "DUPLICATE_PAYMENT", draftId: draft.id, note: `${reference} was already paid; this is a second payment to refund` };
  if (draft.status === "SUBMITTED") return { outcome: "ALREADY", draftId: draft.id };
  if (a.currency && a.currency.toUpperCase() !== school.currency) return { outcome: "MISMATCH", draftId: draft.id, note: `Currency ${a.currency} is not ${school.currency}` };
  const fee = centsOf(draft.feeAmount);
  if (a.amountCents !== fee) return { outcome: "MISMATCH", draftId: draft.id, note: `Paid ${formatMoney(a.amountCents, school.currency)} but the application fee is ${formatMoney(fee, school.currency)}` };

  const now = new Date();
  const paidAt = a.at && a.at <= now ? a.at : now;
  const year = Number(paidAt.toISOString().slice(0, 4));
  const paid = { paidAt, paidAmount: (a.amountCents / 100).toFixed(2), paymentProvider: a.provider, paymentEventId: a.providerEventId };
  const actor = { schoolId: a.schoolId, actorId: null, actorName: a.provider === "sandbox" ? "Test payment (sandbox)" : `Payment provider: ${a.provider}`, meta: a.meta };
  const form = fromStored(draft.payload as unknown as StoredForm);

  try {
    return await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ paidAt: Date | null }[]>`SELECT "paidAt" FROM application_drafts WHERE id = ${draft.id}::uuid FOR UPDATE`;
      if (rows[0]?.paidAt) return { outcome: "ALREADY" as const, draftId: draft.id }; // another delivery of the same notification won the race
      const prepared = await prepareOnline(school, form);
      const app = await insertOnlineApplication(tx, a.schoolId, form, prepared, a.meta, { feePaidCents: a.amountCents, feeReference: reference });
      const receiptNo = await allocateNumber(tx, a.schoolId, "APR", year);
      await tx.applicationDraft.update({ where: { id: draft.id }, data: { status: "SUBMITTED", ...paid, receiptNo, applicationId: app.id } });
      // The photo and papers the family added now belong to the application too, so the Admissions Office finds them with it.
      await tx.document.updateMany({ where: { schoolId: a.schoolId, draftId: draft.id, applicationId: null }, data: { applicationId: app.id } });
      await writeAudit(tx, actor, { action: "admission.application_fee_paid", entityType: "ApplicationDraft", entityId: draft.id, summary: `${reference} (${app.applicationNo})`, changes: { amountCents: a.amountCents, provider: a.provider, applicationNo: app.applicationNo, receiptNo } });
      return { outcome: "SUBMITTED" as const, draftId: draft.id };
    }, { timeout: 30000 });
  } catch (e) {
    if (!(e instanceof AppError) && !isUniqueViolation(e)) throw e; // a genuine fault: the provider is told to retry later
    const note = e instanceof AppError ? e.message : "A matching application already exists.";
    await db.$transaction(async (tx) => {
      const receiptNo = await allocateNumber(tx, a.schoolId, "APR", year);
      await tx.applicationDraft.update({ where: { id: draft.id }, data: { status: "PAID_HOLD", ...paid, receiptNo, holdNote: note } });
      await openTask(tx, { schoolId: a.schoolId, kind: "APPLICATION_FEE_HOLD", relatedType: "ApplicationDraft", relatedId: draft.id, relatedLabel: `${form.firstName} ${form.lastName} (${reference})`, sourceEvent: "application.fee_paid_not_submitted" });
      await writeAudit(tx, actor, { action: "admission.application_fee_hold", entityType: "ApplicationDraft", entityId: draft.id, summary: reference, changes: { amountCents: a.amountCents, provider: a.provider, reason: note } });
    });
    return { outcome: "HOLD", draftId: draft.id, note };
  }
}

// ───────────────────────── The family's side ─────────────────────────

export type MyApplication = {
  id: string; reference: string; childName: string; className: string | null; draftStatus: "AWAITING_PAYMENT" | "SUBMITTED" | "PAID_HOLD" | "CANCELLED";
  applicationNo: string | null; publicStatus: string | null; feeCents: number; paid: boolean; paidAt: Date | null; receiptNo: string | null; test: boolean; holdNote: string | null; createdAt: Date;
};

type DraftRow = NonNullable<Awaited<ReturnType<typeof loadDraftRow>>>;
async function loadDraftRow(schoolId: string, id: string) {
  return db.applicationDraft.findFirst({ where: { id, schoolId }, include: { application: { select: { applicationNo: true, status: true } } } });
}

async function classNames(schoolId: string, ids: string[]) {
  const rows = ids.length ? await db.schoolClass.findMany({ where: { schoolId, id: { in: ids } }, select: { id: true, name: true } }) : [];
  return new Map(rows.map((c) => [c.id, c.name]));
}

function view(d: DraftRow, classes: Map<string, string>): MyApplication {
  const p = d.payload as unknown as StoredForm;
  return {
    id: d.id, reference: d.reference, childName: [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" "), className: classes.get(p.classAppliedId) ?? null, draftStatus: d.status,
    applicationNo: d.application?.applicationNo ?? null, publicStatus: d.application ? (STATUS_PUBLIC[d.application.status] ?? "APPLIED") : null, feeCents: centsOf(d.feeAmount), paid: d.paidAt !== null, paidAt: d.paidAt, receiptNo: d.receiptNo,
    test: d.paymentProvider === "sandbox", holdNote: d.holdNote, createdAt: d.createdAt,
  };
}

/** The applications a signed-in family started, newest first. Only their own. */
export async function myApplications(ctx: AuthContext): Promise<MyApplication[]> {
  if (ctx.userType !== "GUARDIAN") return [];
  const rows = await db.applicationDraft.findMany({ where: { schoolId: ctx.schoolId, userId: ctx.userId }, orderBy: { createdAt: "desc" }, include: { application: { select: { applicationNo: true, status: true } } } });
  const classes = await classNames(ctx.schoolId, [...new Set(rows.map((r) => (r.payload as unknown as StoredForm).classAppliedId))]);
  return rows.map((r) => view(r, classes));
}

export async function getMyApplication(ctx: AuthContext, id: string) {
  if (ctx.userType !== "GUARDIAN") throw forbidden();
  const row = await loadDraftRow(ctx.schoolId, id);
  if (!row || row.userId !== ctx.userId) throw notFound("Application"); // never reveals someone else's
  const [classes, setup, school] = await Promise.all([classNames(ctx.schoolId, [(row.payload as unknown as StoredForm).classAppliedId]), paymentSetup(ctx.schoolId), db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { currency: true } })]);
  return { ...view(row, classes), currency: school.currency, instructions: setup.instructions, ready: setup.ready, sandbox: setup.sandbox };
}

export async function cancelMyApplication(ctx: AuthContext, id: string) {
  const row = await loadDraftRow(ctx.schoolId, id);
  if (ctx.userType !== "GUARDIAN" || !row || row.userId !== ctx.userId) throw notFound("Application");
  if (row.status !== "AWAITING_PAYMENT") throw conflict("Only an application that has not been paid can be cancelled.");
  await db.$transaction(async (tx) => {
    await tx.applicationDraft.update({ where: { id }, data: { status: "CANCELLED" } });
    await writeAudit(tx, actorOf(ctx), { action: "admission.application_cancel", entityType: "ApplicationDraft", entityId: id, summary: row.reference });
  });
}

/** Local testing only: stands in for the provider's confirmation so the whole flow can be tried without money. Refuses everywhere else. */
export async function sandboxPay(ctx: AuthContext, id: string, meta: RequestMeta): Promise<FeeResult> {
  if (!sandboxEnabled()) throw forbidden("Test payments are not available.");
  const row = await loadDraftRow(ctx.schoolId, id);
  if (ctx.userType !== "GUARDIAN" || !row || row.userId !== ctx.userId) throw notFound("Application");
  if (row.status !== "AWAITING_PAYMENT") throw conflict("This application is not waiting for payment.");
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { currency: true } });
  return confirmApplicationFee({ schoolId: ctx.schoolId, reference: row.reference, provider: "sandbox", providerEventId: `SBX-${randomUUID()}`, amountCents: centsOf(row.feeAmount), currency: school.currency, meta });
}

/** A draft the caller may download documents for: the family that owns it, or staff who read admissions. */
export async function draftForDownload(ctx: AuthContext, id: string) {
  const row = await loadDraftRow(ctx.schoolId, id);
  if (!row) throw notFound("Application");
  if (ctx.userType === "STAFF") requireAnyPermission(ctx, ["admission.read"]);
  else if (row.userId !== ctx.userId) throw notFound("Application");
  return row;
}

// ───────────────────────── Finance view ─────────────────────────

export async function applicationFeeLedger(ctx: AuthContext) {
  requireAnyPermission(ctx, ["finance.reports", "admission.payment.verify", "admission.payment.record"]);
  const rows = await db.applicationDraft.findMany({ where: { schoolId: ctx.schoolId, OR: [{ paidAt: { not: null } }, { status: "AWAITING_PAYMENT" }] }, orderBy: { createdAt: "desc" }, take: 200, include: { application: { select: { applicationNo: true } } } });
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { currency: true } });
  return {
    currency: school.currency,
    rows: rows.map((d) => {
      const p = d.payload as unknown as StoredForm;
      return { id: d.id, reference: d.reference, child: `${p.firstName} ${p.lastName}`, guardian: p.g1_fullName, status: d.status, feeCents: centsOf(d.feeAmount), paidCents: d.paidAmount ? centsOf(d.paidAmount) : 0, paidAt: d.paidAt, receiptNo: d.receiptNo, applicationNo: d.application?.applicationNo ?? null, provider: d.paymentProvider, holdNote: d.holdNote, createdAt: d.createdAt };
    }),
  };
}
