import { z } from "zod";
import { db, type Db, type Tx } from "@/lib/db";
import { AppError, conflict, invalid, notFound } from "@/lib/errors";
import { requireAnyPermission, requirePermission, type AuthContext } from "@/lib/auth/context";
import { admissionAccount } from "@/lib/admissions/rules";
import { formatDateOnly, parseDateOnly, todayInTimezone } from "@/lib/dates";
import { centsOf, decimalOf, formatMoney, parseAmount } from "@/lib/finance/money";
import { actorOf, writeAudit } from "@/server/audit";
import { assessmentFor, getAdmissionPolicy } from "@/server/admission-policy";
import { reviewBlockers, documentReadiness } from "@/server/admission-review";
import { noticeFamily } from "@/server/application-notices";
import { allocateNumber } from "@/server/invoices";
import { closeTasks, openTask } from "@/server/workflow";
import { optDateOnly, optText, optUuid, parse, text } from "@/lib/validation";

/*
 * Offers and admission payments.
 *
 * An offer is the decision to admit: it sets the admission fee and the date by which the family must respond. The fee is paid by the applicant
 * BEFORE any student record exists, so it lives in its own ledger (admission_payments) and is deliberately separate from the recurring school
 * fees. A payment counts only after Finance VERIFIES it; the Admissions Office has no permission to do that. Enrolment is allowed only when
 * `enrolmentReadiness` says so: the offer is live, the verified payments cover the fee (or an authorised person recorded an exception), and the
 * required papers are verified (or excepted). The same function is used by the screens and by the enrol service.
 */

const METHODS = ["CASH", "BANK", "MOBILE_MONEY", "OTHER"] as const;
const isUnique = (e: unknown) => {
  const x = e as { code?: string; message?: string; cause?: { code?: string } } | null;
  return x?.code === "P2002" || x?.cause?.code === "23505" || /duplicate key|unique constraint/i.test(x?.message ?? "");
};

async function lockApplication(tx: Tx, schoolId: string, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM applications WHERE id = ${id}::uuid AND "schoolId" = ${schoolId}::uuid FOR UPDATE`;
  if (!rows.length) throw notFound("Application");
  return tx.application.findUniqueOrThrow({ where: { id } });
}
async function todayOf(client: Db | Tx, schoolId: string): Promise<Date> {
  const s = await client.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timezone: true } });
  return parseDateOnly(todayInTimezone(s.timezone)) as Date;
}
const label = (a: { firstName: string; lastName: string; applicationNo: string }) => `${a.firstName} ${a.lastName} (${a.applicationNo})`;

/**
 * After a place is offered: the Admissions Office tells the family, Finance is asked to collect the admission fee, and (when nothing has to be
 * paid first) the Admissions Office can go straight to enrolment.
 */
async function handOffAcceptance(tx: Tx, ctx: AuthContext, app: { id: string; firstName: string; lastName: string; applicationNo: string }, feeCents: number, paymentRequired: boolean) {
  const base = { schoolId: ctx.schoolId, relatedType: "Application", relatedId: app.id, relatedLabel: label(app), createdById: ctx.userId };
  await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Application", relatedId: app.id, kinds: ["DECISION_REVIEW", "ASSESSMENT_COORDINATE"], by: ctx.userId, note: "Decision made" });
  await openTask(tx, { ...base, kind: "OFFER_COMMUNICATE", sourceEvent: "offer.issued" });
  if (feeCents > 0 && paymentRequired) await openTask(tx, { ...base, kind: "ADMISSION_PAYMENT", sourceEvent: "offer.fee_required" });
  else await openTask(tx, { ...base, kind: "ENROL_APPLICANT", sourceEvent: "offer.no_payment_needed" });
}

/** Tells the family a place has been offered (once per offer). */
async function noticeOffer(tx: Tx, ctx: AuthContext, app: { id: string; firstName: string; lastName: string }, offer: { classOfferedId: string | null; issuedAt: Date }) {
  const cls = offer.classOfferedId ? await tx.schoolClass.findFirst({ where: { id: offer.classOfferedId, schoolId: ctx.schoolId }, select: { name: true } }) : null;
  await noticeFamily(tx, ctx, app, { kind: "ACCEPTED", key: `accepted:${app.id}:${offer.issuedAt.toISOString()}`, vars: { className: cls?.name } });
}

export type AcceptanceReadiness = {
  /** Problems no exception can skip here (the application was returned, or required papers are not verified). */
  hard: string[];
  /** An interview is still scheduled: record its result or cancel it first. */
  live: { scheduledAt: Date } | null;
  /** What the school requires that has not happened (an authorised person can record an exception). */
  interview: string | null;
  ready: boolean;
};

/**
 * Everything that must be true before an applicant can be accepted, in words a person can act on. The same function is used by the
 * application screen (to list what is missing) and by `issueOffer` (to refuse), so the two can never disagree. A recorded "interview not
 * required" satisfies the interview requirement (never the entrance examination).
 */
export async function acceptanceReadiness(
  client: Db | Tx, schoolId: string,
  app: { id: string; reviewStatus: string; docsExceptionAt: Date | null; entryType?: string | null; classAppliedId: string | null; interviewWaivedAt: Date | null },
  policyIn?: Awaited<ReturnType<typeof getAdmissionPolicy>>,
): Promise<AcceptanceReadiness> {
  const policy = policyIn ?? (await getAdmissionPolicy(client, schoolId));
  const hard = await reviewBlockers(client, schoolId, app);
  const live = await client.interview.findFirst({ where: { applicationId: app.id, status: "SCHEDULED" }, select: { scheduledAt: true } });
  const completed = await client.interview.findMany({ where: { applicationId: app.id, status: "COMPLETED" }, orderBy: { scheduledAt: "desc" }, select: { kind: true, outcome: true } });
  const levelId = app.classAppliedId ? (await client.schoolClass.findFirst({ where: { id: app.classAppliedId, schoolId }, select: { levelId: true } }))?.levelId ?? null : null;
  const need = assessmentFor(policy, levelId);
  const unmet: string[] = [];
  for (const [required, kind, name] of [[need.interview, "INTERVIEW", "interview"], [need.exam, "ENTRANCE_EXAM", "entrance examination"]] as const) {
    if (!required) continue;
    if (kind === "INTERVIEW" && app.interviewWaivedAt) continue;
    const latest = completed.find((c) => c.kind === kind || (kind === "INTERVIEW" && c.kind === "ASSESSMENT"));
    if (!latest) unmet.push(`The school requires a passed ${name} first.`);
    else if (latest.outcome !== "PASSED") unmet.push(`The latest ${name} result is ${latest.outcome}.`);
  }
  // When nothing is required, the decision still may not quietly go against a recorded result.
  if (!need.interview && !need.exam && completed[0] && completed[0].outcome !== "PASSED") unmet.push(`The latest assessment result is ${completed[0].outcome}.`);
  const interview = unmet.length ? unmet.join(" ") : null;
  return { hard, live, interview, ready: hard.length === 0 && !live && !interview };
}

// ───────────────────────── Offers ─────────────────────────

const offerSchema = z.object({
  classOfferedId: optUuid(),
  feeAmount: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.union([z.string(), z.number()]).optional()),
  expiresOn: optDateOnly(),
  notes: optText(600),
  assessmentNotes: optText(1000),
  /** An authorised person decides against the interview result (or without one when the school requires one). */
  exceptionReason: optText(400),
});

/** Moves the application to ACCEPTED, with the offer that sets the admission fee. Held for approval first when the school requires it. */
export async function issueOffer(ctx: AuthContext, applicationId: string, input: unknown) {
  requirePermission(ctx, "admission.review");
  const d = parse(offerSchema, input);
  const policy = await getAdmissionPolicy(db, ctx.schoolId);
  const fee = d.feeAmount === undefined ? policy.admissionFeeCents : parseAmount(d.feeAmount);
  if (fee === null) throw invalid("Please correct the highlighted fields.", { feeAmount: "Enter an amount such as 0 or 50000" });
  const today = await todayOf(db, ctx.schoolId);
  if (d.expiresOn && d.expiresOn < today) throw invalid("Please correct the highlighted fields.", { expiresOn: "The date cannot be in the past" });
  if (d.classOfferedId && !(await db.schoolClass.findFirst({ where: { id: d.classOfferedId, schoolId: ctx.schoolId, isActive: true }, select: { id: true } }))) throw invalid("Please correct the highlighted fields.", { classOfferedId: "Choose an active class" });

  return db.$transaction(async (tx) => {
    const app = await lockApplication(tx, ctx.schoolId, applicationId);
    if (!["APPLIED", "INTERVIEW"].includes(app.status)) throw conflict(app.status === "ACCEPTED" ? "This applicant already has an admission offer." : "An offer can only be made to an application that is still under consideration.");
    const ready = await acceptanceReadiness(tx, ctx.schoolId, app, policy);
    if (ready.hard.length) throw conflict(`This application is not ready for an offer. ${ready.hard.join(" ")}`);
    if (ready.live) throw conflict("An interview is still scheduled. Record its result or cancel it before deciding.");
    const interviewProblem = ready.interview;
    if (interviewProblem) {
      if (!d.exceptionReason) throw conflict(`${interviewProblem} An authorised person can record an exception.`);
      requirePermission(ctx, "admission.override");
      await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: app.status, toStatus: app.status, kind: "EXCEPTION", reason: `Offer despite interview: ${d.exceptionReason}`, byUserId: ctx.userId } });
      await writeAudit(tx, actorOf(ctx), { action: "admission.exception_interview", entityType: "Application", entityId: applicationId, summary: label(app), changes: { problem: interviewProblem }, reason: d.exceptionReason });
    }

    const needsApproval = policy.offerNeedsApproval;
    const expiresOn = d.expiresOn ?? (policy.offerValidDays > 0 ? new Date(today.getTime() + policy.offerValidDays * 86_400_000) : null);
    const existing = await tx.admissionOffer.findUnique({ where: { applicationId } });
    const data = {
      classOfferedId: d.classOfferedId ?? app.classAppliedId ?? null, feeAmount: decimalOf(fee), expiresOn, notes: d.notes ?? null, status: needsApproval ? ("PENDING_APPROVAL" as const) : ("ISSUED" as const),
      issuedAt: new Date(), issuedById: ctx.userId, approvedAt: null, approvedById: null, respondedAt: null, responseNote: null, paymentWaivedAt: null, paymentWaivedById: null, paymentWaiverReason: null,
    };
    const offer = existing
      ? await tx.admissionOffer.update({ where: { id: existing.id }, data })
      : await tx.admissionOffer.create({ data: { ...data, schoolId: ctx.schoolId, applicationId, letterNo: await allocateNumber(tx, ctx.schoolId, "ADM", today.getUTCFullYear()) } });
    if (!needsApproval) {
      await tx.application.update({ where: { id: applicationId }, data: { status: "ACCEPTED", decidedAt: new Date(), decidedById: ctx.userId, decisionReason: null, decisionOutcome: null, decisionNote: null, ...(d.assessmentNotes ? { assessmentNotes: d.assessmentNotes } : {}), ...(app.reviewStatus !== "VERIFIED" ? { reviewStatus: "VERIFIED" as const, reviewedById: ctx.userId, reviewedAt: new Date() } : {}) } });
      await noticeOffer(tx, ctx, app, offer);
      await handOffAcceptance(tx, ctx, app, fee, policy.requirePaymentBeforeEnrol);
      await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: app.status, toStatus: "ACCEPTED", kind: "STATUS", reason: `Offer ${offer.letterNo}`, byUserId: ctx.userId } });
    } else {
      await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: app.status, toStatus: app.status, kind: "OFFER", reason: `Offer ${offer.letterNo} waiting for approval`, byUserId: ctx.userId } });
    }
    await writeAudit(tx, actorOf(ctx), { action: needsApproval ? "admission.offer_pending" : "admission.offer_issue", entityType: "AdmissionOffer", entityId: offer.id, summary: `${label(app)} · ${offer.letterNo}`, changes: { feeCents: fee, expiresOn: expiresOn ? formatDateOnly(expiresOn) : null, classOfferedId: data.classOfferedId } });
    return offer;
  });
}

export async function approveOffer(ctx: AuthContext, applicationId: string) {
  requirePermission(ctx, "admission.offer.approve");
  return db.$transaction(async (tx) => {
    const app = await lockApplication(tx, ctx.schoolId, applicationId);
    const offer = await tx.admissionOffer.findUnique({ where: { applicationId } });
    if (!offer || offer.status !== "PENDING_APPROVAL") throw conflict("There is no offer waiting for approval.");
    if (offer.issuedById === ctx.userId) throw conflict("An offer must be approved by someone other than the person who made it.");
    await tx.admissionOffer.update({ where: { id: offer.id }, data: { status: "ISSUED", approvedAt: new Date(), approvedById: ctx.userId } });
    await tx.application.update({ where: { id: applicationId }, data: { status: "ACCEPTED", decidedAt: new Date(), decidedById: ctx.userId, ...(app.reviewStatus !== "VERIFIED" ? { reviewStatus: "VERIFIED" as const, reviewedById: ctx.userId, reviewedAt: new Date() } : {}) } });
    await noticeOffer(tx, ctx, app, offer);
    await handOffAcceptance(tx, ctx, app, centsOf(offer.feeAmount), (await getAdmissionPolicy(tx, ctx.schoolId)).requirePaymentBeforeEnrol);
    await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: app.status, toStatus: "ACCEPTED", kind: "STATUS", reason: `Offer ${offer.letterNo} approved`, byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "admission.offer_approve", entityType: "AdmissionOffer", entityId: offer.id, summary: `${label(app)} · ${offer.letterNo}` });
  });
}

const acceptSchema = z.object({ note: optText(600), exceptionReason: optText(400) });

/**
 * The quick acceptance: one action that makes the admission offer with the school's own defaults (the class applied for, the admission fee
 * and offer validity from the policy), so nothing the applicant already submitted is typed again. Every condition of `issueOffer` applies
 * (papers verified, interview requirement met, nothing still scheduled, second-person approval when the school requires it). Pressing it twice, or
 * two people pressing it together, accepts once: the second answer says the applicant is already accepted.
 */
export async function acceptApplication(ctx: AuthContext, applicationId: string, input: unknown): Promise<{ offerId: string; status: string; already: boolean }> {
  requirePermission(ctx, "admission.review");
  const d = parse(acceptSchema, input);
  const existing = await db.admissionOffer.findFirst({ where: { applicationId, schoolId: ctx.schoolId }, select: { id: true, status: true, application: { select: { status: true } } } });
  if (existing && (existing.status === "PENDING_APPROVAL" || (existing.status === "ISSUED" && existing.application.status === "ACCEPTED"))) return { offerId: existing.id, status: existing.status, already: true };
  try {
    const offer = await issueOffer(ctx, applicationId, { notes: d.note, exceptionReason: d.exceptionReason });
    return { offerId: offer.id, status: offer.status, already: false };
  } catch (e) {
    if (e instanceof AppError && e.code === "CONFLICT") {
      const now = await db.admissionOffer.findFirst({ where: { applicationId, schoolId: ctx.schoolId }, select: { id: true, status: true, application: { select: { status: true } } } });
      if (now && (now.status === "PENDING_APPROVAL" || (now.status === "ISSUED" && now.application.status === "ACCEPTED"))) return { offerId: now.id, status: now.status, already: true };
    }
    throw e;
  }
}

const reviseSchema = z.object({ feeAmount: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.union([z.string(), z.number()]).optional()), expiresOn: optDateOnly(), notes: optText(600), reason: text(300) });

/** Changes the fee, the expiry date or the note of a live offer (for example extending it). A reason is always recorded. */
export async function reviseOffer(ctx: AuthContext, applicationId: string, input: unknown) {
  requirePermission(ctx, "admission.review");
  const d = parse(reviseSchema, input);
  const fee = d.feeAmount === undefined ? undefined : parseAmount(d.feeAmount);
  if (fee === null) throw invalid("Please correct the highlighted fields.", { feeAmount: "Enter an amount such as 0 or 50000" });
  await db.$transaction(async (tx) => {
    const app = await lockApplication(tx, ctx.schoolId, applicationId);
    const offer = await tx.admissionOffer.findUnique({ where: { applicationId } });
    if (!offer || !["ISSUED", "PENDING_APPROVAL"].includes(offer.status) || app.status === "ENROLLED") throw conflict("There is no live offer to change.");
    const data = { ...(fee !== undefined ? { feeAmount: decimalOf(fee) } : {}), ...(d.expiresOn ? { expiresOn: d.expiresOn } : {}), ...(d.notes !== undefined ? { notes: d.notes } : {}) };
    await tx.admissionOffer.update({ where: { id: offer.id }, data });
    await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: app.status, toStatus: app.status, kind: "OFFER", reason: `Offer changed: ${d.reason}`, byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "admission.offer_revise", entityType: "AdmissionOffer", entityId: offer.id, summary: `${label(app)} · ${offer.letterNo}`, changes: { feeCents: [centsOf(offer.feeAmount), fee ?? centsOf(offer.feeAmount)], expiresOn: [offer.expiresOn ? formatDateOnly(offer.expiresOn) : null, d.expiresOn ? formatDateOnly(d.expiresOn) : offer.expiresOn ? formatDateOnly(offer.expiresOn) : null] }, reason: d.reason });
  });
}

/** Takes the offer back and returns the application to the review stage. Refused while verified admission money is held: reverse it first. */
export async function withdrawOffer(ctx: AuthContext, applicationId: string, input: unknown) {
  requirePermission(ctx, "admission.review");
  const { reason } = parse(z.object({ reason: text(300) }), input);
  await db.$transaction(async (tx) => {
    const app = await lockApplication(tx, ctx.schoolId, applicationId);
    const offer = await tx.admissionOffer.findUnique({ where: { applicationId } });
    if (!offer || !["ISSUED", "PENDING_APPROVAL"].includes(offer.status) || app.status === "ENROLLED") throw conflict("There is no live offer to withdraw.");
    if (await tx.admissionPayment.findFirst({ where: { applicationId, status: "VERIFIED" }, select: { id: true } })) throw conflict("Verified admission payments exist for this applicant. Finance must reverse them before the offer is withdrawn.");
    await tx.admissionOffer.update({ where: { id: offer.id }, data: { status: "WITHDRAWN", responseNote: reason, respondedAt: new Date() } });
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Application", relatedId: applicationId, kinds: ["OFFER_COMMUNICATE", "ADMISSION_PAYMENT", "ENROL_APPLICANT"], status: "CANCELLED", by: ctx.userId, note: "Offer withdrawn" });
    if (app.status === "ACCEPTED") {
      await tx.application.update({ where: { id: applicationId }, data: { status: "APPLIED", decidedAt: null, decidedById: null } });
      await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: "ACCEPTED", toStatus: "APPLIED", kind: "STATUS", reason: `Offer withdrawn: ${reason}`, byUserId: ctx.userId } });
    } else await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: app.status, toStatus: app.status, kind: "OFFER", reason: `Offer withdrawn: ${reason}`, byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "admission.offer_withdraw", entityType: "AdmissionOffer", entityId: offer.id, summary: `${label(app)} · ${offer.letterNo}`, reason });
  });
}

/** The family declines the place: the offer is closed and the application is withdrawn. */
export async function declineOffer(ctx: AuthContext, applicationId: string, input: unknown) {
  requirePermission(ctx, "admission.review");
  const { reason } = parse(z.object({ reason: text(300) }), input);
  await db.$transaction(async (tx) => {
    const app = await lockApplication(tx, ctx.schoolId, applicationId);
    const offer = await tx.admissionOffer.findUnique({ where: { applicationId } });
    if (!offer || offer.status !== "ISSUED" || app.status !== "ACCEPTED") throw conflict("There is no issued offer to decline.");
    await tx.admissionOffer.update({ where: { id: offer.id }, data: { status: "DECLINED", responseNote: reason, respondedAt: new Date() } });
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Application", relatedId: applicationId, status: "CANCELLED", by: ctx.userId, note: "Offer declined" });
    await tx.application.update({ where: { id: applicationId }, data: { status: "WITHDRAWN", decisionReason: `Offer declined: ${reason}`, decidedAt: new Date(), decidedById: ctx.userId } });
    await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: "ACCEPTED", toStatus: "WITHDRAWN", kind: "STATUS", reason: `Offer declined: ${reason}`, byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "admission.offer_decline", entityType: "AdmissionOffer", entityId: offer.id, summary: `${label(app)} · ${offer.letterNo}`, reason });
  });
}

// ───────────────────────── Admission payments ─────────────────────────

const paymentSchema = z
  .object({ amount: z.union([z.string(), z.number()]), method: z.enum(METHODS), reference: optText(80), paidOn: optDateOnly(), payerName: optText(120), notes: optText(300), idempotencyKey: optText(100) })
  .refine((v) => v.method === "CASH" || v.method === "OTHER" || !!v.reference, { path: ["reference"], message: "Enter the bank slip number or transaction id" });

/**
 * Finance records money received from an applicant. It starts as PENDING and counts for nothing until it is verified. The same request sent
 * twice (same idempotency key) returns the first record; the same bank slip or transaction id cannot be recorded twice.
 */
export async function recordAdmissionPayment(ctx: AuthContext, applicationId: string, input: unknown) {
  requirePermission(ctx, "admission.payment.record");
  const d = parse(paymentSchema, input);
  const cents = parseAmount(d.amount);
  if (cents === null || cents <= 0) throw invalid("Please correct the highlighted fields.", { amount: "Enter an amount more than zero, such as 50000" });
  const today = await todayOf(db, ctx.schoolId);
  const paidOn = d.paidOn ?? today;
  if (paidOn > today) throw invalid("Please correct the highlighted fields.", { paidOn: "The date cannot be in the future" });

  if (d.idempotencyKey) {
    const prior = await db.admissionPayment.findFirst({ where: { schoolId: ctx.schoolId, idempotencyKey: d.idempotencyKey } });
    if (prior) {
      if (prior.applicationId !== applicationId || centsOf(prior.amount) !== cents || prior.method !== d.method) throw conflict("This form was already submitted for a different payment. Reload the page and enter the payment again.");
      return { payment: prior, replay: true as const };
    }
  }
  try {
    return await db.$transaction(async (tx) => {
      const app = await lockApplication(tx, ctx.schoolId, applicationId);
      const offer = await tx.admissionOffer.findUnique({ where: { applicationId } });
      if (app.status !== "ACCEPTED" || !offer || offer.status !== "ISSUED") throw conflict("Admission payments can only be recorded for an applicant who holds an issued offer.");
      if (offer.expiresOn && offer.expiresOn < today) throw conflict("The offer has expired. Ask the Admissions Office to extend it before recording payment.");
      const payment = await tx.admissionPayment.create({
        data: { schoolId: ctx.schoolId, applicationId, amount: decimalOf(cents), method: d.method, reference: d.reference ?? null, paidOn, payerName: d.payerName ?? null, notes: d.notes ?? null, idempotencyKey: d.idempotencyKey ?? null, recordedById: ctx.userId },
      });
      await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: app.status, toStatus: app.status, kind: "PAYMENT", reason: `Admission payment recorded, waiting for verification (${formatMoney(cents)})`, byUserId: ctx.userId } });
      await writeAudit(tx, actorOf(ctx), { action: "admission_payment.record", entityType: "AdmissionPayment", entityId: payment.id, summary: `${label(app)} · ${formatMoney(cents)}`, changes: { amountCents: cents, method: d.method, reference: d.reference ?? null } });
      return { payment, replay: false as const };
    });
  } catch (e) {
    if (isUnique(e)) {
      if (d.idempotencyKey) { const prior = await db.admissionPayment.findFirst({ where: { schoolId: ctx.schoolId, idempotencyKey: d.idempotencyKey } }); if (prior) return { payment: prior, replay: true as const }; }
      throw conflict("This bank slip or transaction reference has already been recorded.");
    }
    throw e;
  }
}

/** PENDING -> VERIFIED, with the receipt number. Verifying an already verified payment returns it unchanged (a retry never issues a second receipt). */
export async function verifyAdmissionPayment(ctx: AuthContext, paymentId: string) {
  requirePermission(ctx, "admission.payment.verify");
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM admission_payments WHERE id = ${paymentId}::uuid AND "schoolId" = ${ctx.schoolId}::uuid FOR UPDATE`;
    if (!rows.length) throw notFound("Payment");
    const p = await tx.admissionPayment.findUniqueOrThrow({ where: { id: paymentId } });
    if (p.status === "VERIFIED") return p;
    if (p.status !== "PENDING") throw conflict(`A ${p.status.toLowerCase()} payment cannot be verified.`);
    const policy = await getAdmissionPolicy(tx, ctx.schoolId);
    if (policy.paymentNeedsSecondPerson && p.recordedById === ctx.userId) throw conflict("This school requires a different person to verify a payment than the one who recorded it.");
    const app = await tx.application.findUniqueOrThrow({ where: { id: p.applicationId } });
    const today = await todayOf(tx, ctx.schoolId);
    const receiptNo = await allocateNumber(tx, ctx.schoolId, "ARC", today.getUTCFullYear());
    const v = await tx.admissionPayment.update({ where: { id: p.id }, data: { status: "VERIFIED", verifiedById: ctx.userId, verifiedAt: new Date(), receiptNo } });
    // When the verified money now covers the fee, Finance's task is done and the Admissions Office can enrol.
    const { account } = await loadAdmissionAccount(tx, ctx.schoolId, p.applicationId);
    if (account?.satisfied) {
      await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Application", relatedId: p.applicationId, kinds: ["ADMISSION_PAYMENT"], by: ctx.userId, note: `Verified, receipt ${receiptNo}` });
      await openTask(tx, { schoolId: ctx.schoolId, kind: "ENROL_APPLICANT", relatedType: "Application", relatedId: p.applicationId, relatedLabel: label(app), sourceEvent: "admission_payment.verified", createdById: ctx.userId });
    }
    await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId: p.applicationId, fromStatus: app.status, toStatus: app.status, kind: "PAYMENT", reason: `Admission payment verified (${formatMoney(centsOf(p.amount))}), receipt ${receiptNo}`, byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "admission_payment.verify", entityType: "AdmissionPayment", entityId: p.id, summary: `${label(app)} · ${receiptNo} · ${formatMoney(centsOf(p.amount))}` });
    return v;
  });
}

export async function rejectAdmissionPayment(ctx: AuthContext, paymentId: string, input: unknown) {
  requirePermission(ctx, "admission.payment.verify");
  const { reason } = parse(z.object({ reason: text(300) }), input);
  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM admission_payments WHERE id = ${paymentId}::uuid AND "schoolId" = ${ctx.schoolId}::uuid FOR UPDATE`;
    if (!rows.length) throw notFound("Payment");
    const p = await tx.admissionPayment.findUniqueOrThrow({ where: { id: paymentId } });
    if (p.status !== "PENDING") throw conflict("Only a payment that is waiting for verification can be rejected. Reverse a verified one instead.");
    const app = await tx.application.findUniqueOrThrow({ where: { id: p.applicationId } });
    await tx.admissionPayment.update({ where: { id: p.id }, data: { status: "REJECTED", rejectReason: reason, verifiedById: ctx.userId, verifiedAt: new Date() } });
    await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId: p.applicationId, fromStatus: app.status, toStatus: app.status, kind: "PAYMENT", reason: `Admission payment rejected: ${reason}`, byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "admission_payment.reject", entityType: "AdmissionPayment", entityId: p.id, summary: `${label(app)} · ${formatMoney(centsOf(p.amount))}`, reason });
  });
}

export async function reverseAdmissionPayment(ctx: AuthContext, paymentId: string, input: unknown) {
  requirePermission(ctx, "admission.payment.verify");
  const { reason } = parse(z.object({ reason: text(300) }), input);
  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM admission_payments WHERE id = ${paymentId}::uuid AND "schoolId" = ${ctx.schoolId}::uuid FOR UPDATE`;
    if (!rows.length) throw notFound("Payment");
    const p = await tx.admissionPayment.findUniqueOrThrow({ where: { id: paymentId } });
    if (p.status !== "VERIFIED") throw conflict("Only a verified payment can be reversed.");
    const app = await tx.application.findUniqueOrThrow({ where: { id: p.applicationId } });
    await tx.admissionPayment.update({ where: { id: p.id }, data: { status: "REVERSED", reversedById: ctx.userId, reversedAt: new Date(), reverseReason: reason } });
    if (app.status === "ACCEPTED") {
      const { account } = await loadAdmissionAccount(tx, ctx.schoolId, p.applicationId);
      if (account && !account.satisfied) {
        await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Application", relatedId: p.applicationId, kinds: ["ENROL_APPLICANT"], status: "CANCELLED", by: ctx.userId, note: "Payment reversed" });
        await openTask(tx, { schoolId: ctx.schoolId, kind: "ADMISSION_PAYMENT", relatedType: "Application", relatedId: p.applicationId, relatedLabel: label(app), sourceEvent: "admission_payment.reversed", createdById: ctx.userId, discriminator: `reversed-${p.id}` });
      }
    }
    await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId: p.applicationId, fromStatus: app.status, toStatus: app.status, kind: "PAYMENT", reason: `Admission payment ${p.receiptNo} reversed: ${reason}`, byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "admission_payment.reverse", entityType: "AdmissionPayment", entityId: p.id, summary: `${label(app)} · ${p.receiptNo} · ${formatMoney(centsOf(p.amount))}`, changes: { alreadyEnrolled: app.status === "ENROLLED" }, reason });
  });
}

/** An authorised exception: enrolment may go ahead without the verified admission payment. Recorded with who allowed it and why. */
export async function waiveAdmissionPayment(ctx: AuthContext, applicationId: string, input: unknown) {
  requirePermission(ctx, "admission.override");
  const { reason } = parse(z.object({ reason: text(400) }), input);
  await db.$transaction(async (tx) => {
    const app = await lockApplication(tx, ctx.schoolId, applicationId);
    const offer = await tx.admissionOffer.findUnique({ where: { applicationId } });
    if (!offer || offer.status !== "ISSUED" || app.status !== "ACCEPTED") throw conflict("There is no issued offer to make an exception for.");
    await tx.admissionOffer.update({ where: { id: offer.id }, data: { paymentWaivedAt: new Date(), paymentWaivedById: ctx.userId, paymentWaiverReason: reason } });
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Application", relatedId: applicationId, kinds: ["ADMISSION_PAYMENT"], by: ctx.userId, note: "Exception recorded: payment waived" });
    await openTask(tx, { schoolId: ctx.schoolId, kind: "ENROL_APPLICANT", relatedType: "Application", relatedId: applicationId, relatedLabel: label(app), sourceEvent: "admission_payment.waived", createdById: ctx.userId });
    await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: app.status, toStatus: app.status, kind: "EXCEPTION", reason: `Admission payment exception: ${reason}`, byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "admission.exception_payment", entityType: "AdmissionOffer", entityId: offer.id, summary: `${label(app)} · ${offer.letterNo}`, reason });
  });
}

// ───────────────────────── Account and readiness ─────────────────────────

/** The offer, the admission account and the payment rows of one application (no permission check: callers check). */
export async function loadAdmissionAccount(client: Db | Tx, schoolId: string, applicationId: string) {
  const [offer, payments] = await Promise.all([
    client.admissionOffer.findFirst({ where: { applicationId, schoolId } }),
    client.admissionPayment.findMany({ where: { applicationId, schoolId }, orderBy: { recordedAt: "asc" } }),
  ]);
  if (!offer) return { offer: null, payments, account: null };
  const account = admissionAccount(centsOf(offer.feeAmount), payments.map((p) => ({ status: p.status, amountCents: centsOf(p.amount) })), !!offer.paymentWaivedAt);
  return { offer, payments, account };
}

export type ReadinessItem = { key: "offer" | "offerValid" | "payment" | "documents" | "review"; ok: boolean; message: string };

/** Everything that must be true before the Admissions Office can enrol this applicant, each with a plain sentence. */
export async function enrolmentReadiness(client: Db | Tx, schoolId: string, app: { id: string; status: string; reviewStatus: string; docsExceptionAt: Date | null; entryType?: string | null }) {
  const [policy, { offer, account }, today] = await Promise.all([getAdmissionPolicy(client, schoolId), loadAdmissionAccount(client, schoolId, app.id), todayOf(client, schoolId)]);
  const items: ReadinessItem[] = [];
  items.push({ key: "offer", ok: app.status === "ACCEPTED" && offer?.status === "ISSUED", message: offer?.status === "PENDING_APPROVAL" ? "The offer is waiting for approval." : app.status === "ACCEPTED" && offer?.status === "ISSUED" ? "An admission offer has been issued." : "There is no issued admission offer." });
  const expired = !!offer?.expiresOn && offer.expiresOn < today;
  items.push({ key: "offerValid", ok: !expired, message: expired ? `The offer expired on ${formatDateOnly(offer!.expiresOn!)}. Extend it first.` : "The offer is still valid." });
  if (!policy.requirePaymentBeforeEnrol || !account) items.push({ key: "payment", ok: true, message: "Admission payment is not required before enrolment." });
  else if (account.satisfied) items.push({ key: "payment", ok: true, message: account.status === "WAIVED" ? "Admission payment waived by an authorised exception." : account.requiredCents <= 0 ? "No admission fee is required." : `Admission payment verified (${formatMoney(account.verifiedCents)}).` });
  else items.push({ key: "payment", ok: false, message: `Admission payment not complete: ${formatMoney(account.verifiedCents)} verified of ${formatMoney(account.requiredCents)} required${account.pendingCents > 0 ? ` (${formatMoney(account.pendingCents)} waiting for verification)` : ""}.` });
  const docs = await documentReadiness(client, schoolId, app);
  items.push({ key: "documents", ok: docs.ok, message: docs.ok ? (docs.excepted ? "Documents accepted by an authorised exception." : "Required documents are verified.") : `Required documents not verified: ${docs.checklist.filter((x) => x.state !== "VERIFIED").map((x) => x.docType).join(", ")}.` });
  items.push({ key: "review", ok: app.reviewStatus !== "RETURNED", message: app.reviewStatus === "RETURNED" ? "The application was returned for correction." : "The application is not waiting for corrections." });
  return { items, ready: items.every((i) => i.ok), account, offer };
}

// ───────────────────────── Finance queue ─────────────────────────

/** Finance's view: applicants who hold an offer and what they have paid. Shows only what Finance needs, never interview notes or decisions. */
export async function admissionPaymentQueue(ctx: AuthContext) {
  requireAnyPermission(ctx, ["admission.payment.record", "admission.payment.verify"]);
  const apps = await db.application.findMany({
    where: { schoolId: ctx.schoolId, status: "ACCEPTED", offer: { status: "ISSUED" } },
    orderBy: { decidedAt: "asc" },
    select: { id: true, applicationNo: true, firstName: true, lastName: true, guardians: true, offer: true, payments: { orderBy: { recordedAt: "asc" } } },
  });
  return apps.map((a) => {
    const account = admissionAccount(centsOf(a.offer!.feeAmount), a.payments.map((p) => ({ status: p.status, amountCents: centsOf(p.amount) })), !!a.offer!.paymentWaivedAt);
    return { id: a.id, applicationNo: a.applicationNo, name: `${a.firstName} ${a.lastName}`, guardian: (a.guardians as { fullName?: string; phone?: string }[])[0] ?? null, letterNo: a.offer!.letterNo, expiresOn: a.offer!.expiresOn, account, payments: a.payments.map((p) => ({ id: p.id, amountCents: centsOf(p.amount), method: p.method, reference: p.reference, paidOn: p.paidOn, status: p.status, receiptNo: p.receiptNo, recordedAt: p.recordedAt })) };
  });
}

export async function getAdmissionPaymentReceiptData(ctx: AuthContext, paymentId: string) {
  requireAnyPermission(ctx, ["admission.payment.record", "admission.payment.verify", "admission.read"]);
  const p = await db.admissionPayment.findFirst({ where: { id: paymentId, schoolId: ctx.schoolId }, include: { application: { select: { applicationNo: true, firstName: true, middleName: true, lastName: true, classAppliedId: true } } } });
  if (!p) throw notFound("Receipt");
  if (p.status !== "VERIFIED" && p.status !== "REVERSED") throw conflict("A receipt exists only for a verified payment.");
  return p;
}
