import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { db } from "@/lib/db";
import { conflict, invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { centsOf, parseAmount } from "@/lib/finance/money";
import { actorOf, writeAudit } from "@/server/audit";
import { getAdmissionPolicy } from "@/server/admission-policy";
import { checkIncomingFiles, saveIncomingFiles, type IncomingFile } from "@/server/application-draft";
import { confirmApplicationFee, newFeeReference, paymentSetup, type FeeResult } from "@/server/application-fee";
import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, persistDocument, sniffType } from "@/server/documents";
import { assertNoOpenDuplicate, DUPLICATE_MESSAGE, insertOnlineApplication, isUniqueViolation, onlineSchema, prepareOnline, toStored, type StoredForm } from "@/server/online-application";
import { optText, parse } from "@/lib/validation";

/*
 * An application filled in at the school office is the SAME application as one filled in online: the same form, the same checks, the same
 * application fee, the same receipt and the same result (an application in the Admissions Office's queue). The difference is only who typed
 * it. It is kept as a draft until the fee is paid, so the family can be given the printed form with its payment reference, pay at the
 * Finance office (or by phone with the reference), and come back with the receipt. Finance recording the fee, or the payment provider
 * confirming it, is what submits the application. Nothing here marks a fee as paid on anyone's word but Finance's.
 */

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"];
const OPEN_DRAFT = ["AWAITING_PAYMENT"] as const;

type Input = Record<string, unknown>;
const parseForm = (input: Input) => parse(onlineSchema, { ...input, password: undefined, password2: undefined });

async function assertNoOpenDraft(tx: Tx, schoolId: string, stored: StoredForm, exceptId?: string) {
  for (const other of await tx.applicationDraft.findMany({ where: { schoolId, status: { in: [...OPEN_DRAFT] }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { reference: true, payload: true } })) {
    const o = other.payload as unknown as StoredForm;
    if (o.firstName.toLowerCase() === stored.firstName.toLowerCase() && o.lastName.toLowerCase() === stored.lastName.toLowerCase() && o.dateOfBirth === stored.dateOfBirth) throw conflict(`An application for this child is already waiting for its application fee (${other.reference}).`);
  }
}

/**
 * Saves an application filled in at the office. With no application fee set by the school it is submitted at once; otherwise it waits for the
 * fee as a draft with a payment reference. The photo and papers are optional here (they can be added later and are checked by the office).
 */
export async function createOfficeApplication(ctx: AuthContext, input: Input, files: IncomingFile[]) {
  requirePermission(ctx, "admission.create");
  const d = parseForm(input);
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { id: true, timezone: true } });
  const prepared = await prepareOnline(school, d);
  await checkIncomingFiles(ctx.schoolId, files, d.entryType, { requireAll: false });
  const feeCents = (await getAdmissionPolicy(db, ctx.schoolId)).applicationFeeCents;
  const stored = toStored(d);
  try {
    const r = await db.$transaction(async (tx) => {
      await assertNoOpenDuplicate(tx, ctx.schoolId, d);
      await assertNoOpenDraft(tx, ctx.schoolId, stored);
      const base = { schoolId: ctx.schoolId, channel: "OFFICE", createdById: ctx.userId, reference: newFeeReference(), payload: stored as object };
      if (feeCents === 0) {
        const app = await insertOnlineApplication(tx, ctx.schoolId, d, prepared, ctx.meta, {}, { createdById: ctx.userId, actor: actorOf(ctx) });
        const draft = await tx.applicationDraft.create({ data: { ...base, feeAmount: "0.00", status: "SUBMITTED", applicationId: app.id } });
        return { draftId: draft.id, applicationId: app.id, applicationNo: app.applicationNo, reference: draft.reference };
      }
      const draft = await tx.applicationDraft.create({ data: { ...base, feeAmount: (feeCents / 100).toFixed(2) } });
      await writeAudit(tx, actorOf(ctx), { action: "admission.office_application_draft", entityType: "ApplicationDraft", entityId: draft.id, summary: `${d.firstName} ${d.lastName} (${draft.reference})`, changes: { feeCents } });
      return { draftId: draft.id, applicationId: null as string | null, applicationNo: null as string | null, reference: draft.reference };
    });
    if (files.length > 0) await saveIncomingFiles({ schoolId: ctx.schoolId, userId: ctx.userId, draftId: r.draftId, applicationId: r.applicationId, files, actor: actorOf(ctx) });
    return { ...r, feeCents };
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(DUPLICATE_MESSAGE);
    throw e;
  }
}

async function ownOfficeDraft(ctx: AuthContext, id: string) {
  const row = await db.applicationDraft.findFirst({ where: { id, schoolId: ctx.schoolId, channel: "OFFICE" } });
  if (!row) throw notFound("Application");
  return row;
}

/** Corrects an application filled in at the office while it is still waiting for its fee. */
export async function updateOfficeDraft(ctx: AuthContext, id: string, input: Input) {
  requirePermission(ctx, "admission.create");
  const d = parseForm(input);
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { id: true, timezone: true } });
  await prepareOnline(school, d);
  const stored = toStored(d);
  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: string }[]>`SELECT status::text FROM application_drafts WHERE id = ${id}::uuid AND "schoolId" = ${ctx.schoolId}::uuid AND channel = 'OFFICE' FOR UPDATE`;
    if (!rows.length) throw notFound("Application");
    if (rows[0]!.status !== "AWAITING_PAYMENT") throw conflict("This application can no longer be changed here: its fee has been paid or it was cancelled.");
    await assertNoOpenDuplicate(tx, ctx.schoolId, d);
    await assertNoOpenDraft(tx, ctx.schoolId, stored, id);
    const row = await tx.applicationDraft.update({ where: { id }, data: { payload: stored as object } });
    await writeAudit(tx, actorOf(ctx), { action: "admission.office_application_edit", entityType: "ApplicationDraft", entityId: id, summary: `${d.firstName} ${d.lastName} (${row.reference})` });
  });
}

/** Withdraws an application that was filled in at the office before the fee was paid. A reason is kept. */
export async function cancelOfficeDraft(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "admission.create");
  const { reason } = parse(z.object({ reason: optText(300) }), input);
  if (!reason) throw invalid("Say why it is cancelled.", { reason: "Required" });
  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: string; reference: string }[]>`SELECT status::text, reference FROM application_drafts WHERE id = ${id}::uuid AND "schoolId" = ${ctx.schoolId}::uuid AND channel = 'OFFICE' FOR UPDATE`;
    if (!rows.length) throw notFound("Application");
    if (rows[0]!.status !== "AWAITING_PAYMENT") throw conflict("Only an application that has not been paid can be cancelled.");
    await tx.applicationDraft.update({ where: { id }, data: { status: "CANCELLED" } });
    await writeAudit(tx, actorOf(ctx), { action: "admission.office_application_cancel", entityType: "ApplicationDraft", entityId: id, summary: rows[0]!.reference, reason });
  });
}

/** Adds the child's photo or a paper to an application that is waiting for its fee (a new photo replaces the old one). */
export async function uploadOfficeDraftDocument(ctx: AuthContext, id: string, input: { docType: unknown; fileName: string; bytes: Buffer }) {
  requirePermission(ctx, "admission.create");
  const row = await ownOfficeDraft(ctx, id);
  if (row.status !== "AWAITING_PAYMENT") throw conflict("Papers can be added to the application itself once the fee has been paid.");
  const docType = String(input.docType);
  if (!(DOCUMENT_TYPES as readonly string[]).includes(docType)) throw invalid("Choose what the file is.", { docType: "Choose a type" });
  if (input.bytes.length > MAX_DOCUMENT_BYTES) throw invalid(`The file is too large (limit ${Math.floor(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB).`, { file: "File too large" });
  if (docType === "PASSPORT_PHOTO") {
    const type = sniffType(input.bytes);
    if (!type || !IMAGE_MIMES.includes(type.mime)) throw invalid("The photo must be a JPEG, PNG or WebP picture.", { file: "Not a picture" });
  }
  const doc = await persistDocument({ schoolId: ctx.schoolId, actor: actorOf(ctx), owner: { draftId: id }, docType, fileName: input.fileName, bytes: input.bytes, uploadedById: ctx.userId });
  if (docType === "PASSPORT_PHOTO") await db.document.updateMany({ where: { schoolId: ctx.schoolId, draftId: id, docType: "PASSPORT_PHOTO", deletedAt: null, id: { not: doc.id } }, data: { deletedAt: new Date(), deletedById: ctx.userId } });
  return doc;
}

// ───────────────────────── Reads ─────────────────────────

/** Applications filled in at the office that are waiting for their fee (or whose fee was received but could not be submitted). */
export async function listOfficeDrafts(ctx: AuthContext) {
  requirePermission(ctx, "admission.read");
  const rows = await db.applicationDraft.findMany({ where: { schoolId: ctx.schoolId, channel: "OFFICE", status: { in: ["AWAITING_PAYMENT", "PAID_HOLD"] } }, orderBy: { createdAt: "desc" }, take: 200 });
  const people = await db.user.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(rows.flatMap((r) => (r.createdById ? [r.createdById] : [])))] } }, select: { id: true, fullName: true } });
  const classes = await db.schoolClass.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true } });
  return rows.map((r) => {
    const p = r.payload as unknown as StoredForm;
    return { id: r.id, reference: r.reference, status: r.status, child: [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" "), className: classes.find((c) => c.id === p.classAppliedId)?.name ?? null, guardian: p.g1_fullName, phone: p.g1_phone, feeCents: centsOf(r.feeAmount), createdAt: r.createdAt, createdBy: people.find((u) => u.id === r.createdById)?.fullName ?? null };
  });
}

export async function getOfficeDraft(ctx: AuthContext, id: string) {
  requirePermission(ctx, "admission.read");
  const row = await db.applicationDraft.findFirst({ where: { id, schoolId: ctx.schoolId, channel: "OFFICE" }, include: { application: { select: { id: true, applicationNo: true } } } });
  if (!row) throw notFound("Application");
  const form = row.payload as unknown as StoredForm;
  const [cls, school, docs, creator, setup] = await Promise.all([
    db.schoolClass.findFirst({ where: { id: form.classAppliedId, schoolId: ctx.schoolId }, select: { name: true } }),
    db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { currency: true } }),
    db.document.findMany({ where: { schoolId: ctx.schoolId, draftId: id, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, docType: true, fileName: true, sizeBytes: true } }),
    row.createdById ? db.user.findFirst({ where: { id: row.createdById }, select: { fullName: true } }) : null,
    paymentSetup(ctx.schoolId),
  ]);
  return {
    id: row.id, reference: row.reference, status: row.status, feeCents: centsOf(row.feeAmount), currency: school.currency, createdAt: row.createdAt, createdBy: creator?.fullName ?? null, className: cls?.name ?? null,
    // Health information is medical: only people allowed to read medical notes see it.
    form: { ...form, healthNotes: ctx.permissions.has("student.medical.read") ? form.healthNotes : undefined },
    documents: docs, application: row.application, instructions: setup.instructions, paidAt: row.paidAt, receiptNo: row.receiptNo, holdNote: row.holdNote,
  };
}

// ───────────────────────── Finance: the fee received at the office ─────────────────────────

const receiveSchema = z.object({
  method: z.enum(["CASH", "BANK", "MOBILE_MONEY", "OTHER"]),
  amount: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.union([z.string(), z.number()]).optional()),
  note: optText(200),
});

/**
 * Finance records the application fee a family paid at the office (cash, bank, or mobile money received to the school). It uses the same
 * confirmation as the payment provider's: the receipt is issued, the application is created in the Admissions Office's queue and the papers
 * move to it. The amount must be the fee; anything else is refused and left for Finance to sort out. The Admissions Office cannot do this.
 */
export async function recordApplicationFeeAtOffice(ctx: AuthContext, draftId: string, input: unknown): Promise<FeeResult & { applicationNo: string | null; receiptNo: string | null }> {
  requirePermission(ctx, "admission.payment.record");
  const d = parse(receiveSchema, input);
  const row = await db.applicationDraft.findFirst({ where: { id: draftId, schoolId: ctx.schoolId } });
  if (!row) throw notFound("Application");
  if (row.status !== "AWAITING_PAYMENT") throw conflict("This application is not waiting for its fee.");
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { currency: true } });
  const amount = d.amount === undefined ? centsOf(row.feeAmount) : parseAmount(d.amount);
  if (amount === null) throw invalid("Please correct the highlighted fields.", { amount: "Enter an amount such as 10000" });
  const r = await confirmApplicationFee({ schoolId: ctx.schoolId, reference: row.reference, provider: "office", providerEventId: `OFFICE-${randomUUID()}`, amountCents: amount, currency: school.currency, meta: ctx.meta, by: ctx, method: d.method, note: d.note });
  if (r.outcome === "MISMATCH") throw invalid(r.note ?? "The amount is not the application fee.", { amount: "Must be the application fee" });
  if (r.outcome !== "SUBMITTED" && r.outcome !== "HOLD") throw conflict(r.note ?? "This fee could not be recorded.");
  const after = await db.applicationDraft.findUnique({ where: { id: draftId }, select: { receiptNo: true, application: { select: { applicationNo: true } } } });
  return { ...r, applicationNo: after?.application?.applicationNo ?? null, receiptNo: after?.receiptNo ?? null };
}
