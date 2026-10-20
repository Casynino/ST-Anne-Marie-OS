import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { consumeRateLimit } from "@/lib/rate-limit";
import { actorOf, writeAudit } from "@/server/audit";
import { canActForStudent, notifyFamilies, personName, teachingStudentIds, schoolWide } from "@/server/learning-access";
import { removeLearningFile, storeLearningFile } from "@/server/learning-store";
import { childOrThrow } from "@/server/portal";
import { optText, optUuid, parse, text, uuid } from "@/lib/validation";

/*
 * Portfolio: a student's best work and moments (a project, a drawing, a certificate). Teachers add items that go live at once;
 * a student's own item waits as PENDING until a teacher publishes it. The family sees PUBLISHED items only. Removed items are
 * hidden, never deleted.
 */

const MAX_PENDING = 20;
const itemSchema = z.object({ title: text(120), description: optText(1500), subjectId: optUuid() });

async function checkSubject(schoolId: string, subjectId?: string) {
  if (subjectId && !(await db.subject.findFirst({ where: { id: subjectId, schoolId } }))) throw invalid("Please correct the highlighted fields.", { subjectId: "Choose a subject from the list" });
}

export async function addPortfolioItem(ctx: AuthContext, studentId: string, input: unknown) {
  requirePermission(ctx, "portfolio.manage");
  const d = parse(itemSchema.extend({ comment: optText(600) }), input);
  if (!(await canActForStudent(ctx, studentId))) throw notFound("Student");
  await checkSubject(ctx.schoolId, d.subjectId);
  const now = new Date();
  return db.$transaction(async (tx) => {
    const item = await tx.portfolioItem.create({ data: { schoolId: ctx.schoolId, studentId, subjectId: d.subjectId ?? null, title: d.title, description: d.description ?? null, teacherComment: d.comment ?? null, createdById: ctx.userId, createdByStudent: false, status: "PUBLISHED", publishedAt: now, publishedById: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "portfolio.add", entityType: "PortfolioItem", entityId: item.id, summary: d.title, changes: { studentId } });
    await notifyFamilies(tx, ctx.schoolId, [studentId], `New in the portfolio: ${d.title}`, d.description ?? "A teacher added work to the portfolio.", (sid) => `/family/${sid}/portfolio`);
    return item;
  });
}

async function myStudentId(ctx: AuthContext) {
  if (ctx.userType !== "STUDENT") throw forbidden("Only students can add their own work.");
  const s = await db.student.findFirst({ where: { userId: ctx.userId, schoolId: ctx.schoolId, status: "ENROLLED" }, select: { id: true } });
  if (!s) throw forbidden("Your student record is not active.");
  return s.id;
}

/** A student's own item: PENDING until a teacher publishes it. */
export async function addMyPortfolioItem(ctx: AuthContext, input: unknown) {
  const studentId = await myStudentId(ctx);
  const d = parse(itemSchema, input);
  await checkSubject(ctx.schoolId, d.subjectId);
  if (!(await consumeRateLimit(`portfolio:${ctx.userId}`, 20, 3_600_000))) throw new AppError("RATE_LIMITED", "You are adding items too quickly. Please wait a little and try again.");
  if ((await db.portfolioItem.count({ where: { schoolId: ctx.schoolId, studentId, status: "PENDING" } })) >= MAX_PENDING) throw conflict("You already have several items waiting for a teacher. Please wait for them to be reviewed.");
  return db.$transaction(async (tx) => {
    const item = await tx.portfolioItem.create({ data: { schoolId: ctx.schoolId, studentId, subjectId: d.subjectId ?? null, title: d.title, description: d.description ?? null, createdById: ctx.userId, createdByStudent: true, status: "PENDING" } });
    await writeAudit(tx, actorOf(ctx), { action: "portfolio.submit", entityType: "PortfolioItem", entityId: item.id, summary: d.title });
    return item;
  });
}

async function loadForStaff(ctx: AuthContext, id: string) {
  requirePermission(ctx, "portfolio.manage");
  const item = await db.portfolioItem.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!item || !(await canActForStudent(ctx, item.studentId))) throw notFound("Portfolio item");
  return item;
}

/** Publishes a student's pending item, or removes an item (with a note the student can read). */
export async function reviewPortfolioItem(ctx: AuthContext, id: string, input: unknown) {
  const item = await loadForStaff(ctx, id);
  const d = parse(z.object({ decision: z.enum(["PUBLISH", "REMOVE"]), comment: optText(600) }), input);
  if (item.status === "REMOVED") throw conflict("This item was removed.");
  if (d.decision === "PUBLISH" && item.status !== "PENDING") throw conflict("Only a waiting item can be published.");
  if (d.decision === "REMOVE" && !d.comment) throw invalid("Please correct the highlighted fields.", { comment: "Say why it is being removed" });
  await db.$transaction(async (tx) => {
    if (d.decision === "PUBLISH") {
      await tx.portfolioItem.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: new Date(), publishedById: ctx.userId, teacherComment: d.comment ?? item.teacherComment } });
      await notifyFamilies(tx, ctx.schoolId, [item.studentId], `New in the portfolio: ${item.title}`, d.comment ?? "A teacher approved this work.", (sid) => `/family/${sid}/portfolio`);
    } else {
      await tx.portfolioItem.update({ where: { id }, data: { status: "REMOVED", teacherComment: d.comment ?? null } });
    }
    await writeAudit(tx, actorOf(ctx), { action: d.decision === "PUBLISH" ? "portfolio.publish" : "portfolio.remove", entityType: "PortfolioItem", entityId: id, summary: item.title, reason: d.comment });
  });
}

export async function attachToPortfolio(ctx: AuthContext, itemId: string, file: { fileName: string; bytes: Buffer }) {
  const item = await db.portfolioItem.findFirst({ where: { id: itemId, schoolId: ctx.schoolId } });
  if (!item || item.status === "REMOVED") throw notFound("Portfolio item");
  if (ctx.userType === "STUDENT") {
    const sid = await myStudentId(ctx);
    if (item.studentId !== sid || !item.createdByStudent) throw notFound("Portfolio item");
    if (item.status !== "PENDING") throw conflict("This item has already been reviewed.");
  } else {
    await loadForStaff(ctx, itemId);
  }
  return storeLearningFile(ctx, { kind: "PORTFOLIO", id: itemId }, file);
}

export async function removePortfolioFile(ctx: AuthContext, fileId: string) {
  const f = await db.learningFile.findFirst({ where: { id: fileId, schoolId: ctx.schoolId, ownerKind: "PORTFOLIO", deletedAt: null } });
  if (!f) throw notFound("File");
  const item = await db.portfolioItem.findFirst({ where: { id: f.ownerId, schoolId: ctx.schoolId } });
  if (!item) throw notFound("File");
  if (ctx.userType === "STUDENT") {
    if (item.studentId !== (await myStudentId(ctx)) || item.status !== "PENDING") throw notFound("File");
  } else {
    await loadForStaff(ctx, item.id);
  }
  await removeLearningFile(ctx, fileId);
}

const view = async (schoolId: string, items: { id: string; title: string; description: string | null; subjectId: string | null; status: string; teacherComment: string | null; createdByStudent: boolean; publishedAt: Date | null; createdAt: Date }[]) => {
  const [files, subjects] = await Promise.all([
    db.learningFile.findMany({ where: { schoolId, ownerKind: "PORTFOLIO", ownerId: { in: items.map((i) => i.id) }, deletedAt: null }, select: { id: true, ownerId: true, fileName: true, mimeType: true, sizeBytes: true } }),
    db.subject.findMany({ where: { schoolId }, select: { id: true, name: true } }),
  ]);
  return items.map((i) => ({ ...i, subjectName: subjects.find((s) => s.id === i.subjectId)?.name ?? null, files: files.filter((f) => f.ownerId === i.id) }));
};

/** Staff view of one student's portfolio (pending items first). */
export async function studentPortfolio(ctx: AuthContext, studentId: string) {
  requirePermission(ctx, "portfolio.manage");
  if (!(await canActForStudent(ctx, studentId))) throw notFound("Student");
  const s = await db.student.findFirst({ where: { id: studentId, schoolId: ctx.schoolId }, select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true } });
  const items = await db.portfolioItem.findMany({ where: { schoolId: ctx.schoolId, studentId, status: { not: "REMOVED" } }, orderBy: [{ createdAt: "desc" }], take: 200 });
  const sorted = [...items.filter((i) => i.status === "PENDING"), ...items.filter((i) => i.status !== "PENDING")];
  return { student: { id: s!.id, name: personName(s!), admissionNo: s!.admissionNo }, items: await view(ctx.schoolId, sorted) };
}

/** Student-submitted items waiting for review, for the students this teacher teaches (everyone for school-wide readers). */
export async function pendingPortfolio(ctx: AuthContext) {
  requirePermission(ctx, "portfolio.manage");
  const ids = schoolWide(ctx) ? undefined : await teachingStudentIds(ctx);
  if (ids && !ids.length) return [];
  const items = await db.portfolioItem.findMany({ where: { schoolId: ctx.schoolId, status: "PENDING", ...(ids ? { studentId: { in: ids } } : {}) }, orderBy: { createdAt: "asc" }, take: 200 });
  const students = await db.student.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(items.map((i) => i.studentId))] } }, select: { id: true, firstName: true, middleName: true, lastName: true } });
  return items.map((i) => ({ id: i.id, studentId: i.studentId, studentName: personName(students.find((s) => s.id === i.studentId) ?? { firstName: "", middleName: null, lastName: "" }), title: i.title, createdAt: i.createdAt }));
}

/** Portal: parents see published items; the student also sees their own waiting items and a removal note. */
export async function childPortfolio(ctx: AuthContext, studentId: string) {
  await childOrThrow(ctx, studentId);
  const mine = ctx.userType === "STUDENT";
  const items = await db.portfolioItem.findMany({
    where: { schoolId: ctx.schoolId, studentId, ...(mine ? { OR: [{ status: "PUBLISHED" }, { status: "PENDING", createdByStudent: true }] } : { status: "PUBLISHED" }) },
    orderBy: [{ createdAt: "desc" }], take: 200,
  });
  return { canAdd: mine, items: await view(ctx.schoolId, items) };
}

