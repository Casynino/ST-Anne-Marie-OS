import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireAnyPermission, requirePermission, type AuthContext } from "@/lib/auth/context";
import { admissionAccount, docChecklist, docsComplete } from "@/lib/admissions/rules";
import { centsOf } from "@/lib/finance/money";
import { getAdmissionPolicy } from "@/server/admission-policy";
import { enrolmentReadiness } from "@/server/admission-offers";

/*
 * Where every open application stands and what each department has to do next, worked out from the real records each time (nothing is stored
 * as a "task", so a task can never be marked done without the work being done). The same derivation feeds the Administrator's overview, the
 * Admissions Office and Finance queues, and the filtered lists the dashboard cards link to.
 */

export const STAGES = ["new", "returned", "incomplete", "docs_pending", "interview_scheduled", "awaiting_result", "awaiting_decision", "passed", "not_passed", "offer_pending", "awaiting_payment", "verification_pending", "eligible", "online", "physical"] as const;
export type Stage = (typeof STAGES)[number];

type Derived = {
  id: string; status: "APPLIED" | "INTERVIEW" | "ACCEPTED"; source: "ONLINE" | "STAFF"; review: "PENDING" | "VERIFIED" | "RETURNED";
  docsOk: boolean; docsPending: boolean; liveInterviewAt: Date | null; latestOutcome: string | null; hasCompletedInterview: boolean;
  offerStatus: string | null; account: ReturnType<typeof admissionAccount> | null; eligible: boolean;
};

/** One pass over the open applications (those still being decided or waiting to be enrolled). */
async function derive(ctx: AuthContext): Promise<Derived[]> {
  const policy = await getAdmissionPolicy(db, ctx.schoolId);
  const apps = await db.application.findMany({
    where: { schoolId: ctx.schoolId, status: { in: ["APPLIED", "INTERVIEW", "ACCEPTED"] } },
    select: {
      id: true, status: true, source: true, reviewStatus: true, docsExceptionAt: true,
      documents: { where: { deletedAt: null }, select: { id: true, docType: true, verification: true } },
      interviews: { select: { status: true, outcome: true, scheduledAt: true } },
      offer: { select: { status: true, feeAmount: true, paymentWaivedAt: true } },
      payments: { select: { status: true, amount: true } },
    },
  });
  const out: Derived[] = [];
  for (const a of apps) {
    const checklist = docChecklist(policy.requiredDocTypes, a.documents);
    const live = a.interviews.find((i) => i.status === "SCHEDULED") ?? null;
    const done = a.interviews.filter((i) => i.status === "COMPLETED").sort((x, y) => y.scheduledAt.getTime() - x.scheduledAt.getTime());
    const account = a.offer ? admissionAccount(centsOf(a.offer.feeAmount), a.payments.map((p) => ({ status: p.status, amountCents: centsOf(p.amount) })), !!a.offer.paymentWaivedAt) : null;
    const docsOk = docsComplete(checklist) || !!a.docsExceptionAt;
    let eligible = false;
    if (a.status === "ACCEPTED" && a.offer?.status === "ISSUED") eligible = (await enrolmentReadiness(db, ctx.schoolId, { id: a.id, status: a.status, reviewStatus: a.reviewStatus, docsExceptionAt: a.docsExceptionAt })).ready;
    out.push({
      id: a.id, status: a.status as Derived["status"], source: a.source, review: a.reviewStatus, docsOk, docsPending: a.documents.some((d) => d.verification === "PENDING"),
      liveInterviewAt: live?.scheduledAt ?? null, latestOutcome: done[0]?.outcome ?? null, hasCompletedInterview: done.length > 0, offerStatus: a.offer?.status ?? null, account, eligible,
    });
  }
  return out;
}

const inStage = (d: Derived, s: Stage, now: Date): boolean => {
  switch (s) {
    case "new": return d.status === "APPLIED" && d.review === "PENDING";
    case "returned": return d.review === "RETURNED";
    case "incomplete": return d.status !== "ACCEPTED" && (!d.docsOk || d.review === "RETURNED");
    case "docs_pending": return d.docsPending;
    case "interview_scheduled": return d.liveInterviewAt !== null && d.liveInterviewAt >= now;
    case "awaiting_result": return d.liveInterviewAt !== null && d.liveInterviewAt < now;
    case "awaiting_decision": return d.status === "INTERVIEW" && d.liveInterviewAt === null && d.hasCompletedInterview && d.offerStatus !== "PENDING_APPROVAL";
    case "passed": return d.status !== "ACCEPTED" && d.latestOutcome === "PASSED";
    case "not_passed": return d.status !== "ACCEPTED" && d.latestOutcome === "NOT_PASSED";
    case "offer_pending": return d.offerStatus === "PENDING_APPROVAL";
    case "awaiting_payment": return d.status === "ACCEPTED" && d.offerStatus === "ISSUED" && !!d.account && !d.account.satisfied;
    case "verification_pending": return d.status === "ACCEPTED" && !!d.account && d.account.pendingCents > 0;
    case "eligible": return d.eligible;
    case "online": return d.source === "ONLINE";
    case "physical": return d.source === "STAFF";
  }
};

/** Application ids in a workflow stage (open applications only). Used by the admissions list filter. */
export async function stageIds(ctx: AuthContext, stage: Stage): Promise<string[]> {
  requirePermission(ctx, "admission.read");
  const now = new Date();
  return (await derive(ctx)).filter((d) => inStage(d, stage, now)).map((d) => d.id);
}

export type AdmissionOverview = {
  /** Applications received, by channel and by outcome. */
  received: { total: number; online: number; physical: number };
  byStatus: Record<string, number>;
  stages: Record<Stage, number>;
  interviews: { upcoming: number; today: number; awaitingResult: number };
  offers: { pendingApproval: number; awaitingPayment: number; paymentsToVerify: number; eligibleToEnrol: number };
  enrolled: { total: number; awaitingPlacement: number };
};

/** The Administrator's admissions picture. `from`/`to` limit "received" to applications created in that period. */
export async function admissionOverview(ctx: AuthContext, range: { from?: Date; to?: Date } = {}): Promise<AdmissionOverview> {
  requirePermission(ctx, "admission.read");
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const where: Prisma.ApplicationWhereInput = { schoolId: ctx.schoolId, ...(range.from || range.to ? { createdAt: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lt: range.to } : {}) } } : {}) };
  const [bySource, byStatus, derived, today, toVerify, placement] = await Promise.all([
    db.application.groupBy({ by: ["source"], where, _count: { _all: true } }),
    db.application.groupBy({ by: ["status"], where, _count: { _all: true } }),
    derive(ctx),
    db.interview.count({ where: { schoolId: ctx.schoolId, status: "SCHEDULED", scheduledAt: { gte: dayStart, lt: new Date(dayStart.getTime() + 86_400_000) } } }),
    db.admissionPayment.count({ where: { schoolId: ctx.schoolId, status: "PENDING" } }),
    awaitingPlacementCount(ctx.schoolId),
  ]);
  const now = new Date();
  const stages = Object.fromEntries(STAGES.map((s) => [s, derived.filter((d) => inStage(d, s, now)).length])) as Record<Stage, number>;
  const src = Object.fromEntries(bySource.map((x) => [x.source, x._count._all]));
  const status = Object.fromEntries(byStatus.map((x) => [x.status, x._count._all])) as Record<string, number>;
  return {
    received: { total: Object.values(status).reduce((n, v) => n + v, 0), online: src.ONLINE ?? 0, physical: src.STAFF ?? 0 },
    byStatus: status,
    stages,
    interviews: { upcoming: stages.interview_scheduled, today, awaitingResult: stages.awaiting_result },
    offers: { pendingApproval: stages.offer_pending, awaitingPayment: stages.awaiting_payment, paymentsToVerify: toVerify, eligibleToEnrol: stages.eligible },
    enrolled: { total: status.ENROLLED ?? 0, awaitingPlacement: placement },
  };
}

// ───────────────────────── Enrolled but not yet in a class ─────────────────────────

async function awaitingPlacementWhere(schoolId: string): Promise<Prisma.StudentWhereInput | null> {
  const year = await db.academicYear.findFirst({ where: { schoolId, isCurrent: true }, select: { id: true } });
  if (!year) return null;
  return { schoolId, status: "ENROLLED", enrollments: { none: { academicYearId: year.id, status: "ACTIVE" } } };
}
async function awaitingPlacementCount(schoolId: string): Promise<number> {
  const where = await awaitingPlacementWhere(schoolId);
  return where ? db.student.count({ where }) : 0;
}

/** Students who are enrolled but have no class in the current year: the hand-off from the Admissions Office to class placement. */
export async function awaitingPlacement(ctx: AuthContext) {
  requireAnyPermission(ctx, ["student.enroll", "admission.read"]);
  const where = await awaitingPlacementWhere(ctx.schoolId);
  if (!where) return [];
  const list = await db.student.findMany({ where, orderBy: { createdAt: "asc" }, take: 100, select: { id: true, admissionNo: true, firstName: true, middleName: true, lastName: true, admissionDate: true, createdAt: true } });
  const apps = await db.application.findMany({ where: { schoolId: ctx.schoolId, studentId: { in: list.map((s) => s.id) } }, select: { studentId: true, classAppliedId: true } });
  const classes = await db.schoolClass.findMany({ where: { schoolId: ctx.schoolId, id: { in: apps.flatMap((a) => (a.classAppliedId ? [a.classAppliedId] : [])) } }, select: { id: true, name: true } });
  return list.map((s) => {
    const pref = apps.find((a) => a.studentId === s.id)?.classAppliedId ?? null;
    return { id: s.id, admissionNo: s.admissionNo, name: [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" "), admissionDate: s.admissionDate, preferredClassId: pref, preferredClass: classes.find((c) => c.id === pref)?.name ?? null };
  });
}

// ───────────────────────── Queues for each department ─────────────────────────

export type QueueItem = { key: string; count: number; href: string };

/**
 * What each person has waiting, limited to what their permissions let them act on. Admissions Office: new applications, papers to verify,
 * interviews to record, decisions, applicants ready to enrol, students waiting for a class. Finance: admission payments to verify and
 * applicants who owe the admission fee. Head Teacher: students waiting for a class and offers to approve.
 */
export async function admissionQueues(ctx: AuthContext): Promise<QueueItem[]> {
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  const out: QueueItem[] = [];
  const push = (key: string, count: number, href: string) => { if (count > 0) out.push({ key, count, href }); };
  if (can("admission.read")) {
    const o = await admissionOverview(ctx);
    if (can("admission.create") || can("admission.documents.verify")) { push("new", o.stages.new, "/admissions?stage=new"); push("docsPending", o.stages.docs_pending, "/admissions?stage=docs_pending"); push("returned", o.stages.returned, "/admissions?stage=returned"); }
    if (can("admission.interview.manage")) { push("interviewsToday", o.interviews.today, "/admissions/interviews"); push("awaitingResult", o.interviews.awaitingResult, "/admissions?stage=awaiting_result"); }
    if (can("admission.review")) push("awaitingDecision", o.stages.awaiting_decision, "/admissions?stage=awaiting_decision");
    if (can("admission.offer.approve")) push("offerPending", o.offers.pendingApproval, "/admissions?stage=offer_pending");
    if (can("admission.enrol")) push("eligible", o.offers.eligibleToEnrol, "/admissions?stage=eligible");
    if (can("admission.review") || can("admission.enrol")) push("awaitingPaymentView", o.offers.awaitingPayment, "/admissions?stage=awaiting_payment");
    if (can("student.enroll")) push("awaitingPlacement", o.enrolled.awaitingPlacement, "/admissions/placement");
  } else if (can("student.enroll")) push("awaitingPlacement", await awaitingPlacementCount(ctx.schoolId), "/admissions/placement");
  if (can("admission.payment.verify") || can("admission.payment.record")) {
    const q = await db.admissionPayment.count({ where: { schoolId: ctx.schoolId, status: "PENDING" } });
    push("paymentsToVerify", q, "/finance/admissions");
    const derived = (await derive(ctx)).filter((d) => inStage(d, "awaiting_payment", new Date())).length;
    push("awaitingPayment", derived, "/finance/admissions");
  }
  return out;
}

/** Active students per class in the current year with each class's capacity, so screens can show "12 of 40 places taken" before placing someone. */
export async function classOccupancy(schoolId: string): Promise<Map<string, { count: number; capacity: number | null }>> {
  const year = await db.academicYear.findFirst({ where: { schoolId, isCurrent: true }, select: { id: true } });
  const [classes, counts] = await Promise.all([
    db.schoolClass.findMany({ where: { schoolId }, select: { id: true, capacity: true } }),
    year ? db.studentEnrollment.groupBy({ by: ["classId"], where: { schoolId, academicYearId: year.id, status: "ACTIVE" }, _count: { _all: true } }) : [],
  ]);
  return new Map(classes.map((c) => [c.id, { count: counts.find((x) => x.classId === c.id)?._count._all ?? 0, capacity: c.capacity }]));
}
