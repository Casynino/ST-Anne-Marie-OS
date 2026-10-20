import { z } from "zod";
import { db } from "@/lib/db";
import { conflict, invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { IMAGE_MIME, imageSize, sniffImage } from "@/lib/images";
import { actorOf, writeAudit } from "@/server/audit";
import { parse, text } from "@/lib/validation";

export const MAX_MEDIA_BYTES = 2 * 1024 * 1024;
const MIN_SIDE = 200;
const MAX_SIDE = 8000;

const metaSchema = z.object({ alt: text(160) });

/**
 * Stores an image for the public website. The format and size come from the bytes, never from the file name or
 * the browser-supplied type; alt text is required so every image is accessible.
 */
export async function uploadMedia(ctx: AuthContext, file: { name: string; bytes: Uint8Array }, input: unknown) {
  requirePermission(ctx, "website.manage");
  const { alt } = parse(metaSchema, input);
  if (file.bytes.length === 0) throw invalid("Choose an image to upload.", { file: "Required" });
  if (file.bytes.length > MAX_MEDIA_BYTES) throw invalid("That image is too large. Please keep it under 2 MB (resize or compress it first).", { file: "Maximum 2 MB" });
  const kind = sniffImage(file.bytes);
  if (!kind) throw invalid("Only JPEG, PNG or WebP images are accepted.", { file: "Unsupported file type" });
  const size = imageSize(file.bytes, kind);
  if (!size || size.width < MIN_SIDE || size.height < MIN_SIDE) throw invalid(`The image is too small (at least ${MIN_SIDE}px on each side).`, { file: "Image too small" });
  if (size.width > MAX_SIDE || size.height > MAX_SIDE) throw invalid("The image dimensions are too large.", { file: "Image too large" });

  const fileName = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120) || "image";
  return db.$transaction(async (tx) => {
    const row = await tx.mediaAsset.create({
      data: { schoolId: ctx.schoolId, fileName, mimeType: IMAGE_MIME[kind], sizeBytes: file.bytes.length, width: size.width, height: size.height, alt, bytes: Buffer.from(file.bytes), createdById: ctx.userId },
      select: { id: true, fileName: true, width: true, height: true, alt: true },
    });
    await writeAudit(tx, actorOf(ctx), { action: "media.upload", entityType: "MediaAsset", entityId: row.id, summary: fileName, changes: { bytes: file.bytes.length, width: size.width, height: size.height } });
    return row;
  });
}

export async function listMedia(ctx: AuthContext) {
  requirePermission(ctx, "website.manage");
  return db.mediaAsset.findMany({ where: { schoolId: ctx.schoolId }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, fileName: true, alt: true, width: true, height: true, sizeBytes: true, createdAt: true } });
}

/** Where an uploaded image is currently used (so it cannot be deleted from under a live page). */
async function usageOf(schoolId: string, id: string): Promise<string[]> {
  const ref = `/media/${id}`;
  const [settings, news, events] = await Promise.all([
    db.schoolSetting.findFirst({ where: { schoolId, key: "website" } }),
    db.announcement.count({ where: { schoolId, coverImage: ref } }),
    db.schoolEvent.count({ where: { schoolId, coverImage: ref } }),
  ]);
  const used: string[] = [];
  if (settings && JSON.stringify(settings.value).includes(ref)) used.push("website settings");
  if (news) used.push("news");
  if (events) used.push("events");
  return used;
}

export async function deleteMedia(ctx: AuthContext, id: string) {
  requirePermission(ctx, "website.manage");
  const row = await db.mediaAsset.findFirst({ where: { id, schoolId: ctx.schoolId }, select: { id: true, fileName: true } });
  if (!row) throw notFound("Image");
  const used = await usageOf(ctx.schoolId, id);
  if (used.length) throw conflict(`This image is still used in: ${used.join(", ")}. Replace it there first.`);
  await db.$transaction(async (tx) => {
    await tx.mediaAsset.delete({ where: { id } });
    await writeAudit(tx, actorOf(ctx), { action: "media.delete", entityType: "MediaAsset", entityId: id, summary: row.fileName });
  });
}

/** Public read used by /media/<id>. Every asset in this table is intended to be public. */
export async function getMediaBytes(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return db.mediaAsset.findUnique({ where: { id }, select: { bytes: true, mimeType: true, sizeBytes: true, createdAt: true } });
}

export async function mediaDimensions(ids: string[]) {
  const rows = ids.length ? await db.mediaAsset.findMany({ where: { id: { in: ids } }, select: { id: true, width: true, height: true, alt: true } }) : [];
  return new Map(rows.map((r) => [r.id, r]));
}
