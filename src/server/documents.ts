import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { conflict, invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { getStorage } from "@/lib/storage";
import { DOCUMENT_TYPES } from "@/lib/admissions/document-types";
import { actorOf, writeAudit, type AuditActor } from "@/server/audit";
import { studentScope } from "@/server/students";
import { parse, text } from "@/lib/validation";

/*
 * Document uploads. Rules:
 *  - type is decided from the file's own bytes (PDF/JPEG/PNG/WebP), never from the client-supplied name or MIME
 *  - size limit (default 4 MB; DOCUMENT_MAX_BYTES) and a per-owner cap
 *  - stored under a random key; the original file name is metadata only
 *  - every download/delete is permission-checked and written to the audit log; there is no public URL
 *  - "delete" hides the document and is audited; the stored object is kept until a retention policy exists (Phase 8)
 */

export { DOCUMENT_TYPES };
export const MAX_DOCUMENT_BYTES = Number(process.env.DOCUMENT_MAX_BYTES) || 4 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_OWNER = 20;

export type SniffedType = { mime: "application/pdf" | "image/jpeg" | "image/png" | "image/webp"; ext: "pdf" | "jpg" | "png" | "webp" };

/** Identifies an allowed file type from its leading bytes. Returns null for anything else. */
export function sniffType(b: Buffer): SniffedType | null {
  if (b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

/** File name for display and Content-Disposition: no paths, no control characters, bounded length. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "").trim().slice(-120);
  return cleaned || "document";
}

type Owner = { applicationId?: string; studentId?: string };

/** Confirms the owner exists in the user's school and that the user may see it. */
async function assertOwnerAccess(ctx: AuthContext, owner: Owner): Promise<void> {
  if (Boolean(owner.applicationId) === Boolean(owner.studentId)) throw invalid("A document belongs to either an application or a student.");
  if (owner.applicationId) {
    requirePermission(ctx, "admission.read");
    if (!(await db.application.findFirst({ where: { id: owner.applicationId, schoolId: ctx.schoolId }, select: { id: true } }))) throw notFound("Application");
  } else {
    const scope = await studentScope(ctx);
    if (!(await db.student.findFirst({ where: { AND: [scope, { id: owner.studentId }] }, select: { id: true } }))) throw notFound("Student");
  }
}

const uploadSchema = z.object({ docType: z.enum(DOCUMENT_TYPES), fileName: text(255) });

/**
 * Checks and stores one file and records it (shared by staff uploads and by an applicant uploading with their application number).
 * The type is decided from the bytes, the size is capped, the stored key is random and the file is kept only if the record is saved.
 */
export async function persistDocument(a: { schoolId: string; actor: AuditActor; owner: Owner; docType: unknown; fileName: string; bytes: Buffer; uploadedById: string | null }) {
  const d = parse(uploadSchema, { docType: a.docType, fileName: a.fileName });
  const { bytes } = a;
  if (bytes.length === 0) throw invalid("The file is empty.", { file: "The file is empty" });
  if (bytes.length > MAX_DOCUMENT_BYTES) throw invalid(`The file is too large. The limit is ${Math.floor(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB.`, { file: "File too large" });
  const type = sniffType(bytes);
  if (!type) throw invalid("Only PDF, JPEG, PNG or WebP files are accepted.", { file: "Unsupported file type" });
  const storage = getStorage();
  if (!storage) throw invalid("File storage is not configured. Ask the administrator to set it up before uploading documents.");

  const count = await db.document.count({ where: { schoolId: a.schoolId, deletedAt: null, ...(a.owner.applicationId ? { applicationId: a.owner.applicationId } : { studentId: a.owner.studentId }) } });
  if (count >= MAX_DOCUMENTS_PER_OWNER) throw conflict(`At most ${MAX_DOCUMENTS_PER_OWNER} documents can be attached. Remove one first.`);

  const storageKey = `${a.schoolId}/${new Date().getUTCFullYear()}/${randomUUID()}.${type.ext}`;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await storage.put(storageKey, bytes, { contentType: type.mime });
  try {
    return await db.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: { schoolId: a.schoolId, applicationId: a.owner.applicationId, studentId: a.owner.studentId, docType: d.docType, fileName: safeFileName(d.fileName), mimeType: type.mime, sizeBytes: bytes.length, sha256, storageKey, uploadedById: a.uploadedById },
      });
      await writeAudit(tx, a.actor, {
        action: "document.upload",
        entityType: "Document",
        entityId: doc.id,
        summary: `${d.docType} ${doc.fileName}`,
        changes: { ...a.owner, mimeType: type.mime, sizeBytes: bytes.length, sha256, ...(a.uploadedById ? {} : { by: "applicant" }) },
      });
      return doc;
    });
  } catch (e) {
    await storage.delete(storageKey).catch(() => undefined); // do not leave an orphan object behind
    throw e;
  }
}

export async function uploadDocument(ctx: AuthContext, owner: Owner, input: { docType: unknown; fileName: string; bytes: Buffer }) {
  requirePermission(ctx, "document.upload");
  parse(uploadSchema, { docType: input.docType, fileName: input.fileName });
  await assertOwnerAccess(ctx, owner);
  if (owner.studentId) requirePermission(ctx, "student.update");
  return persistDocument({ schoolId: ctx.schoolId, actor: actorOf(ctx), owner, docType: input.docType, fileName: input.fileName, bytes: input.bytes, uploadedById: ctx.userId });
}

export async function listDocuments(ctx: AuthContext, owner: Owner) {
  requirePermission(ctx, "document.read");
  await assertOwnerAccess(ctx, owner);
  const docs = await db.document.findMany({
    where: { schoolId: ctx.schoolId, deletedAt: null, ...(owner.applicationId ? { applicationId: owner.applicationId } : { studentId: owner.studentId }) },
    orderBy: { createdAt: "desc" },
  });
  const users = await db.user.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(docs.flatMap((d) => (d.uploadedById ? [d.uploadedById] : [])))] } }, select: { id: true, fullName: true } });
  return docs.map((d) => ({ id: d.id, docType: d.docType, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, createdAt: d.createdAt, uploadedBy: d.uploadedById ? (users.find((u) => u.id === d.uploadedById)?.fullName ?? "") : "Applicant", verification: d.verification, verificationNote: d.verificationNote, verifiedAt: d.verifiedAt }));
}

/** Loads a document the user may open. Throws NOT_FOUND for anything outside their school or scope. */
async function loadAccessible(ctx: AuthContext, documentId: string) {
  const doc = await db.document.findFirst({ where: { id: documentId, schoolId: ctx.schoolId, deletedAt: null } });
  if (!doc) throw notFound("Document");
  await assertOwnerAccess(ctx, doc.applicationId ? { applicationId: doc.applicationId } : { studentId: doc.studentId ?? undefined }).catch(() => {
    throw notFound("Document");
  });
  return doc;
}

/** Returns the file for a permission-checked download and records WHO opened it. */
export async function downloadDocument(ctx: AuthContext, documentId: string) {
  requirePermission(ctx, "document.read");
  const doc = await loadAccessible(ctx, documentId);
  const storage = getStorage();
  if (!storage) throw invalid("File storage is not configured.");
  const bytes = await storage.get(doc.storageKey);
  await writeAudit(db, actorOf(ctx), {
    action: "document.download",
    entityType: "Document",
    entityId: doc.id,
    summary: `${doc.docType} ${doc.fileName}`,
    changes: { applicationId: doc.applicationId, studentId: doc.studentId },
  });
  return { bytes, mimeType: doc.mimeType, fileName: doc.fileName };
}

export async function deleteDocument(ctx: AuthContext, documentId: string, reason: unknown) {
  requirePermission(ctx, "document.delete");
  const why = parse(text(300), reason);
  const doc = await loadAccessible(ctx, documentId);
  await db.$transaction(async (tx) => {
    await tx.document.update({ where: { id: doc.id }, data: { deletedAt: new Date(), deletedById: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "document.delete", entityType: "Document", entityId: doc.id, summary: `${doc.docType} ${doc.fileName}`, reason: why });
  });
}
