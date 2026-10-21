import { z } from "zod";
import { db } from "@/lib/db";
import { conflict, invalid, notFound } from "@/lib/errors";
import { requireAnyPermission, requirePermission, type AuthContext } from "@/lib/auth/context";
import { formatDateOnly, parseDateOnly, todayInTimezone, zonedToUtc } from "@/lib/dates";
import { actorOf, writeAudit } from "@/server/audit";
import { allocateNumber } from "@/server/invoices";
import { createStaffUser } from "@/server/users";
import { closeTasks, openTask } from "@/server/workflow";
import { optDateOnly, optEmailField, optPhoneField, optText, optUuid, parse, text, uuid } from "@/lib/validation";

/*
 * Staff recruitment and onboarding. A candidate is not a staff member: the account exists only after the interview, the decision, the
 * employment papers and an approval, each by the people allowed to do it and never the person who took the candidate in. Salary is not
 * kept here. Payroll is not part of this system yet, so the last step leaves Finance a task naming the new employee; Finance sets up pay in
 * its own process. Sensitive notes and papers are visible only to the people who handle recruitment.
 */

const ACTIVE = ["APPLIED", "INTERVIEW_SCHEDULED", "INTERVIEWED", "AWAITING_DECISION", "ACCEPTED", "ONBOARDING"] as const;
const label = (c: { candidateNo: string; fullName: string }) => `${c.fullName} (${c.candidateNo})`;

export type RecruitmentSettings = { requiredDocs: string[] };
export async function getRecruitmentSettings(schoolId: string): Promise<RecruitmentSettings> {
  const row = await db.schoolSetting.findUnique({ where: { schoolId_key: { schoolId, key: "recruitment" } } });
  const v = (row?.value ?? {}) as Partial<RecruitmentSettings>;
  return { requiredDocs: Array.isArray(v.requiredDocs) ? v.requiredDocs.filter((x): x is string => typeof x === "string" && x.length > 0) : [] };
}
export async function updateRecruitmentSettings(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "school.settings.update");
  const { docs } = parse(z.object({ docs: optText(1000) }), input);
  const requiredDocs = [...new Set((docs ?? "").split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean))].slice(0, 20);
  await db.$transaction(async (tx) => {
    await tx.schoolSetting.upsert({ where: { schoolId_key: { schoolId: ctx.schoolId, key: "recruitment" } }, create: { schoolId: ctx.schoolId, key: "recruitment", value: { requiredDocs }, updatedById: ctx.userId }, update: { value: { requiredDocs }, updatedById: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "settings.recruitment_update", entityType: "SchoolSetting", entityId: "recruitment", changes: { requiredDocs } });
  });
}

const candidateSchema = z.object({
  fullName: text(120), phone: optPhoneField(), email: optEmailField(), positionApplied: text(120), subjects: optText(200), qualifications: optText(500), experience: optText(500), notes: optText(1000),
});

export async function createCandidate(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "staff.recruit");
  const d = parse(candidateSchema, input);
  const today = parseDateOnly(todayInTimezone((await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { timezone: true } })).timezone)) as Date;
  return db.$transaction(async (tx) => {
    const candidateNo = await allocateNumber(tx, ctx.schoolId, "REC", today.getUTCFullYear());
    const c = await tx.staffCandidate.create({ data: { ...d, schoolId: ctx.schoolId, candidateNo, createdById: ctx.userId } });
    await openTask(tx, { schoolId: ctx.schoolId, kind: "CANDIDATE_REVIEW", relatedType: "Candidate", relatedId: c.id, relatedLabel: label(c), sourceEvent: "candidate.recorded", createdById: ctx.userId });
    await writeAudit(tx, actorOf(ctx), { action: "candidate.create", entityType: "StaffCandidate", entityId: c.id, summary: label(c), changes: { position: d.positionApplied } });
    return c;
  });
}

const scheduleSchema = z.object({ interviewAt: text(40), location: optText(120), interviewerId: optUuid() });

export async function scheduleCandidateInterview(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "staff.recruit");
  const d = parse(scheduleSchema, input);
  const tz = (await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { timezone: true } })).timezone;
  const at = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.interviewAt) ? zonedToUtc(d.interviewAt, tz) : new Date(d.interviewAt);
  if (!at || Number.isNaN(at.getTime())) throw invalid("Please correct the highlighted fields.", { interviewAt: "Enter a date and time" });
  if (at.getTime() < Date.now() - 60_000) throw invalid("Please correct the highlighted fields.", { interviewAt: "Choose a time that has not passed" });
  await db.$transaction(async (tx) => {
    const c = await tx.staffCandidate.findFirst({ where: { id, schoolId: ctx.schoolId } });
    if (!c) throw notFound("Candidate");
    if (!["APPLIED", "INTERVIEW_SCHEDULED"].includes(c.status)) throw conflict("This candidate is past the interview stage.");
    if (d.interviewerId) {
      if (!(await tx.user.findFirst({ where: { id: d.interviewerId, schoolId: ctx.schoolId, type: "STAFF", status: "ACTIVE" }, select: { id: true } }))) throw invalid("Please correct the highlighted fields.", { interviewerId: "Choose an active staff member" });
      const clash = await tx.staffCandidate.findFirst({ where: { schoolId: ctx.schoolId, id: { not: id }, status: "INTERVIEW_SCHEDULED", interviewerId: d.interviewerId, interviewAt: { gt: new Date(at.getTime() - 30 * 60_000), lt: new Date(at.getTime() + 30 * 60_000) } }, select: { candidateNo: true } });
      if (clash) throw conflict(`This interviewer already has an interview at that time (${clash.candidateNo}).`);
    }
    await tx.staffCandidate.update({ where: { id }, data: { status: "INTERVIEW_SCHEDULED", interviewAt: at, interviewLocation: d.location ?? null, interviewerId: d.interviewerId ?? null } });
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Candidate", relatedId: id, kinds: ["CANDIDATE_REVIEW"], by: ctx.userId, note: "Interview scheduled" });
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Candidate", relatedId: id, kinds: ["CANDIDATE_INTERVIEW"], status: "CANCELLED", by: ctx.userId, note: "Interview moved" });
    await openTask(tx, { schoolId: ctx.schoolId, kind: "CANDIDATE_INTERVIEW", relatedType: "Candidate", relatedId: id, relatedLabel: label(c), sourceEvent: "candidate.interview_scheduled", assignedToId: d.interviewerId ?? null, dueOn: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())), createdById: ctx.userId, discriminator: at.toISOString() });
    await writeAudit(tx, actorOf(ctx), { action: "candidate.interview_schedule", entityType: "StaffCandidate", entityId: id, summary: label(c), changes: { at: at.toISOString(), interviewerId: d.interviewerId ?? null } });
  });
}

const resultSchema = z.object({ outcome: z.enum(["PASSED", "NOT_PASSED"]), score: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.coerce.number().int().min(0).max(100).optional()), notes: optText(2000), suitability: optText(1000) });

/** The interviewer or recruitment staff record what happened and the Academic Office's view of qualifications and subject fit. */
export async function recordCandidateResult(ctx: AuthContext, id: string, input: unknown) {
  const d = parse(resultSchema, input);
  const c0 = await db.staffCandidate.findFirst({ where: { id, schoolId: ctx.schoolId }, select: { interviewerId: true } });
  if (!c0) throw notFound("Candidate");
  if (c0.interviewerId !== ctx.userId) requirePermission(ctx, "staff.recruit");
  await db.$transaction(async (tx) => {
    const c = await tx.staffCandidate.findUniqueOrThrow({ where: { id } });
    if (c.status !== "INTERVIEW_SCHEDULED") throw conflict("There is no scheduled interview to record.");
    if ((c.interviewAt?.getTime() ?? 0) > Date.now()) throw conflict("The interview has not taken place yet.");
    await tx.staffCandidate.update({ where: { id }, data: { status: "AWAITING_DECISION", interviewOutcome: d.outcome, interviewScore: d.score ?? null, interviewNotes: d.notes ?? null, suitability: d.suitability ?? null, notes: c.notes } });
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Candidate", relatedId: id, kinds: ["CANDIDATE_INTERVIEW"], by: ctx.userId, note: `Interview ${d.outcome}` });
    await openTask(tx, { schoolId: ctx.schoolId, kind: "CANDIDATE_DECISION", relatedType: "Candidate", relatedId: id, relatedLabel: `${label(c)} · ${d.outcome}`, sourceEvent: "candidate.interviewed", createdById: ctx.userId });
    await writeAudit(tx, actorOf(ctx), { action: "candidate.interview_result", entityType: "StaffCandidate", entityId: id, summary: label(c), changes: { outcome: d.outcome, score: d.score ?? null } });
  });
}

const decideSchema = z.object({ decision: z.enum(["ACCEPT", "REJECT"]), reason: optText(500) });

/** Employment decisions are management's: needs staff.recruit.decide, and never the person who took the candidate in. */
export async function decideCandidate(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "staff.recruit.decide");
  const d = parse(decideSchema, input);
  if (d.decision === "REJECT" && !d.reason) throw invalid("Say why.", { reason: "Required" });
  await db.$transaction(async (tx) => {
    const c = await tx.staffCandidate.findFirst({ where: { id, schoolId: ctx.schoolId } });
    if (!c) throw notFound("Candidate");
    if (!["AWAITING_DECISION", "INTERVIEWED", "APPLIED", "INTERVIEW_SCHEDULED"].includes(c.status)) throw conflict("A decision has already been made.");
    if (c.status !== "AWAITING_DECISION") throw conflict("The decision follows the interview. Record its result first.");
    if (c.createdById === ctx.userId) throw conflict("The decision must be made by someone other than the person who recorded the candidate.");
    await tx.staffCandidate.update({ where: { id }, data: { status: d.decision === "ACCEPT" ? "ACCEPTED" : "REJECTED", decidedById: ctx.userId, decidedAt: new Date(), decisionReason: d.reason ?? null } });
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Candidate", relatedId: id, kinds: ["CANDIDATE_DECISION"], by: ctx.userId, note: d.decision === "ACCEPT" ? "Accepted" : "Rejected" });
    if (d.decision === "ACCEPT") await openTask(tx, { schoolId: ctx.schoolId, kind: "STAFF_ONBOARDING", relatedType: "Candidate", relatedId: id, relatedLabel: label(c), sourceEvent: "candidate.accepted", createdById: ctx.userId });
    else await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Candidate", relatedId: id, status: "CANCELLED", by: ctx.userId, note: "Rejected" });
    await writeAudit(tx, actorOf(ctx), { action: d.decision === "ACCEPT" ? "candidate.accept" : "candidate.reject", entityType: "StaffCandidate", entityId: id, summary: label(c), reason: d.reason });
  });
}

const onboardSchema = z.object({ startDate: optDateOnly(), jobTitle: optText(80) });

export async function startOnboarding(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "staff.onboard");
  const d = parse(onboardSchema, input);
  await db.$transaction(async (tx) => {
    const c = await tx.staffCandidate.findFirst({ where: { id, schoolId: ctx.schoolId } });
    if (!c) throw notFound("Candidate");
    if (c.status !== "ACCEPTED") throw conflict("Onboarding starts after the candidate has been accepted.");
    await tx.staffCandidate.update({ where: { id }, data: { status: "ONBOARDING", startDate: d.startDate ?? null, jobTitle: d.jobTitle ?? c.positionApplied } });
    await writeAudit(tx, actorOf(ctx), { action: "candidate.onboarding_start", entityType: "StaffCandidate", entityId: id, summary: label(c) });
  });
}

const docSchema = z.object({ docType: text(80), received: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()), receivedOn: optDateOnly(), note: optText(300) });

export async function recordCandidateDocument(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "staff.onboard");
  const d = parse(docSchema, input);
  await db.$transaction(async (tx) => {
    const c = await tx.staffCandidate.findFirst({ where: { id, schoolId: ctx.schoolId } });
    if (!c) throw notFound("Candidate");
    if (!["ACCEPTED", "ONBOARDING"].includes(c.status)) throw conflict("Employment papers are recorded once the candidate is accepted.");
    await tx.candidateDocument.upsert({
      where: { candidateId_docType: { candidateId: id, docType: d.docType } },
      create: { schoolId: ctx.schoolId, candidateId: id, docType: d.docType, received: d.received, receivedOn: d.received ? (d.receivedOn ?? null) : null, note: d.note ?? null, recordedById: ctx.userId },
      update: { received: d.received, receivedOn: d.received ? (d.receivedOn ?? null) : null, note: d.note ?? null, recordedById: ctx.userId },
    });
    await writeAudit(tx, actorOf(ctx), { action: "candidate.document", entityType: "StaffCandidate", entityId: id, summary: label(c), changes: { docType: d.docType, received: d.received } });
  });
}

/** Approves the employment: management confirms, once the required papers are in. Never the person who recorded the candidate. */
export async function approveEmployment(ctx: AuthContext, id: string) {
  requirePermission(ctx, "staff.recruit.decide");
  const settings = await getRecruitmentSettings(ctx.schoolId);
  await db.$transaction(async (tx) => {
    const c = await tx.staffCandidate.findFirst({ where: { id, schoolId: ctx.schoolId }, include: { documents: true } });
    if (!c) throw notFound("Candidate");
    if (c.status !== "ONBOARDING") throw conflict("Employment can be approved while onboarding.");
    if (c.employmentApprovedAt) return;
    if (c.createdById === ctx.userId) throw conflict("Employment must be approved by someone other than the person who recorded the candidate.");
    const missing = settings.requiredDocs.filter((doc) => !c.documents.some((x) => x.docType.toLowerCase() === doc.toLowerCase() && x.received));
    if (missing.length) throw conflict(`These employment papers have not been received: ${missing.join(", ")}.`);
    await tx.staffCandidate.update({ where: { id }, data: { employmentApprovedById: ctx.userId, employmentApprovedAt: new Date() } });
    await writeAudit(tx, actorOf(ctx), { action: "candidate.employment_approve", entityType: "StaffCandidate", entityId: id, summary: label(c) });
  });
}

const activateSchema = z.object({ email: optEmailField(), phone: optPhoneField(), roleIds: z.array(uuid()).default([]) });

/**
 * Creates the staff account for an approved candidate (needs user.create, so only people allowed to make accounts), links it, and hands
 * the new teacher to the Academic Office for classes and subjects and to Finance for payroll set-up. Repeating it never makes a second account.
 */
export async function activateEmployee(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "staff.onboard");
  requirePermission(ctx, "user.create");
  const d = parse(activateSchema, { ...(input as object), roleIds: Array.isArray((input as Record<string, unknown>)?.roleIds) ? (input as Record<string, unknown>).roleIds : (input as Record<string, unknown>)?.roleIds ? [(input as Record<string, unknown>).roleIds] : [] });
  const c = await db.staffCandidate.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!c) throw notFound("Candidate");
  if (c.status === "ACTIVE" && c.userId) throw conflict("This employee already has an account.");
  if (c.status !== "ONBOARDING" || !c.employmentApprovedAt) throw conflict("Employment must be approved before an account is created.");
  const email = d.email ?? c.email ?? undefined;
  const phone = d.phone ?? c.phone ?? undefined;
  if (!email && !phone) throw invalid("Please correct the highlighted fields.", { email: "Provide an email address or a phone number" });
  const { user, temporaryPassword } = await createStaffUser(ctx, { fullName: c.fullName, email, phone, jobTitle: c.jobTitle ?? c.positionApplied, employedOn: c.startDate ? formatDateOnly(c.startDate) : undefined, roleIds: d.roleIds });
  await db.$transaction(async (tx) => {
    await tx.staffCandidate.update({ where: { id }, data: { status: "ACTIVE", userId: user.id } });
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Candidate", relatedId: id, kinds: ["STAFF_ONBOARDING"], by: ctx.userId, note: "Account created" });
    const base = { schoolId: ctx.schoolId, relatedType: "Staff", relatedId: user.id, createdById: ctx.userId };
    await openTask(tx, { ...base, kind: "TEACHING_ASSIGNMENT", relatedLabel: `${c.fullName} · ${c.jobTitle ?? c.positionApplied}${c.subjects ? ` · ${c.subjects}` : ""}`, sourceEvent: "employee.activated" });
    // Finance gets who the employee is and when they start. No salary is held here and nothing is paid because of this task.
    await openTask(tx, { ...base, kind: "PAYROLL_ONBOARDING", relatedLabel: `${c.fullName} · ${c.jobTitle ?? c.positionApplied}${c.startDate ? ` · starts ${formatDateOnly(c.startDate)}` : ""}`, sourceEvent: "employee.activated" });
    await writeAudit(tx, actorOf(ctx), { action: "candidate.activate", entityType: "StaffCandidate", entityId: id, summary: label(c), changes: { userId: user.id } });
  });
  return { userId: user.id, temporaryPassword };
}

export async function listCandidates(ctx: AuthContext, opts: { status?: string } = {}) {
  requireAnyPermission(ctx, ["staff.recruit", "staff.recruit.decide"]);
  const where = { schoolId: ctx.schoolId, ...(opts.status === "open" ? { status: { in: [...ACTIVE] } } : opts.status ? { status: opts.status as never } : {}) };
  return db.staffCandidate.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
}

/** The candidate with their papers. Interview notes and the recruiter's notes are shown only to those who decide, the recorder and the interviewer. */
export async function getCandidate(ctx: AuthContext, id: string) {
  requireAnyPermission(ctx, ["staff.recruit", "staff.recruit.decide"]);
  const c = await db.staffCandidate.findFirst({ where: { id, schoolId: ctx.schoolId }, include: { documents: { orderBy: { docType: "asc" } } } });
  if (!c) throw notFound("Candidate");
  const sensitive = ctx.permissions.has("staff.recruit.decide") || c.createdById === ctx.userId || c.interviewerId === ctx.userId;
  const names = await db.user.findMany({ where: { schoolId: ctx.schoolId, id: { in: [c.interviewerId, c.decidedById, c.employmentApprovedById, c.createdById].filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
  const nm = (x: string | null) => names.find((u) => u.id === x)?.fullName ?? null;
  return { ...c, notes: sensitive ? c.notes : null, interviewNotes: sensitive ? c.interviewNotes : null, interviewer: nm(c.interviewerId), decidedBy: nm(c.decidedById), approvedBy: nm(c.employmentApprovedById), recordedBy: nm(c.createdById), settings: await getRecruitmentSettings(ctx.schoolId) };
}
