import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { requireAnyPermission, requirePermission, type AuthContext } from "@/lib/auth/context";
import { centsOf } from "@/lib/finance/money";
import { acceptedDesk, deskRow, type DeskRow } from "@/server/admission-desk";
import { enrolmentReadiness, loadAdmissionAccount, type ReadinessItem } from "@/server/admission-offers";
import { examSummaryOf, eligibleTeachers, type ExamSummary } from "@/server/admission-exams";
import { getAdmissionPolicy } from "@/server/admission-policy";
import { paymentSetup } from "@/server/application-fee";
import type { AccountStatus } from "@/lib/admissions/rules";

/*
 * What each stage of the admission journey shows. Everything is read from the real records (offer, payments, interviews, examinations, the
 * enrolment checks), never from a copy, so a list and the screen it opens always agree.
 */

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

// ───────────────────────── Accepted applicants: awaiting payment, registration pending ─────────────────────────

export type AcceptedRow = {
  id: string; applicationNo: string; name: string; className: string | null; decidedAt: Date | null; letterNo: string | null; after: "payment" | "registration";
  feeCents: number; verifiedCents: number; pendingCents: number; balanceCents: number; accountStatus: AccountStatus | null;
  items: ReadinessItem[]; remaining: string[]; percent: number; docsVerified: number; docsRequired: number;
};

async function toAccepted(ctx: AuthContext, r: DeskRow): Promise<AcceptedRow> {
  const app = await db.application.findFirstOrThrow({ where: { id: r.id, schoolId: ctx.schoolId }, select: { id: true, status: true, reviewStatus: true, docsExceptionAt: true, entryType: true } });
  const [{ offer, account }, gate] = await Promise.all([loadAdmissionAccount(db, ctx.schoolId, r.id), enrolmentReadiness(db, ctx.schoolId, app)]);
  return {
    id: r.id, applicationNo: r.applicationNo, name: r.name, className: r.className, decidedAt: r.decidedAt, letterNo: offer?.letterNo ?? null, after: r.after ?? "registration",
    feeCents: account?.requiredCents ?? (offer ? centsOf(offer.feeAmount) : 0), verifiedCents: account?.verifiedCents ?? 0, pendingCents: account?.pendingCents ?? 0, balanceCents: account?.balanceCents ?? 0, accountStatus: account?.status ?? null,
    items: gate.items, remaining: gate.items.filter((i) => !i.ok).map((i) => i.message), percent: r.completeness.percent, docsVerified: r.completeness.checked, docsRequired: r.completeness.required,
  };
}

/** Accepted applicants waiting for the school fee (`payment`) or for registration (`registration`). Each is in exactly one of the two. */
export async function acceptedList(ctx: AuthContext, which: "payment" | "registration"): Promise<AcceptedRow[]> {
  const rows = (await acceptedDesk(ctx)).filter((r) => r.after === which);
  return Promise.all(rows.map((r) => toAccepted(ctx, r)));
}

export async function acceptedCounts(ctx: AuthContext): Promise<{ payment: number; registration: number }> {
  const rows = await acceptedDesk(ctx);
  return { payment: rows.filter((r) => r.after === "payment").length, registration: rows.filter((r) => r.after === "registration").length };
}

export type AcceptedDetail = AcceptedRow & {
  row: DeskRow; offerStatus: string | null; waived: boolean; classOffered: string | null; instructions: string; reference: string;
  payments: { id: string; amountCents: number; method: string; reference: string | null; paidOn: Date; status: string; receiptNo: string | null }[];
};

/** The admission and payment view of one accepted applicant. Anybody who is not (or no longer) in this stage gets "not found": their own stage view is elsewhere. */
export async function acceptedDetail(ctx: AuthContext, applicationId: string): Promise<AcceptedDetail> {
  requirePermission(ctx, "admission.read");
  const row = await deskRow(ctx, applicationId);
  if (row.state !== "ACCEPTED") throw notFound("Accepted applicant");
  const base = await toAccepted(ctx, row);
  const [{ offer, payments }, setup, classOffered] = await Promise.all([
    loadAdmissionAccount(db, ctx.schoolId, applicationId), paymentSetup(ctx.schoolId),
    db.admissionOffer.findFirst({ where: { applicationId, schoolId: ctx.schoolId }, select: { classOfferedId: true } }).then((o) => (o?.classOfferedId ? db.schoolClass.findFirst({ where: { id: o.classOfferedId, schoolId: ctx.schoolId }, select: { name: true } }) : null)),
  ]);
  return {
    ...base, row, offerStatus: offer?.status ?? null, waived: !!offer?.paymentWaivedAt, classOffered: classOffered?.name ?? null, instructions: setup.instructions, reference: row.applicationNo,
    payments: payments.map((p) => ({ id: p.id, amountCents: centsOf(p.amount), method: p.method, reference: p.reference, paidOn: p.paidOn, status: p.status, receiptNo: p.receiptNo })),
  };
}

// ───────────────────────── The interview workspace ─────────────────────────

export type InterviewWorkspace =
  | { mode: "NONE"; applicationId: string; row: DeskRow }
  | {
      mode: "INTERVIEW"; applicationId: string; row: DeskRow; exam: ExamSummary;
      interview: { id: string; scheduledAt: Date; durationMinutes: number; location: string | null; method: string | null; status: string; outcome: string | null; kind: string; arrangement: string; cancelReason: string | null };
      applicant: { name: string; applicationNo: string; dateOfBirth: Date; className: string | null };
      setup: { subjects: { id: string; name: string }[]; requiredSubjectIds: string[]; teachers: { id: string; name: string; teachesSubject: boolean; teaches: string[] }[]; approval: boolean; maxMark: number } | null;
    };

/**
 * The interview workspace of one applicant: who, when and where, the examination subjects with their teachers and progress, the marks that are
 * in, and what is outstanding. `id` is an interview id; an application id opens that applicant's latest interview (or says there is none).
 * Not found gives a proper "not found", never a redirect to the application.
 */
export async function interviewWorkspace(ctx: AuthContext, id: string): Promise<InterviewWorkspace> {
  requireAnyPermission(ctx, ["admission.read", "admission.interview.manage"]);
  if (!isUuid(id)) throw notFound("Interview");
  let iv = await db.interview.findFirst({ where: { id, schoolId: ctx.schoolId } });
  let applicationId = iv?.applicationId;
  if (!iv) {
    const app = await db.application.findFirst({ where: { id, schoolId: ctx.schoolId }, select: { id: true } });
    if (!app) throw notFound("Interview");
    applicationId = app.id;
    const mine = await db.interview.findMany({ where: { applicationId: app.id, schoolId: ctx.schoolId }, orderBy: { scheduledAt: "desc" } });
    iv = mine.find((i) => i.status === "SCHEDULED") ?? mine[0] ?? null;
  }
  const row = await deskRow(ctx, applicationId!);
  if (!iv) return { mode: "NONE", applicationId: applicationId!, row };
  const app = await db.application.findFirstOrThrow({ where: { id: iv.applicationId, schoolId: ctx.schoolId }, select: { applicationNo: true, firstName: true, middleName: true, lastName: true, dateOfBirth: true } });
  const policy = await getAdmissionPolicy(db, ctx.schoolId);
  const exam = await examSummaryOf(db, ctx.schoolId, iv.applicationId, policy, ctx.userId);
  const canAssign = ctx.permissions.has("admission.exam.assign") && iv.status === "SCHEDULED";
  let setup: Extract<InterviewWorkspace, { mode: "INTERVIEW" }>["setup"] = null;
  if (canAssign) {
    const [subjects, teachers, teaching] = await Promise.all([
      db.subject.findMany({ where: { schoolId: ctx.schoolId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      eligibleTeachers(ctx),
      db.subjectTeacher.findMany({ where: { schoolId: ctx.schoolId }, select: { subjectId: true, staff: { select: { userId: true } } } }),
    ]);
    setup = {
      subjects, requiredSubjectIds: exam.progress.missingSubjectIds, approval: policy.examApproval, maxMark: policy.examMaxMark,
      teachers: teachers.map((t) => ({ ...t, teaches: teaching.filter((x) => x.staff.userId === t.id).map((x) => x.subjectId) })),
    };
  }
  return {
    mode: "INTERVIEW", applicationId: iv.applicationId, row, exam, setup,
    interview: { id: iv.id, scheduledAt: iv.scheduledAt, durationMinutes: iv.durationMinutes, location: iv.location, method: iv.method, status: iv.status, outcome: iv.outcome, kind: iv.kind, arrangement: iv.arrangement, cancelReason: iv.cancelReason },
    applicant: { name: [app.firstName, app.middleName, app.lastName].filter(Boolean).join(" "), applicationNo: app.applicationNo, dateOfBirth: app.dateOfBirth, className: row.className },
  };
}
