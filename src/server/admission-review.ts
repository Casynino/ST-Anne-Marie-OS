import { z } from "zod";
import type { ApplicationStatus } from "@/generated/prisma/client";
import { db, type Db, type Tx } from "@/lib/db";
import { conflict, invalid, notFound } from "@/lib/errors";
import { requireAnyPermission, requirePermission, type AuthContext } from "@/lib/auth/context";
import { docChecklist, docsComplete } from "@/lib/admissions/rules";
import { actorOf, writeAudit } from "@/server/audit";
import { assessmentFor, getAdmissionPolicy, requiredDocsFor } from "@/server/admission-policy";
import { noticeFamily } from "@/server/application-notices";
import { closeTasks, openTask } from "@/server/workflow";
import { optText, parse, text } from "@/lib/validation";

/*
 * Admissions Office review: verifying documents, confirming an application is in order or sending it back, and the recorded exception that lets
 * an application go on without complete papers. All of it is separate from the application's status (APPLIED, INTERVIEW, ...).
 */

const OPEN: readonly ApplicationStatus[] = ["APPLIED", "INTERVIEW", "ACCEPTED"];

/** The required documents of an application and where each one stands. `ok` is true when all are verified or an exception was recorded. */
export async function documentReadiness(client: Db | Tx, schoolId: string, app: { id: string; docsExceptionAt: Date | null; entryType?: string | null }) {
  const policy = await getAdmissionPolicy(client, schoolId);
  const docs = await client.document.findMany({ where: { schoolId, applicationId: app.id, deletedAt: null }, select: { id: true, docType: true, verification: true } });
  const checklist = docChecklist(requiredDocsFor(policy, app.entryType), docs);
  const complete = docsComplete(checklist);
  return { checklist, complete, excepted: !complete && !!app.docsExceptionAt, ok: complete || !!app.docsExceptionAt };
}

const docSchema = z.object({ status: z.enum(["VERIFIED", "NEEDS_CORRECTION", "PENDING"]), note: optText(300) });

export async function verifyDocument(ctx: AuthContext, documentId: string, input: unknown) {
  requirePermission(ctx, "admission.documents.verify");
  const d = parse(docSchema, input);
  if (d.status === "NEEDS_CORRECTION" && !d.note) throw invalid("Say what must be corrected.", { note: "Required" });
  await db.$transaction(async (tx) => {
    const doc = await tx.document.findFirst({ where: { id: documentId, schoolId: ctx.schoolId, deletedAt: null, applicationId: { not: null } } });
    if (!doc) throw notFound("Document");
    const app = await tx.application.findFirst({ where: { id: doc.applicationId!, schoolId: ctx.schoolId } });
    if (!app) throw notFound("Application");
    if (!OPEN.includes(app.status)) throw conflict("This application is closed, so its documents can no longer be reviewed.");
    await tx.document.update({ where: { id: doc.id }, data: { verification: d.status, verifiedById: d.status === "PENDING" ? null : ctx.userId, verifiedAt: d.status === "PENDING" ? null : new Date(), verificationNote: d.note ?? null } });
    await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId: app.id, fromStatus: app.status, toStatus: app.status, kind: "DOCUMENT", reason: `${doc.docType}: ${d.status}${d.note ? ` - ${d.note}` : ""}`, byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "admission.document_review", entityType: "Document", entityId: doc.id, summary: `${doc.docType} · ${app.applicationNo}`, changes: { from: doc.verification, to: d.status }, reason: d.note });
  });
}

const reviewSchema = z.object({ decision: z.enum(["VERIFIED", "RETURNED"]), note: optText(500) });

/**
 * The Admissions Office confirms the application is in order (VERIFIED) or returns it to the applicant for correction or more information
 * (RETURNED, with a note saying what is needed). A returned application cannot be scheduled for interview or given an offer until it is verified.
 */
export async function reviewApplication(ctx: AuthContext, applicationId: string, input: unknown) {
  requirePermission(ctx, "admission.documents.verify");
  const d = parse(reviewSchema, input);
  if (d.decision === "RETURNED" && !d.note) throw invalid("Say what the applicant must correct or add.", { note: "Required" });
  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM applications WHERE id = ${applicationId}::uuid AND "schoolId" = ${ctx.schoolId}::uuid FOR UPDATE`;
    if (!rows.length) throw notFound("Application");
    const app = await tx.application.findUniqueOrThrow({ where: { id: applicationId } });
    if (!OPEN.includes(app.status)) throw conflict("This application is closed.");
    if (d.decision === "VERIFIED") {
      const r = await documentReadiness(tx, ctx.schoolId, app);
      if (!r.ok) throw conflict("Some required documents are missing or not yet verified. Verify them first, or record an exception.");
    }
    await tx.application.update({ where: { id: applicationId }, data: { reviewStatus: d.decision, reviewNote: d.note ?? null, reviewedById: ctx.userId, reviewedAt: new Date(), ...(app.assignedToId ? {} : { assignedToId: ctx.userId, assignedAt: new Date() }) } });
    // The family is told what is missing, once per request (saving the same request again does not announce it again).
    const repeat = app.reviewStatus === "RETURNED" && (app.reviewNote ?? "") === (d.note ?? "");
    if (d.decision === "RETURNED" && !repeat) await noticeFamily(tx, ctx, app, { kind: "INFO_NEEDED", key: `info:${applicationId}:${Date.now()}`, vars: { note: d.note } });
    if (d.decision === "VERIFIED") {
      await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Application", relatedId: applicationId, kinds: ["APPLICATION_REVIEW"], by: ctx.userId, note: "Application verified" });
      // Ready for assessment: the Academic Office arranges whatever assessment the school requires for this entry level.
      const policy = await getAdmissionPolicy(tx, ctx.schoolId);
      const need = assessmentFor(policy, app.classAppliedId ? (await tx.schoolClass.findFirst({ where: { id: app.classAppliedId, schoolId: ctx.schoolId }, select: { levelId: true } }))?.levelId ?? null : null);
      if ((need.interview || need.exam) && app.status === "APPLIED") await openTask(tx, { schoolId: ctx.schoolId, kind: "ASSESSMENT_COORDINATE", relatedType: "Application", relatedId: applicationId, relatedLabel: `${app.firstName} ${app.lastName} (${app.applicationNo})`, sourceEvent: "application.ready_for_assessment", createdById: ctx.userId });
    }
    await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: app.status, toStatus: app.status, kind: "REVIEW", reason: `${d.decision}${d.note ? ` - ${d.note}` : ""}`, byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: d.decision === "VERIFIED" ? "admission.review_verified" : "admission.review_returned", entityType: "Application", entityId: applicationId, summary: `${app.firstName} ${app.lastName} (${app.applicationNo})`, changes: { from: app.reviewStatus, to: d.decision }, reason: d.note });
  });
}

/** An authorised person lets the application continue although required documents are not all verified. Needs a reason; recorded and audited. */
export async function grantDocumentsException(ctx: AuthContext, applicationId: string, input: unknown) {
  requirePermission(ctx, "admission.override");
  const { reason } = parse(z.object({ reason: text(400) }), input);
  await db.$transaction(async (tx) => {
    const app = await tx.application.findFirst({ where: { id: applicationId, schoolId: ctx.schoolId } });
    if (!app) throw notFound("Application");
    if (!OPEN.includes(app.status)) throw conflict("This application is closed.");
    await tx.application.update({ where: { id: applicationId }, data: { docsExceptionAt: new Date(), docsExceptionById: ctx.userId, docsExceptionReason: reason } });
    await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: app.status, toStatus: app.status, kind: "EXCEPTION", reason: `Documents exception: ${reason}`, byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "admission.exception_documents", entityType: "Application", entityId: applicationId, summary: `${app.firstName} ${app.lastName} (${app.applicationNo})`, reason });
  });
}

/** What stops this application from moving to the interview or offer stage, in plain words. Empty when nothing does. */
export async function reviewBlockers(client: Db | Tx, schoolId: string, app: { id: string; reviewStatus: string; docsExceptionAt: Date | null }): Promise<string[]> {
  const out: string[] = [];
  if (app.reviewStatus === "RETURNED") out.push("The application was returned to the applicant for correction and has not been verified again.");
  const r = await documentReadiness(client, schoolId, app);
  if (!r.ok) out.push(`Required documents not verified: ${r.checklist.filter((x) => x.state !== "VERIFIED").map((x) => x.docType).join(", ")}.`);
  return out;
}

// ───────────────────────── Starting a review, and who looks after an application ─────────────────────────

/** An Admissions Office member starts checking an application. The application is also assigned to them when nobody has it yet. Starting does not decide anything. */
export async function startReview(ctx: AuthContext, applicationId: string): Promise<{ changed: boolean }> {
  requirePermission(ctx, "admission.documents.verify");
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM applications WHERE id = ${applicationId}::uuid AND "schoolId" = ${ctx.schoolId}::uuid FOR UPDATE`;
    if (!rows.length) throw notFound("Application");
    const app = await tx.application.findUniqueOrThrow({ where: { id: applicationId } });
    if (!OPEN.includes(app.status) || app.status === "ACCEPTED") throw conflict("This application is no longer under consideration.");
    if (app.reviewStatus === "IN_REVIEW" || app.reviewStatus === "VERIFIED") return { changed: false };
    const unassigned = !app.assignedToId;
    await tx.application.update({ where: { id: applicationId }, data: { reviewStatus: "IN_REVIEW", ...(unassigned ? { assignedToId: ctx.userId, assignedAt: new Date() } : {}) } });
    await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: app.status, toStatus: app.status, kind: "REVIEW", reason: app.reviewStatus === "RETURNED" ? "Review resumed after the family's reply" : "Review started", byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "admission.review_started", entityType: "Application", entityId: applicationId, summary: `${app.firstName} ${app.lastName} (${app.applicationNo})`, changes: { from: app.reviewStatus, to: "IN_REVIEW", assignedToSelf: unassigned } });
    return { changed: true };
  });
}

const reviewerWhere = (schoolId: string) => ({ schoolId, type: "STAFF" as const, status: "ACTIVE" as const, roles: { some: { role: { permissions: { some: { permission: { key: "admission.documents.verify" } } } } } } });

/** Staff who can look after applications: active staff allowed to review them. */
export async function listReviewers(ctx: AuthContext) {
  requireAnyPermission(ctx, ["admission.read"]);
  return db.user.findMany({ where: reviewerWhere(ctx.schoolId), orderBy: { fullName: "asc" }, select: { id: true, fullName: true } });
}

/** Gives an application to a reviewer (or takes it back with null). Only staff allowed to review can be chosen. */
export async function assignApplication(ctx: AuthContext, applicationId: string, assigneeId: string | null): Promise<{ changed: boolean }> {
  requirePermission(ctx, "admission.review");
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM applications WHERE id = ${applicationId}::uuid AND "schoolId" = ${ctx.schoolId}::uuid FOR UPDATE`;
    if (!rows.length) throw notFound("Application");
    const app = await tx.application.findUniqueOrThrow({ where: { id: applicationId } });
    if (!OPEN.includes(app.status)) throw conflict("This application is closed.");
    let name: string | null = null;
    if (assigneeId) {
      const u = await tx.user.findFirst({ where: { ...reviewerWhere(ctx.schoolId), id: assigneeId }, select: { fullName: true } });
      if (!u) throw invalid("Choose a member of the Admissions Office.", { assigneeId: "Choose a member of the Admissions Office" });
      name = u.fullName;
    }
    if ((app.assignedToId ?? null) === assigneeId) return { changed: false };
    await tx.application.update({ where: { id: applicationId }, data: { assignedToId: assigneeId, assignedAt: assigneeId ? new Date() : null } });
    await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: app.status, toStatus: app.status, kind: "ASSIGN", reason: name ? `Assigned to ${name}` : "Assignment removed", byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "admission.assign", entityType: "Application", entityId: applicationId, summary: `${app.firstName} ${app.lastName} (${app.applicationNo})`, changes: { from: app.assignedToId, to: assigneeId } });
    return { changed: true };
  });
}
