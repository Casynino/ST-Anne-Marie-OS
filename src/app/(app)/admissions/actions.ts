"use server";

import { run, str, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import { AppError } from "@/lib/errors";
import { db } from "@/lib/db";
import * as admissions from "@/server/admissions";
import * as documents from "@/server/documents";
import * as review from "@/server/admission-review";
import * as desk from "@/server/admission-desk";
import * as office from "@/server/office-application";
import type { IncomingFile } from "@/server/application-draft";
import * as interviews from "@/server/interviews";
import * as offers from "@/server/admission-offers";
import * as policy from "@/server/admission-policy";
import * as students from "@/server/students";
import { getCurrentAcademicContext } from "@/server/academics";

type Input = Record<string, string | string[] | undefined>;
const GUARDIAN_FIELDS = ["guardianId", "fullName", "phone", "altPhone", "email", "occupation", "relationship", "isFinanciallyResponsible", "allowSharedPhone"] as const;

function guardianFromForm(i: Input, prefix: string, primary = false) {
  const g: Record<string, string | undefined> = {};
  for (const f of GUARDIAN_FIELDS) g[f] = str(i[`${prefix}${f}`]) || undefined;
  g.receivesNotifications = str(i[`${prefix}receivesNotifications`]) === "on" ? "on" : "false";
  if (primary) g.isPrimary = "on";
  return g;
}
const hasGuardian = (i: Input, prefix: string) => Boolean(str(i[`${prefix}guardianId`]) || str(i[`${prefix}fullName`]) || str(i[`${prefix}phone`]));

function mapGuardianErrors(errors: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(errors)) {
    const g = /^guardians\.(\d+)\.(.+)$/.exec(k);
    if (g) out[`g${Number(g[1]) + 1}_${g[2]}`] = v;
    else if (k === "guardians") out.g1_fullName = v;
    else out[k] = v;
  }
  return out;
}

const DETAIL_FIELDS = ["submittedOn", "firstName", "middleName", "lastName", "dateOfBirth", "gender", "classAppliedId", "nationality", "religion", "birthCertificateNo", "previousSchool", "address", "assessmentNotes", "confirmDuplicate"] as const;
function details(i: Input) {
  const out: Record<string, string | string[] | undefined> = {};
  for (const f of DETAIL_FIELDS) out[f] = i[f];
  return out;
}

export async function createApplicationAction(_: ActionState, form: FormData) {
  return run(
    form,
    async (ctx, i) => {
      const { year } = await getCurrentAcademicContext(ctx.schoolId);
      const blocks = [1, 2].filter((n) => n === 1 || hasGuardian(i, `g${n}_`));
      const app = await admissions.createApplication(ctx, { ...details(i), intakeYearId: year?.id, guardians: blocks.map((n) => guardianFromForm(i, `g${n}_`, n === 1)) });
      return { redirectTo: `/admissions/${app.id}` };
    },
    { mapFieldErrors: mapGuardianErrors },
  );
}

export async function updateApplicationAction(_: ActionState, form: FormData) {
  return run(
    form,
    async (ctx, i) => {
      const id = str(i.id);
      const app = await db.application.findFirst({ where: { id, schoolId: ctx.schoolId }, select: { guardians: true } });
      // Typed-in guardians (not links to existing records) are editable; others are kept as they are.
      const stored = (app?.guardians as Record<string, unknown>[] | undefined) ?? [];
      const guardians = stored.map((g, idx) => (g.guardianId ? g : { ...g, ...guardianFromForm(i, `g${idx + 1}_`, idx === 0), guardianId: undefined }));
      await admissions.updateApplication(ctx, id, { ...details(i), guardians });
      return { redirectTo: `/admissions/${id}` };
    },
    { mapFieldErrors: mapGuardianErrors },
  );
}

export async function transitionApplicationAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await admissions.transitionApplication(ctx, str(i.id), { to: str(i.to), reason: i.reason, assessmentNotes: i.assessmentNotes });
    return { message: makeT(ctx.locale)("common.saved") };
  });
}

export async function enrolApplicationAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const [classId, streamId] = str(i.placement).split("|");
    const student = await admissions.enrolApplication(ctx, str(i.id), { classId: classId || undefined, streamId: streamId || undefined, admissionDate: i.admissionDate, confirmDuplicate: i.confirmDuplicate, confirmSharedPhone: i.confirmSharedPhone, overrideCapacity: i.overrideCapacity, overrideReason: i.overrideReason });
    return { redirectTo: `/students/${student.id}` };
  });
}

export async function uploadDocumentAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw (await import("@/lib/errors")).invalid("Choose a file to upload.", { file: "Required" });
    if (file.size > documents.MAX_DOCUMENT_BYTES) throw (await import("@/lib/errors")).invalid(`The file is too large. The limit is ${Math.floor(documents.MAX_DOCUMENT_BYTES / 1024 / 1024)} MB.`, { file: "File too large" });
    const owner = str(i.applicationId) ? { applicationId: str(i.applicationId) } : { studentId: str(i.studentId) };
    await documents.uploadDocument(ctx, owner, { docType: str(i.docType), fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
    return { message: makeT(ctx.locale)("common.saved") };
  });
}

export async function deleteDocumentAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await documents.deleteDocument(ctx, str(i.documentId), str(i.reason));
    return { message: makeT(ctx.locale)("common.saved") };
  });
}

// ───────────── Review, documents, exceptions ─────────────
const saved = (ctx: { locale: "EN" | "SW" }) => ({ message: makeT(ctx.locale)("common.saved") });

export async function reviewApplicationAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await review.reviewApplication(ctx, str(i.id), { decision: str(i.decision), note: i.note }); return saved(ctx); });
}
export async function verifyDocumentAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await review.verifyDocument(ctx, str(i.documentId), { status: str(i.status), note: i.note }); return saved(ctx); });
}
export async function grantDocsExceptionAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await review.grantDocumentsException(ctx, str(i.id), { reason: i.reason }); return saved(ctx); });
}

// ───────────── Interviews ─────────────
const INTERVIEW_FIELDS = ["kind", "scheduledAt", "durationMinutes", "location", "method", "interviewerId", "note", "confirmLocationClash", "allowSharedSlot", "exceptionReason", "reason"] as const;
const interviewInput = (i: Input) => Object.fromEntries(INTERVIEW_FIELDS.map((f) => [f, i[f]]));
export async function scheduleInterviewAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await interviews.scheduleInterview(ctx, str(i.id), interviewInput(i)); return saved(ctx); });
}
export async function rescheduleInterviewAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await interviews.rescheduleInterview(ctx, str(i.interviewId), interviewInput(i)); return saved(ctx); });
}
export async function cancelInterviewAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await interviews.cancelInterview(ctx, str(i.interviewId), { reason: i.reason }); return saved(ctx); });
}
export async function recordInterviewResultAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await interviews.recordInterviewResult(ctx, str(i.interviewId), { status: str(i.status), outcome: i.outcome, score: i.score, notes: i.notes, recommendation: i.recommendation, recommendationNote: i.recommendationNote }); return saved(ctx); });
}

// ───────────── An application filled in at the office (the same form as the online one) ─────────────
/** The child's photo and the papers that came with the form (empty file boxes are ignored). */
async function filesOf(form: FormData): Promise<IncomingFile[]> {
  const files: IncomingFile[] = [];
  for (const [key, value] of form.entries()) {
    if (!(value instanceof File) || value.size === 0) continue;
    if (key === "photo") files.push({ docType: "PASSPORT_PHOTO", fileName: value.name, bytes: Buffer.from(await value.arrayBuffer()) });
    else if (key.startsWith("paper_")) files.push({ docType: key.slice(6), fileName: value.name, bytes: Buffer.from(await value.arrayBuffer()) });
  }
  return files;
}
export async function createOfficeApplicationAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const r = await office.createOfficeApplication(ctx, i, await filesOf(form));
    return { redirectTo: r.applicationId ? `/admissions/${r.applicationId}` : `/admissions/drafts/${r.draftId}` };
  });
}
export async function updateOfficeDraftAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await office.updateOfficeDraft(ctx, str(i.id), i); return { redirectTo: `/admissions/drafts/${str(i.id)}` }; });
}
export async function cancelOfficeDraftAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await office.cancelOfficeDraft(ctx, str(i.id), { reason: i.reason }); return { redirectTo: "/admissions/drafts" }; });
}
export async function uploadOfficeDraftDocumentAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("VALIDATION", "Choose a file to upload.", { file: "Required" });
    await office.uploadOfficeDraftDocument(ctx, str(i.id), { docType: i.docType, fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
    return saved(ctx);
  });
}

// ───────────── The admissions desk: review, assignment, bulk, the other interview arrangements, quick accept ─────────────
export async function startReviewAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await review.startReview(ctx, str(i.id)); return saved(ctx); });
}
export async function assignApplicationAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await review.assignApplication(ctx, str(i.id), str(i.assigneeId) || null); return saved(ctx); });
}
/** Several applications at once. The result (what was done, what needed nothing, what could not be done and why) is returned for the table to show. */
export async function bulkDeskAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const ids = ([] as string[]).concat(i.ids ?? []);
    const r = await desk.bulkDesk(ctx, { action: str(i.action), ids, assigneeId: i.assigneeId });
    return { data: { action: r.action, done: String(r.done.length), unchanged: String(r.unchanged.length), failed: String(r.failed.length), problems: JSON.stringify([...r.failed, ...r.unchanged].map((x) => ({ no: x.applicationNo, reason: x.reason ?? "" }))) } };
  });
}
export async function confirmExistingInterviewAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const r = await interviews.confirmExistingInterview(ctx, str(i.id), interviewInput(i));
    return { message: makeT(ctx.locale)(r.unchanged ? "adm.arr.unchanged" : "common.saved") };
  });
}
export async function markInterviewNotRequiredAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await interviews.markInterviewNotRequired(ctx, str(i.id), { reason: i.reason }); return saved(ctx); });
}
export async function recordCompletedInterviewAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await interviews.recordCompletedInterview(ctx, str(i.id), { kind: i.kind, heldAt: i.heldAt, outcome: i.outcome, score: i.score, notes: i.notes, interviewerId: i.interviewerId, recommendation: i.recommendation }); return saved(ctx); });
}
export async function acceptApplicationAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const r = await offers.acceptApplication(ctx, str(i.id), { note: i.note, exceptionReason: i.exceptionReason });
    const t = makeT(ctx.locale);
    return { message: t(r.already ? "adm.accept.already" : r.status === "PENDING_APPROVAL" ? "adm.accept.pending" : "adm.accept.done") };
  });
}

// ───────────── Offers and exceptions ─────────────
export async function issueOfferAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await offers.issueOffer(ctx, str(i.id), { classOfferedId: i.classOfferedId, feeAmount: i.feeAmount, expiresOn: i.expiresOn, notes: i.notes, assessmentNotes: i.assessmentNotes, exceptionReason: i.exceptionReason }); return saved(ctx); });
}
export async function recordDecisionAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await admissions.recordAdmissionDecision(ctx, str(i.id), { outcome: i.outcome, note: i.note }); return saved(ctx); });
}
export async function approveOfferAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await offers.approveOffer(ctx, str(i.id)); return saved(ctx); });
}
export async function reviseOfferAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await offers.reviseOffer(ctx, str(i.id), { feeAmount: i.feeAmount, expiresOn: i.expiresOn, notes: i.notes, reason: i.reason }); return saved(ctx); });
}
export async function withdrawOfferAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await offers.withdrawOffer(ctx, str(i.id), { reason: i.reason }); return saved(ctx); });
}
export async function declineOfferAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await offers.declineOffer(ctx, str(i.id), { reason: i.reason }); return saved(ctx); });
}
export async function waivePaymentAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await offers.waiveAdmissionPayment(ctx, str(i.id), { reason: i.reason }); return saved(ctx); });
}

// ───────────── Class placement and policy ─────────────
export async function placeStudentAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const [classId, streamId] = str(i.placement).split("|");
    await students.enrollStudent(ctx, str(i.studentId), { classId: classId || undefined, streamId: streamId || undefined, overrideCapacity: i.overrideCapacity, overrideReason: i.overrideReason });
    return saved(ctx);
  });
}
export async function updatePolicyAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await policy.updateAdmissionPolicy(ctx, { ...i, requiredDocTypes: form.getAll("requiredDocTypes").map(String), transferDocTypes: form.getAll("transferDocTypes").map(String) }); return saved(ctx); });
}
