import { createHash, randomUUID } from "node:crypto";
import type { LearningFileOwner } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { conflict, invalid } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import { getStorage } from "@/lib/storage";
import { MAX_DOCUMENT_BYTES, safeFileName, sniffType } from "@/server/documents";
import { actorOf, writeAudit } from "@/server/audit";

export const MAX_FILES_PER_OWNER = 5;

/**
 * Stores one attachment (PDF, JPEG, PNG or WebP) for a learning-hub record. The caller has already checked that this user may
 * attach to that record. The type is decided from the file's bytes, the size is capped and the key is unguessable; the file is
 * served only through /api/learning/files/[id], which checks access again.
 */
export function checkLearningFile(bytes: Buffer) {
  if (bytes.length === 0) throw invalid("The file is empty.", { file: "The file is empty" });
  if (bytes.length > MAX_DOCUMENT_BYTES) throw invalid(`The file is too large. The limit is ${Math.floor(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB.`, { file: "File too large" });
  const type = sniffType(bytes);
  if (!type) throw invalid("Only PDF, JPEG, PNG or WebP files are accepted.", { file: "Unsupported file type" });
  if (!getStorage()) throw invalid("File storage is not configured, so files cannot be attached yet. You can still write your answer as text.", { file: "File storage is not configured" });
  return type;
}

export async function storeLearningFile(ctx: AuthContext, owner: { kind: LearningFileOwner; id: string }, input: { fileName: string; bytes: Buffer }) {
  const { bytes } = input;
  const type = checkLearningFile(bytes);
  const storage = getStorage()!;
  if ((await db.learningFile.count({ where: { schoolId: ctx.schoolId, ownerKind: owner.kind, ownerId: owner.id, deletedAt: null } })) >= MAX_FILES_PER_OWNER) throw conflict(`At most ${MAX_FILES_PER_OWNER} files can be attached here.`);
  const storageKey = `${ctx.schoolId}/learning/${new Date().getUTCFullYear()}/${randomUUID()}.${type.ext}`;
  await storage.put(storageKey, bytes, { contentType: type.mime });
  try {
    return await db.$transaction(async (tx) => {
      const f = await tx.learningFile.create({ data: { schoolId: ctx.schoolId, ownerKind: owner.kind, ownerId: owner.id, fileName: safeFileName(input.fileName), mimeType: type.mime, sizeBytes: bytes.length, storageKey, uploadedById: ctx.userId } });
      await writeAudit(tx, actorOf(ctx), { action: "learning_file.upload", entityType: "LearningFile", entityId: f.id, summary: f.fileName, changes: { owner, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } });
      return f;
    });
  } catch (e) {
    await storage.delete(storageKey).catch(() => undefined);
    throw e;
  }
}

export const listLearningFiles = (schoolId: string, kind: LearningFileOwner, ownerId: string) =>
  db.learningFile.findMany({ where: { schoolId, ownerKind: kind, ownerId, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, fileName: true, mimeType: true, sizeBytes: true } });

export async function removeLearningFile(ctx: AuthContext, id: string) {
  await db.$transaction(async (tx) => {
    const f = await tx.learningFile.findFirst({ where: { id, schoolId: ctx.schoolId, deletedAt: null } });
    if (!f) return;
    await tx.learningFile.update({ where: { id }, data: { deletedAt: new Date() } }); // the object stays in storage for the record
    await writeAudit(tx, actorOf(ctx), { action: "learning_file.remove", entityType: "LearningFile", entityId: id, summary: f.fileName });
  });
}
