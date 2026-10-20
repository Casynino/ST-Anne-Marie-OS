import { z } from "zod";
import type { PlanStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { requireAnyPermission, requirePermission, type AuthContext } from "@/lib/auth/context";
import { actorOf, writeAudit } from "@/server/audit";
import { currentYearId, requireTeachesClassSubject, requireTeachesUnit } from "@/server/learning-access";
import { teachingRows } from "@/server/marks";
import { dateOnly, optText, optUuid, parse, text, uuid } from "@/lib/validation";

/*
 * Schemes of work and lesson plans. A teacher writes them only for classes and subjects they teach; they move
 * DRAFT -> SUBMITTED -> APPROVED, or are RETURNED with a note for changes. Only the author edits, and only while DRAFT or
 * RETURNED. Reviewers (plans.review) read what has been submitted; nobody else sees another teacher's draft.
 */

const EDITABLE: PlanStatus[] = ["DRAFT", "RETURNED"];
const long = (max = 2000) => z.string().trim().min(1, "Required").max(max, `Maximum ${max} characters`);

export async function ownerStaff(ctx: AuthContext) {
  if (ctx.userType !== "STAFF" || !ctx.staffId) throw forbidden("Only staff members can write plans.");
  return ctx.staffId;
}

// ───────────────────────── Schemes of work ─────────────────────────

const weekSchema = z.object({ weekNo: z.number().int().min(1).max(60), topic: text(160), objectives: optText(1500), activities: optText(1500), resources: optText(800), assessment: optText(800), periods: z.number().int().min(1).max(40).optional() });
const schemeSchema = z.object({ classId: uuid(), subjectId: uuid(), termId: optUuid(), title: text(160), weeks: z.array(weekSchema).max(60).default([]) });

function checkWeeks(weeks: { weekNo: number }[]) {
  const seen = new Set<number>();
  for (const w of weeks) { if (seen.has(w.weekNo)) throw invalid("Please correct the highlighted fields.", { weeks: `Week ${w.weekNo} is listed twice` }); seen.add(w.weekNo); }
}

export async function createScheme(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "plans.write");
  const staffId = await ownerStaff(ctx);
  const d = parse(schemeSchema, input);
  checkWeeks(d.weeks);
  const yearId = await currentYearId(db, ctx.schoolId);
  if (!yearId) throw invalid("There is no current academic year.");
  await requireTeachesClassSubject(ctx, yearId, { classId: d.classId, subjectId: d.subjectId });
  if (!(await db.classSubject.findFirst({ where: { classId: d.classId, subjectId: d.subjectId, schoolId: ctx.schoolId } }))) throw invalid("Please correct the highlighted fields.", { subjectId: "This subject is not taught in the class" });
  if (d.termId && !(await db.term.findFirst({ where: { id: d.termId, schoolId: ctx.schoolId, academicYearId: yearId } }))) throw invalid("Please correct the highlighted fields.", { termId: "Choose a term of the current year" });
  return db.$transaction(async (tx) => {
    const s = await tx.schemeOfWork.create({ data: { schoolId: ctx.schoolId, academicYearId: yearId, termId: d.termId ?? null, classId: d.classId, subjectId: d.subjectId, teacherStaffId: staffId, title: d.title, weeks: { create: d.weeks.map((w) => ({ ...w, objectives: w.objectives ?? null, activities: w.activities ?? null, resources: w.resources ?? null, assessment: w.assessment ?? null, periods: w.periods ?? null })) } } });
    await writeAudit(tx, actorOf(ctx), { action: "scheme.create", entityType: "SchemeOfWork", entityId: s.id, summary: d.title });
    return s;
  });
}

async function ownScheme(ctx: AuthContext, id: string) {
  requirePermission(ctx, "plans.write");
  const staffId = await ownerStaff(ctx);
  const s = await db.schemeOfWork.findFirst({ where: { id, schoolId: ctx.schoolId, teacherStaffId: staffId } });
  if (!s) throw notFound("Scheme of work");
  return s;
}

/** Replaces the title and all weeks. Only while DRAFT or RETURNED. */
export async function updateScheme(ctx: AuthContext, id: string, input: unknown) {
  const s = await ownScheme(ctx, id);
  if (!EDITABLE.includes(s.status)) throw conflict("This scheme has been submitted. Ask the reviewer to return it before changing it.");
  const d = parse(schemeSchema.pick({ title: true, termId: true, weeks: true }), input);
  checkWeeks(d.weeks);
  await db.$transaction(async (tx) => {
    await tx.schemeWeek.deleteMany({ where: { schemeId: id } });
    await tx.schemeWeek.createMany({ data: d.weeks.map((w) => ({ schemeId: id, ...w, objectives: w.objectives ?? null, activities: w.activities ?? null, resources: w.resources ?? null, assessment: w.assessment ?? null, periods: w.periods ?? null })) });
    await tx.schemeOfWork.update({ where: { id }, data: { title: d.title, termId: d.termId ?? null } });
    await writeAudit(tx, actorOf(ctx), { action: "scheme.update", entityType: "SchemeOfWork", entityId: id, summary: d.title, changes: { weeks: d.weeks.length } });
  });
}

export async function submitScheme(ctx: AuthContext, id: string) {
  const s = await ownScheme(ctx, id);
  if (!EDITABLE.includes(s.status)) throw conflict("Already submitted.");
  if (!(await db.schemeWeek.count({ where: { schemeId: id } }))) throw invalid("Add at least one week before submitting.");
  await db.$transaction(async (tx) => {
    await tx.schemeOfWork.update({ where: { id }, data: { status: "SUBMITTED", submittedAt: new Date(), reviewNote: null } });
    await writeAudit(tx, actorOf(ctx), { action: "scheme.submit", entityType: "SchemeOfWork", entityId: id, summary: s.title });
  });
}

const reviewSchema = z.object({ decision: z.enum(["APPROVE", "RETURN"]), note: optText(600) });

function checkReview(d: { decision: string; note?: string }) {
  if (d.decision === "RETURN" && !d.note) throw invalid("Please correct the highlighted fields.", { note: "Say what needs to change" });
}

export async function reviewScheme(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "plans.review");
  const d = parse(reviewSchema, input);
  checkReview(d);
  const s = await db.schemeOfWork.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!s) throw notFound("Scheme of work");
  if (s.status !== "SUBMITTED") throw conflict("Only a submitted scheme can be reviewed.");
  if (ctx.staffId && s.teacherStaffId === ctx.staffId) throw forbidden("You cannot review your own scheme.");
  await db.$transaction(async (tx) => {
    await tx.schemeOfWork.update({ where: { id }, data: { status: d.decision === "APPROVE" ? "APPROVED" : "RETURNED", reviewNote: d.note ?? null, reviewedById: ctx.userId, reviewedAt: new Date() } });
    await writeAudit(tx, actorOf(ctx), { action: d.decision === "APPROVE" ? "scheme.approve" : "scheme.return", entityType: "SchemeOfWork", entityId: id, summary: s.title, reason: d.note });
  });
}

export async function listSchemes(ctx: AuthContext, f: { box?: "mine" | "review"; status?: string } = {}) {
  requireAnyPermission(ctx, ["plans.write", "plans.review"]);
  const reviewer = ctx.permissions.has("plans.review");
  const box = f.box === "review" && reviewer ? "review" : "mine";
  const staffId = ctx.staffId;
  const rows = await db.schemeOfWork.findMany({
    where: { schoolId: ctx.schoolId, ...(box === "mine" ? { teacherStaffId: staffId ?? "00000000-0000-0000-0000-000000000000" } : { status: { in: ["SUBMITTED", "APPROVED", "RETURNED"] as PlanStatus[] } }), ...(f.status ? { status: f.status as PlanStatus } : {}) },
    orderBy: { updatedAt: "desc" }, take: 200, include: { _count: { select: { weeks: true } } },
  });
  return decorate(ctx.schoolId, rows);
}

async function decorate<T extends { classId: string; subjectId: string; teacherStaffId: string }>(schoolId: string, rows: T[]) {
  const [classes, subjects, staff] = await Promise.all([
    db.schoolClass.findMany({ where: { schoolId, id: { in: [...new Set(rows.map((r) => r.classId))] } }, select: { id: true, name: true } }),
    db.subject.findMany({ where: { schoolId, id: { in: [...new Set(rows.map((r) => r.subjectId))] } }, select: { id: true, name: true } }),
    db.staff.findMany({ where: { schoolId, id: { in: [...new Set(rows.map((r) => r.teacherStaffId))] } }, select: { id: true, user: { select: { fullName: true } } } }),
  ]);
  return rows.map((r) => ({ ...r, className: classes.find((c) => c.id === r.classId)?.name ?? "", subjectName: subjects.find((s) => s.id === r.subjectId)?.name ?? "", teacherName: staff.find((s) => s.id === r.teacherStaffId)?.user.fullName ?? "" }));
}

export async function getScheme(ctx: AuthContext, id: string) {
  requireAnyPermission(ctx, ["plans.write", "plans.review"]);
  const s = await db.schemeOfWork.findFirst({ where: { id, schoolId: ctx.schoolId }, include: { weeks: { orderBy: { weekNo: "asc" } } } });
  if (!s) throw notFound("Scheme of work");
  const own = !!ctx.staffId && s.teacherStaffId === ctx.staffId;
  if (!own && !(ctx.permissions.has("plans.review") && s.status !== "DRAFT")) throw notFound("Scheme of work"); // another teacher's draft is invisible
  const [d] = await decorate(ctx.schoolId, [s]);
  return { ...d!, own, canReview: ctx.permissions.has("plans.review") && !own && s.status === "SUBMITTED", editable: own && EDITABLE.includes(s.status) };
}

// ───────────────────────── Lesson plans ─────────────────────────

const lessonSchema = z.object({ classId: uuid(), streamId: optUuid(), subjectId: uuid(), lessonDate: dateOnly(), topic: text(160), objectives: long(1500), activities: long(3000), resources: optText(800), assessment: optText(800), homework: optText(800) });

export async function createLessonPlan(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "plans.write");
  const staffId = await ownerStaff(ctx);
  const d = parse(lessonSchema, input);
  const yearId = await currentYearId(db, ctx.schoolId);
  if (!yearId) throw invalid("There is no current academic year.");
  await requireTeachesUnit(ctx, yearId, { classId: d.classId, streamId: d.streamId ?? null, subjectId: d.subjectId });
  if (!(await db.classSubject.findFirst({ where: { classId: d.classId, subjectId: d.subjectId, schoolId: ctx.schoolId } }))) throw invalid("Please correct the highlighted fields.", { subjectId: "This subject is not taught in the class" });
  if (d.streamId && !(await db.stream.findFirst({ where: { id: d.streamId, classId: d.classId, schoolId: ctx.schoolId } }))) throw invalid("Please correct the highlighted fields.", { streamId: "That stream does not belong to the class" });
  return db.$transaction(async (tx) => {
    const p = await tx.lessonPlan.create({ data: { schoolId: ctx.schoolId, academicYearId: yearId, classId: d.classId, streamId: d.streamId ?? null, subjectId: d.subjectId, teacherStaffId: staffId, lessonDate: d.lessonDate, topic: d.topic, objectives: d.objectives, activities: d.activities, resources: d.resources ?? null, assessment: d.assessment ?? null, homework: d.homework ?? null } });
    await writeAudit(tx, actorOf(ctx), { action: "lesson_plan.create", entityType: "LessonPlan", entityId: p.id, summary: d.topic });
    return p;
  });
}

async function ownPlan(ctx: AuthContext, id: string) {
  requirePermission(ctx, "plans.write");
  const staffId = await ownerStaff(ctx);
  const p = await db.lessonPlan.findFirst({ where: { id, schoolId: ctx.schoolId, teacherStaffId: staffId } });
  if (!p) throw notFound("Lesson plan");
  return p;
}

export async function updateLessonPlan(ctx: AuthContext, id: string, input: unknown) {
  const p = await ownPlan(ctx, id);
  if (!EDITABLE.includes(p.status)) throw conflict("This plan has been submitted. Ask the reviewer to return it before changing it.");
  const d = parse(lessonSchema.pick({ lessonDate: true, topic: true, objectives: true, activities: true, resources: true, assessment: true, homework: true }), input);
  await db.$transaction(async (tx) => {
    await tx.lessonPlan.update({ where: { id }, data: { lessonDate: d.lessonDate, topic: d.topic, objectives: d.objectives, activities: d.activities, resources: d.resources ?? null, assessment: d.assessment ?? null, homework: d.homework ?? null } });
    await writeAudit(tx, actorOf(ctx), { action: "lesson_plan.update", entityType: "LessonPlan", entityId: id, summary: d.topic });
  });
}

export async function submitLessonPlan(ctx: AuthContext, id: string) {
  const p = await ownPlan(ctx, id);
  if (!EDITABLE.includes(p.status)) throw conflict("Already submitted.");
  await db.$transaction(async (tx) => {
    await tx.lessonPlan.update({ where: { id }, data: { status: "SUBMITTED", submittedAt: new Date(), reviewNote: null } });
    await writeAudit(tx, actorOf(ctx), { action: "lesson_plan.submit", entityType: "LessonPlan", entityId: id, summary: p.topic });
  });
}

/** The teacher's reflection after teaching the lesson: allowed at any stage, never changes the approved plan itself. */
export async function addReflection(ctx: AuthContext, id: string, input: unknown) {
  const p = await ownPlan(ctx, id);
  const { reflection } = parse(z.object({ reflection: long(2000) }), input);
  await db.$transaction(async (tx) => {
    await tx.lessonPlan.update({ where: { id }, data: { reflection } });
    await writeAudit(tx, actorOf(ctx), { action: "lesson_plan.reflect", entityType: "LessonPlan", entityId: id, summary: p.topic });
  });
}

export async function reviewLessonPlan(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "plans.review");
  const d = parse(reviewSchema, input);
  checkReview(d);
  const p = await db.lessonPlan.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!p) throw notFound("Lesson plan");
  if (p.status !== "SUBMITTED") throw conflict("Only a submitted plan can be reviewed.");
  if (ctx.staffId && p.teacherStaffId === ctx.staffId) throw forbidden("You cannot review your own plan.");
  await db.$transaction(async (tx) => {
    await tx.lessonPlan.update({ where: { id }, data: { status: d.decision === "APPROVE" ? "APPROVED" : "RETURNED", reviewNote: d.note ?? null, reviewedById: ctx.userId, reviewedAt: new Date() } });
    await writeAudit(tx, actorOf(ctx), { action: d.decision === "APPROVE" ? "lesson_plan.approve" : "lesson_plan.return", entityType: "LessonPlan", entityId: id, summary: p.topic, reason: d.note });
  });
}

export async function listLessonPlans(ctx: AuthContext, f: { box?: "mine" | "review"; status?: string; from?: Date; to?: Date } = {}) {
  requireAnyPermission(ctx, ["plans.write", "plans.review"]);
  const box = f.box === "review" && ctx.permissions.has("plans.review") ? "review" : "mine";
  const rows = await db.lessonPlan.findMany({
    where: { schoolId: ctx.schoolId, ...(box === "mine" ? { teacherStaffId: ctx.staffId ?? "00000000-0000-0000-0000-000000000000" } : { status: { in: ["SUBMITTED", "APPROVED", "RETURNED"] as PlanStatus[] } }), ...(f.status ? { status: f.status as PlanStatus } : {}), ...(f.from || f.to ? { lessonDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}) },
    orderBy: [{ lessonDate: "desc" }, { createdAt: "desc" }], take: 200,
  });
  return decorate(ctx.schoolId, rows);
}

export async function getLessonPlan(ctx: AuthContext, id: string) {
  requireAnyPermission(ctx, ["plans.write", "plans.review"]);
  const p = await db.lessonPlan.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!p) throw notFound("Lesson plan");
  const own = !!ctx.staffId && p.teacherStaffId === ctx.staffId;
  if (!own && !(ctx.permissions.has("plans.review") && p.status !== "DRAFT")) throw notFound("Lesson plan");
  const [d] = await decorate(ctx.schoolId, [p]);
  return { ...d!, own, canReview: ctx.permissions.has("plans.review") && !own && p.status === "SUBMITTED", editable: own && EDITABLE.includes(p.status) };
}

/**
 * What a teacher may plan or set homework for: each class + subject they teach in the current year, with the streams they may
 * use and whether they may address the whole class (only a class-wide assignment allows that).
 */
export async function myTeachingUnits(ctx: AuthContext) {
  requireAnyPermission(ctx, ["plans.write", "assignments.manage"]);
  const yearId = await currentYearId(db, ctx.schoolId);
  if (!yearId || !ctx.staffId) return [];
  const rows = await teachingRows(db, ctx, yearId);
  const classIds = [...new Set(rows.map((r) => r.classId))];
  const [classes, classSubjects, subjects, streams] = await Promise.all([
    db.schoolClass.findMany({ where: { schoolId: ctx.schoolId, id: { in: classIds } }, select: { id: true, name: true } }),
    db.classSubject.findMany({ where: { schoolId: ctx.schoolId, classId: { in: classIds } }, select: { classId: true, subjectId: true } }),
    db.subject.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true } }),
    db.stream.findMany({ where: { schoolId: ctx.schoolId, classId: { in: classIds } }, select: { id: true, name: true, classId: true }, orderBy: { name: "asc" } }),
  ]);
  const out: { classId: string; className: string; subjectId: string; subjectName: string; wholeClass: boolean; streams: { id: string; name: string }[] }[] = [];
  for (const c of classes) {
    for (const cs of classSubjects.filter((x) => x.classId === c.id)) {
      const mine = rows.filter((r) => r.classId === c.id && (r.subjectId === null || r.subjectId === cs.subjectId));
      if (!mine.length) continue;
      const wholeClass = mine.some((r) => r.streamId === null);
      const usable = streams.filter((s) => s.classId === c.id && (wholeClass || mine.some((r) => r.streamId === s.id)));
      out.push({ classId: c.id, className: c.name, subjectId: cs.subjectId, subjectName: subjects.find((s) => s.id === cs.subjectId)?.name ?? "", wholeClass, streams: usable.map((s) => ({ id: s.id, name: s.name })) });
    }
  }
  return out.sort((a, b) => a.className.localeCompare(b.className) || a.subjectName.localeCompare(b.subjectName));
}
