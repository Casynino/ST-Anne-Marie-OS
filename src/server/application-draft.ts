import { db } from "@/lib/db";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getStorage } from "@/lib/storage";
import { actorOf, writeAudit } from "@/server/audit";
import { getAdmissionPolicy } from "@/server/admission-policy";
import { getMyApplication } from "@/server/application-fee";
import { DOCUMENT_TYPES, persistDocument, sniffType } from "@/server/documents";
import { assertNoOpenDuplicate, onlineSchema, prepareOnline, toStored, type StoredForm } from "@/server/online-application";
import { parse } from "@/lib/validation";

/*
 * What a family does with its application before it pays: look at everything it entered, change it, add the child's passport photo and the
 * papers the school asks for, and confirm. The payment details appear only after the family confirms; changing a detail or removing a file
 * takes the confirmation back. Everything here belongs to the family's own draft; nobody else's is ever visible (NOT_FOUND).
 */

const OPEN_FOR_FILES = ["AWAITING_PAYMENT", "SUBMITTED", "PAID_HOLD"] as const;
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"];

async function ownDraft(ctx: AuthContext, id: string) {
  const row = await db.applicationDraft.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (ctx.userType !== "GUARDIAN" || !row || row.userId !== ctx.userId) throw notFound("Application");
  return row;
}

async function liveDocuments(schoolId: string, draftId: string) {
  return db.document.findMany({ where: { schoolId, draftId, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, docType: true, fileName: true, mimeType: true, sizeBytes: true, verification: true, createdAt: true } });
}

/** What still has to be added before the family can confirm: the photo (when the school asks for it) and each required paper. */
export function checklist(policy: { applicationPhotoRequired: boolean; requiredDocTypes: string[] }, docs: { docType: string }[]) {
  const have = new Set(docs.map((d) => d.docType));
  const photo = { required: policy.applicationPhotoRequired, present: have.has("PASSPORT_PHOTO") };
  const papers = policy.requiredDocTypes.filter((t) => t !== "PASSPORT_PHOTO").map((docType) => ({ docType, present: have.has(docType) }));
  return { photo, papers, complete: (!photo.required || photo.present) && papers.every((p) => p.present) };
}

/** Everything the review page shows: the full details, the files, what is missing and whether the family has confirmed. */
export async function getApplicationReview(ctx: AuthContext, id: string) {
  const base = await getMyApplication(ctx, id);
  const row = await ownDraft(ctx, id);
  const [policy, docs] = await Promise.all([getAdmissionPolicy(db, ctx.schoolId), liveDocuments(ctx.schoolId, id)]);
  return { ...base, form: row.payload as unknown as StoredForm, documents: docs, checklist: checklist(policy, docs), confirmedAt: row.confirmedAt, photoId: docs.find((d) => d.docType === "PASSPORT_PHOTO")?.id ?? null };
}

/** The family corrects its application before paying. Changing anything takes back the confirmation. */
export async function updateMyApplication(ctx: AuthContext, id: string, input: Record<string, unknown>) {
  const row = await ownDraft(ctx, id);
  if (row.status !== "AWAITING_PAYMENT") throw conflict("This application can no longer be changed here. Contact the school office.");
  const d = parse(onlineSchema, { ...input, consent: "on", password: undefined, password2: undefined });
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { id: true, timezone: true } });
  await prepareOnline(school, d);
  const stored = toStored(d);
  await db.$transaction(async (tx) => {
    await assertNoOpenDuplicate(tx, ctx.schoolId, d);
    for (const other of await tx.applicationDraft.findMany({ where: { schoolId: ctx.schoolId, userId: ctx.userId, status: "AWAITING_PAYMENT", id: { not: id } }, select: { payload: true } })) {
      const o = other.payload as unknown as StoredForm;
      if (o.firstName.toLowerCase() === d.firstName.toLowerCase() && o.lastName.toLowerCase() === d.lastName.toLowerCase() && o.dateOfBirth === stored.dateOfBirth) throw conflict("You have already started an application for this child.");
    }
    await tx.applicationDraft.update({ where: { id }, data: { payload: stored as object, confirmedAt: null } });
    await writeAudit(tx, actorOf(ctx), { action: "admission.application_edit", entityType: "ApplicationDraft", entityId: id, summary: row.reference });
  });
}

/** The family confirms that the details, the photo and the papers are complete and correct; only then are the payment details shown. */
export async function confirmMyApplication(ctx: AuthContext, id: string) {
  const row = await ownDraft(ctx, id);
  if (row.status !== "AWAITING_PAYMENT") throw conflict("This application is not waiting for payment.");
  const [policy, docs] = await Promise.all([getAdmissionPolicy(db, ctx.schoolId), liveDocuments(ctx.schoolId, id)]);
  const c = checklist(policy, docs);
  if (!c.complete) throw invalid("Add the photo and the papers listed below first.", { files: "Something is missing" });
  await db.$transaction(async (tx) => {
    await tx.applicationDraft.update({ where: { id }, data: { confirmedAt: new Date() } });
    await writeAudit(tx, actorOf(ctx), { action: "admission.application_confirm", entityType: "ApplicationDraft", entityId: id, summary: row.reference });
  });
}

/** Adds the child's photo or a paper to the application. A new photo replaces the old one. Only PDF or images; the type is decided from the file's bytes. */
export async function uploadMyDocument(ctx: AuthContext, id: string, input: { docType: unknown; fileName: string; bytes: Buffer }) {
  const row = await ownDraft(ctx, id);
  if (!(OPEN_FOR_FILES as readonly string[]).includes(row.status)) throw conflict("Files can no longer be added to this application.");
  if (!(await consumeRateLimit(`draftdoc:${ctx.userId}`, 30, 60 * 60 * 1000))) throw invalid("Too many uploads. Please try again later.");
  const docType = String(input.docType);
  if (!(DOCUMENT_TYPES as readonly string[]).includes(docType)) throw invalid("Choose what the file is.", { docType: "Choose a type" });
  if (docType === "PASSPORT_PHOTO") {
    const type = sniffType(input.bytes);
    if (!type || !IMAGE_MIMES.includes(type.mime)) throw invalid("The photo must be a JPEG, PNG or WebP picture.", { file: "Not a picture" });
  }
  const doc = await persistDocument({ schoolId: ctx.schoolId, actor: actorOf(ctx), owner: row.applicationId ? { applicationId: row.applicationId, draftId: id } : { draftId: id }, docType, fileName: input.fileName, bytes: input.bytes, uploadedById: ctx.userId });
  if (docType === "PASSPORT_PHOTO") {
    await db.document.updateMany({ where: { schoolId: ctx.schoolId, draftId: id, docType: "PASSPORT_PHOTO", deletedAt: null, id: { not: doc.id } }, data: { deletedAt: new Date(), deletedById: ctx.userId } });
  }
  return doc;
}

/** The family removes a file it added, while the application has not been paid. Takes back the confirmation. */
export async function removeMyDocument(ctx: AuthContext, documentId: string) {
  const doc = await db.document.findFirst({ where: { id: documentId, schoolId: ctx.schoolId, deletedAt: null, draftId: { not: null } }, select: { id: true, draftId: true, docType: true, fileName: true } });
  if (!doc) throw notFound("Document");
  const row = await ownDraft(ctx, doc.draftId!);
  if (row.status !== "AWAITING_PAYMENT") throw forbidden("Files cannot be removed after the application has been sent.");
  await db.$transaction(async (tx) => {
    await tx.document.update({ where: { id: doc.id }, data: { deletedAt: new Date(), deletedById: ctx.userId } });
    await tx.applicationDraft.update({ where: { id: row.id }, data: { confirmedAt: null } });
    await writeAudit(tx, actorOf(ctx), { action: "document.delete", entityType: "Document", entityId: doc.id, summary: `${doc.docType} ${doc.fileName}`, reason: "Removed by the family" });
  });
}

/** A file the family uploaded, for its own download or the photo preview. Nobody else's. */
export async function downloadMyDocument(ctx: AuthContext, documentId: string) {
  if (ctx.userType !== "GUARDIAN") throw forbidden();
  const doc = await db.document.findFirst({ where: { id: documentId, schoolId: ctx.schoolId, deletedAt: null, draft: { userId: ctx.userId } } });
  if (!doc) throw notFound("Document");
  const storage = getStorage();
  if (!storage) throw invalid("File storage is not configured.");
  return { bytes: await storage.get(doc.storageKey), mimeType: doc.mimeType, fileName: doc.fileName };
}
