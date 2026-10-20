import { db } from "@/lib/db";
import { invalid, notFound } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import { getStorage } from "@/lib/storage";
import { actorOf, writeAudit } from "@/server/audit";
import { canActForStudent, currentPlacement } from "@/server/learning-access";
import { teachingRows, teaches } from "@/server/marks";
import { childIds } from "@/server/portal";

/*
 * One door for every learning-hub attachment. A file is returned only when the caller could see the record it belongs to; every
 * other case is NOT_FOUND so a guessed id reveals nothing. Staff downloads are audited.
 */

async function staffMayReadAssignment(ctx: AuthContext, a: { academicYearId: string; classId: string; streamId: string | null; subjectId: string }) {
  if (ctx.permissions.has("assignments.oversee")) return true;
  if (!ctx.permissions.has("assignments.manage")) return false;
  return teaches(await teachingRows(db, ctx, a.academicYearId), a);
}

async function portalStudentInAssignment(ctx: AuthContext, a: { classId: string; streamId: string | null; publishedAt: Date | null }) {
  if (!a.publishedAt) return false;
  for (const sid of await childIds(ctx)) {
    const p = await currentPlacement(db, ctx.schoolId, sid);
    if (p && p.classId === a.classId && (!a.streamId || a.streamId === p.streamId)) return true;
  }
  return false;
}

async function allowed(ctx: AuthContext, f: { ownerKind: string; ownerId: string }): Promise<boolean> {
  const staff = ctx.userType === "STAFF";
  if (f.ownerKind === "ASSIGNMENT") {
    const a = await db.assignment.findFirst({ where: { id: f.ownerId, schoolId: ctx.schoolId } });
    if (!a) return false;
    return staff ? staffMayReadAssignment(ctx, a) : portalStudentInAssignment(ctx, a);
  }
  if (f.ownerKind === "SUBMISSION") {
    const s = await db.assignmentSubmission.findFirst({ where: { id: f.ownerId, schoolId: ctx.schoolId } });
    if (!s) return false;
    if (!staff) return (await childIds(ctx)).includes(s.studentId);
    const a = await db.assignment.findFirst({ where: { id: s.assignmentId, schoolId: ctx.schoolId } });
    return !!a && staffMayReadAssignment(ctx, a);
  }
  if (f.ownerKind === "PORTFOLIO") {
    const item = await db.portfolioItem.findFirst({ where: { id: f.ownerId, schoolId: ctx.schoolId } });
    if (!item || item.status === "REMOVED") return false;
    if (staff) return ctx.permissions.has("portfolio.manage") && (await canActForStudent(ctx, item.studentId));
    if (!(await childIds(ctx)).includes(item.studentId)) return false;
    return item.status === "PUBLISHED" || (ctx.userType === "STUDENT" && item.createdByStudent);
  }
  return false;
}

export async function readLearningFile(ctx: AuthContext, id: string) {
  const f = await db.learningFile.findFirst({ where: { id, schoolId: ctx.schoolId, deletedAt: null } });
  if (!f || !(await allowed(ctx, f))) throw notFound("File");
  const storage = getStorage();
  if (!storage) throw invalid("File storage is not configured.");
  const bytes = await storage.get(f.storageKey);
  if (ctx.userType === "STAFF") await writeAudit(db, actorOf(ctx), { action: "learning_file.download", entityType: "LearningFile", entityId: f.id, summary: f.fileName, changes: { ownerKind: f.ownerKind, ownerId: f.ownerId } });
  return { bytes, mimeType: f.mimeType, fileName: f.fileName };
}

