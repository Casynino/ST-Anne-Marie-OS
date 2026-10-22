import { z } from "zod";
import { db, type Db, type Tx } from "@/lib/db";
import { invalid } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { parseAmount } from "@/lib/finance/money";
import { actorOf, writeAudit } from "@/server/audit";
import { DOCUMENT_TYPES } from "@/lib/admissions/document-types";
import { checkbox, parse } from "@/lib/validation";

/*
 * The school's admissions rules, kept in one place (school_settings key "admission_policy") so every screen and every service applies the
 * same ones. Nothing here is hard-coded policy: the defaults only keep the existing flow working until the school decides.
 */

export type AdmissionPolicy = {
  /** An interview with the result Passed is needed before an offer (an authorised exception can skip it). */
  requireInterview: boolean;
  /** Document types that must be verified before an interview, an offer and enrolment. */
  requiredDocTypes: string[];
  /** Papers a child TRANSFERRING from another school must add as well (for example the transfer letter and the last report). */
  transferDocTypes: string[];
  /** An online application must come with a passport photo of the child before the family can confirm and pay. */
  applicationPhotoRequired: boolean;
  /** The fee a family pays online before an application is submitted, in cents (0 = no application fee). */
  applicationFeeCents: number;
  /** The admission fee put on a new offer, in cents (0 = no admission fee). */
  admissionFeeCents: number;
  /** Enrolment needs the admission fee verified (or a recorded exception). */
  requirePaymentBeforeEnrol: boolean;
  /** Days an offer stays valid (0 = it does not expire). */
  offerValidDays: number;
  /** A second person (Head Teacher or Administrator) must approve each offer. */
  offerNeedsApproval: boolean;
  /** Registering a student without an application. Switch off once the school's existing students are in. */
  allowDirectRegistration: boolean;
  /** Default length of an interview, in minutes. */
  interviewMinutes: number;
  /** An admission payment must be verified by someone other than the person who recorded it. */
  paymentNeedsSecondPerson: boolean;
  /** What an applicant to each entry level must sit: an interview, an entrance examination, both or neither. A level not listed follows the school default. */
  assessmentByLevel: Record<string, AssessmentRule>;
  /** The subjects an applicant sits when the school asks for an entrance examination (subject ids). Staff can add or remove a subject for one applicant. */
  examSubjects: string[];
  /** Every usual subject must be assigned a teacher before a decision. Off (default): the teachers the office assigns are the examination. */
  examRequireAll: boolean;
  /** The Academic Office must approve submitted examination results before they count. */
  examApproval: boolean;
  /** The maximum mark of an applicant examination unless one is set for it. */
  examMaxMark: number;
  /** Non-numeric results the school accepts instead of a mark (for example "Pass", "Absent"). Empty = marks only. */
  examOutcomes: string[];
  /** When every required result is final and the average reaches the pass mark, the applicant is accepted by itself (and goes to Awaiting payment). Off = the office decides. */
  examAutoAccept: boolean;
  /** The average, as a percentage of the maximum marks, that counts as a pass. */
  examPassPercent: number;
};
export type AssessmentRule = "NONE" | "INTERVIEW" | "EXAM" | "BOTH";
const RULES: readonly AssessmentRule[] = ["NONE", "INTERVIEW", "EXAM", "BOTH"];

export const DEFAULT_POLICY: AdmissionPolicy = {
  requireInterview: false,
  requiredDocTypes: [],
  transferDocTypes: ["TRANSFER_LETTER", "PREVIOUS_REPORT"],
  applicationPhotoRequired: true,
  applicationFeeCents: 0,
  admissionFeeCents: 0,
  requirePaymentBeforeEnrol: true,
  offerValidDays: 0,
  offerNeedsApproval: false,
  allowDirectRegistration: true,
  interviewMinutes: 30,
  paymentNeedsSecondPerson: false,
  assessmentByLevel: {},
  examSubjects: [],
  examRequireAll: false,
  examApproval: false,
  examMaxMark: 100,
  examOutcomes: [],
  examAutoAccept: false,
  examPassPercent: 50,
};

const KEY = "admission_policy";

export async function getAdmissionPolicy(client: Db | Tx, schoolId: string): Promise<AdmissionPolicy> {
  const row = await client.schoolSetting.findUnique({ where: { schoolId_key: { schoolId, key: KEY } } });
  const s = (row?.value ?? {}) as Partial<AdmissionPolicy>;
  const d = DEFAULT_POLICY;
  return {
    requireInterview: typeof s.requireInterview === "boolean" ? s.requireInterview : d.requireInterview,
    requiredDocTypes: Array.isArray(s.requiredDocTypes) ? s.requiredDocTypes.filter((x): x is string => (DOCUMENT_TYPES as readonly string[]).includes(x as string)) : d.requiredDocTypes,
    transferDocTypes: Array.isArray(s.transferDocTypes) ? s.transferDocTypes.filter((x): x is string => (DOCUMENT_TYPES as readonly string[]).includes(x as string)) : d.transferDocTypes,
    applicationPhotoRequired: typeof s.applicationPhotoRequired === "boolean" ? s.applicationPhotoRequired : d.applicationPhotoRequired,
    applicationFeeCents: Number.isInteger(s.applicationFeeCents) && (s.applicationFeeCents as number) >= 0 ? (s.applicationFeeCents as number) : d.applicationFeeCents,
    admissionFeeCents: Number.isInteger(s.admissionFeeCents) && (s.admissionFeeCents as number) >= 0 ? (s.admissionFeeCents as number) : d.admissionFeeCents,
    requirePaymentBeforeEnrol: typeof s.requirePaymentBeforeEnrol === "boolean" ? s.requirePaymentBeforeEnrol : d.requirePaymentBeforeEnrol,
    offerValidDays: Number.isInteger(s.offerValidDays) ? (s.offerValidDays as number) : d.offerValidDays,
    offerNeedsApproval: typeof s.offerNeedsApproval === "boolean" ? s.offerNeedsApproval : d.offerNeedsApproval,
    allowDirectRegistration: typeof s.allowDirectRegistration === "boolean" ? s.allowDirectRegistration : d.allowDirectRegistration,
    interviewMinutes: Number.isInteger(s.interviewMinutes) ? (s.interviewMinutes as number) : d.interviewMinutes,
    paymentNeedsSecondPerson: typeof s.paymentNeedsSecondPerson === "boolean" ? s.paymentNeedsSecondPerson : d.paymentNeedsSecondPerson,
    assessmentByLevel: Object.fromEntries(Object.entries(s.assessmentByLevel ?? {}).filter(([, v]) => (RULES as readonly string[]).includes(v as string))) as Record<string, AssessmentRule>,
    examSubjects: Array.isArray(s.examSubjects) ? s.examSubjects.filter((x): x is string => typeof x === "string") : d.examSubjects,
    examRequireAll: typeof s.examRequireAll === "boolean" ? s.examRequireAll : d.examRequireAll,
    examApproval: typeof s.examApproval === "boolean" ? s.examApproval : d.examApproval,
    examMaxMark: typeof s.examMaxMark === "number" && s.examMaxMark > 0 && s.examMaxMark <= 1000 ? s.examMaxMark : d.examMaxMark,
    examOutcomes: Array.isArray(s.examOutcomes) ? s.examOutcomes.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : d.examOutcomes,
    examAutoAccept: typeof s.examAutoAccept === "boolean" ? s.examAutoAccept : d.examAutoAccept,
    examPassPercent: typeof s.examPassPercent === "number" && s.examPassPercent >= 1 && s.examPassPercent <= 100 ? s.examPassPercent : d.examPassPercent,
  };
}

const schema = z.object({
  requireInterview: checkbox(),
  requiredDocTypes: z.preprocess((v) => (v === undefined || v === "" ? [] : Array.isArray(v) ? v : [v]), z.array(z.enum(DOCUMENT_TYPES))),
  transferDocTypes: z.preprocess((v) => (v === undefined || v === "" ? undefined : Array.isArray(v) ? v : [v]), z.array(z.enum(DOCUMENT_TYPES)).optional()),
  applicationFee: z.union([z.string(), z.number()]).optional(),
  applicationPhotoRequired: z.preprocess((v) => (v === undefined ? undefined : v === true || v === "on" || v === "true"), z.boolean().optional()),
  admissionFee: z.preprocess((v) => (v === "" || v === undefined ? "0" : v), z.union([z.string(), z.number()])),
  requirePaymentBeforeEnrol: checkbox(),
  offerValidDays: z.coerce.number().int().min(0).max(365),
  offerNeedsApproval: checkbox(),
  allowDirectRegistration: checkbox(),
  interviewMinutes: z.coerce.number().int().min(5).max(480),
  paymentNeedsSecondPerson: checkbox(),
  // The screen always posts examSettings; a caller that leaves it out keeps what is set.
  examSettings: z.string().optional(),
  examSubjects: z.preprocess((v) => (v === undefined || v === "" ? [] : Array.isArray(v) ? v : [v]), z.array(z.string().uuid())),
  examApproval: checkbox(),
  examRequireAll: checkbox(),
  examMaxMark: z.coerce.number().min(1).max(1000).optional(),
  examOutcomes: z.string().max(300).optional(),
  examAutoAccept: checkbox(),
  examPassPercent: z.coerce.number().min(1).max(100).optional(),
});

export async function updateAdmissionPolicy(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "school.settings.update");
  const d = parse(schema, input);
  const fee = parseAmount(d.admissionFee);
  if (fee === null) throw invalid("Please correct the highlighted fields.", { admissionFee: "Enter an amount such as 0 or 50000" });
  // Per-level rules arrive as assessment_<levelId> = NONE | INTERVIEW | EXAM | BOTH (empty = follow the school default).
  const levelIds = Object.keys(input as Record<string, unknown>).filter((k) => k.startsWith("assessment_")).map((k) => k.slice(11));
  const known = new Set((await db.academicLevel.findMany({ where: { schoolId: ctx.schoolId, id: { in: levelIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x)) } }, select: { id: true } })).map((l) => l.id));
  const assessmentByLevel: Record<string, AssessmentRule> = {};
  for (const id of levelIds) {
    const v = String((input as Record<string, unknown>)[`assessment_${id}`] ?? "");
    if (!v) continue;
    if (!known.has(id) || !(RULES as readonly string[]).includes(v)) throw invalid("Please correct the highlighted fields.", { [`assessment_${id}`]: "Choose interview, entrance examination, both or none" });
    assessmentByLevel[id] = v as AssessmentRule;
  }
  const value: AdmissionPolicy = {
    requireInterview: d.requireInterview, requiredDocTypes: [...new Set(d.requiredDocTypes)], transferDocTypes: [], applicationPhotoRequired: true, applicationFeeCents: 0, admissionFeeCents: fee, requirePaymentBeforeEnrol: d.requirePaymentBeforeEnrol,
    offerValidDays: d.offerValidDays, offerNeedsApproval: d.offerNeedsApproval, allowDirectRegistration: d.allowDirectRegistration, interviewMinutes: d.interviewMinutes, paymentNeedsSecondPerson: d.paymentNeedsSecondPerson, assessmentByLevel: levelIds.length === 0 ? (await getAdmissionPolicy(db, ctx.schoolId)).assessmentByLevel : assessmentByLevel,
    examSubjects: [], examRequireAll: false, examApproval: false, examMaxMark: 100, examOutcomes: [], examAutoAccept: false, examPassPercent: 50,
  };
  const before = await getAdmissionPolicy(db, ctx.schoolId);
  if (d.examSettings === undefined) Object.assign(value, { examSubjects: before.examSubjects, examRequireAll: before.examRequireAll, examApproval: before.examApproval, examMaxMark: before.examMaxMark, examOutcomes: before.examOutcomes, examAutoAccept: before.examAutoAccept, examPassPercent: before.examPassPercent });
  else {
    const subjects = [...new Set(d.examSubjects)];
    if (subjects.length && (await db.subject.count({ where: { schoolId: ctx.schoolId, id: { in: subjects }, isActive: true } })) !== subjects.length) throw invalid("Please correct the highlighted fields.", { examSubjects: "Choose subjects the school teaches" });
    Object.assign(value, { examSubjects: subjects, examRequireAll: d.examRequireAll, examApproval: d.examApproval, examMaxMark: d.examMaxMark ?? 100, examOutcomes: [...new Set((d.examOutcomes ?? "").split(",").map((x) => x.trim()).filter(Boolean))].slice(0, 12), examAutoAccept: d.examAutoAccept, examPassPercent: d.examPassPercent ?? 50 });
  }
  // Absent = keep what is set; present but empty = no application fee.
  const applicationFee = d.applicationFee === undefined ? before.applicationFeeCents : d.applicationFee === "" ? 0 : parseAmount(d.applicationFee);
  if (applicationFee === null) throw invalid("Please correct the highlighted fields.", { applicationFee: "Enter an amount such as 0 or 10000" });
  value.applicationFeeCents = applicationFee;
  // The screen posts the fee field, so then an empty list means none are required; a caller that leaves both out keeps what is set.
  value.transferDocTypes = d.applicationFee !== undefined ? [...new Set(d.transferDocTypes ?? [])] : before.transferDocTypes;
  // The screen always posts the fee field, so an unticked box then means "not required"; a caller that leaves both out keeps what is set.
  value.applicationPhotoRequired = d.applicationFee !== undefined ? d.applicationPhotoRequired === true : before.applicationPhotoRequired;
  await db.$transaction(async (tx) => {
    await tx.schoolSetting.upsert({ where: { schoolId_key: { schoolId: ctx.schoolId, key: KEY } }, create: { schoolId: ctx.schoolId, key: KEY, value, updatedById: ctx.userId }, update: { value, updatedById: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "settings.admission_policy_update", entityType: "SchoolSetting", entityId: KEY, changes: { before, after: value } });
  });
}

/** What this school asks of an applicant for an entry level: an interview, an entrance examination, both or neither. Levels without their own rule follow the school default. */
export function assessmentFor(policy: AdmissionPolicy, levelId: string | null): { interview: boolean; exam: boolean } {
  const rule = levelId ? policy.assessmentByLevel[levelId] : undefined;
  if (!rule) return { interview: policy.requireInterview, exam: false };
  return { interview: rule === "INTERVIEW" || rule === "BOTH", exam: rule === "EXAM" || rule === "BOTH" };
}

/** The papers an application needs for its kind: the school's required papers, and for a transfer also the transfer papers. */
export function requiredDocsFor(policy: Pick<AdmissionPolicy, "requiredDocTypes" | "transferDocTypes">, entryType: string | null | undefined): string[] {
  return [...new Set([...policy.requiredDocTypes, ...(entryType === "TRANSFER" ? policy.transferDocTypes : [])])];
}
