import { z } from "zod";
import type { ApplicationStatus } from "@/generated/prisma/client";
import { db, type Db, type Tx } from "@/lib/db";
import { conflict, invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { docChecklist, docsComplete } from "@/lib/admissions/rules";
import { actorOf, writeAudit } from "@/server/audit";
import { getAdmissionPolicy } from "@/server/admission-policy";
import { optText, parse, text } from "@/lib/validation";

/*
 * Admissions Office review: verifying documents, confirming an application is in order or sending it back, and the recorded exception that lets
 * an application go on without complete papers. All of it is separate from the application's status (APPLIED, INTERVIEW, ...).
 */

const OPEN: readonly ApplicationStatus[] = ["APPLIED", "INTERVIEW", "ACCEPTED"];

/** The required documents of an application and where each one stands. `ok` is true when all are verified or an exception was recorded. */
export async function documentReadiness(client: Db | Tx, schoolId: string, app: { id: string; docsExceptionAt: Date | null }) {
  const policy = await getAdmissionPolicy(client, schoolId);
  const docs = await client.document.findMany({ where: { schoolId, applicationId: app.id, deletedAt: null }, select: { id: true, docType: true, verification: true } });
  const checklist = docChecklist(policy.requiredDocTypes, docs);
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
    await tx.application.update({ where: { id: applicationId }, data: { reviewStatus: d.decision, reviewNote: d.note ?? null, reviewedById: ctx.userId, reviewedAt: new Date() } });
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
