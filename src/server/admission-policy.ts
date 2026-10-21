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
};
export type AssessmentRule = "NONE" | "INTERVIEW" | "EXAM" | "BOTH";
const RULES: readonly AssessmentRule[] = ["NONE", "INTERVIEW", "EXAM", "BOTH"];

export const DEFAULT_POLICY: AdmissionPolicy = {
  requireInterview: false,
  requiredDocTypes: [],
  admissionFeeCents: 0,
  requirePaymentBeforeEnrol: true,
  offerValidDays: 0,
  offerNeedsApproval: false,
  allowDirectRegistration: true,
  interviewMinutes: 30,
  paymentNeedsSecondPerson: false,
  assessmentByLevel: {},
};

const KEY = "admission_policy";

export async function getAdmissionPolicy(client: Db | Tx, schoolId: string): Promise<AdmissionPolicy> {
  const row = await client.schoolSetting.findUnique({ where: { schoolId_key: { schoolId, key: KEY } } });
  const s = (row?.value ?? {}) as Partial<AdmissionPolicy>;
  const d = DEFAULT_POLICY;
  return {
    requireInterview: typeof s.requireInterview === "boolean" ? s.requireInterview : d.requireInterview,
    requiredDocTypes: Array.isArray(s.requiredDocTypes) ? s.requiredDocTypes.filter((x): x is string => (DOCUMENT_TYPES as readonly string[]).includes(x as string)) : d.requiredDocTypes,
    admissionFeeCents: Number.isInteger(s.admissionFeeCents) && (s.admissionFeeCents as number) >= 0 ? (s.admissionFeeCents as number) : d.admissionFeeCents,
    requirePaymentBeforeEnrol: typeof s.requirePaymentBeforeEnrol === "boolean" ? s.requirePaymentBeforeEnrol : d.requirePaymentBeforeEnrol,
    offerValidDays: Number.isInteger(s.offerValidDays) ? (s.offerValidDays as number) : d.offerValidDays,
    offerNeedsApproval: typeof s.offerNeedsApproval === "boolean" ? s.offerNeedsApproval : d.offerNeedsApproval,
    allowDirectRegistration: typeof s.allowDirectRegistration === "boolean" ? s.allowDirectRegistration : d.allowDirectRegistration,
    interviewMinutes: Number.isInteger(s.interviewMinutes) ? (s.interviewMinutes as number) : d.interviewMinutes,
    paymentNeedsSecondPerson: typeof s.paymentNeedsSecondPerson === "boolean" ? s.paymentNeedsSecondPerson : d.paymentNeedsSecondPerson,
    assessmentByLevel: Object.fromEntries(Object.entries(s.assessmentByLevel ?? {}).filter(([, v]) => (RULES as readonly string[]).includes(v as string))) as Record<string, AssessmentRule>,
  };
}

const schema = z.object({
  requireInterview: checkbox(),
  requiredDocTypes: z.preprocess((v) => (v === undefined || v === "" ? [] : Array.isArray(v) ? v : [v]), z.array(z.enum(DOCUMENT_TYPES))),
  admissionFee: z.preprocess((v) => (v === "" || v === undefined ? "0" : v), z.union([z.string(), z.number()])),
  requirePaymentBeforeEnrol: checkbox(),
  offerValidDays: z.coerce.number().int().min(0).max(365),
  offerNeedsApproval: checkbox(),
  allowDirectRegistration: checkbox(),
  interviewMinutes: z.coerce.number().int().min(5).max(480),
  paymentNeedsSecondPerson: checkbox(),
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
    requireInterview: d.requireInterview, requiredDocTypes: [...new Set(d.requiredDocTypes)], admissionFeeCents: fee, requirePaymentBeforeEnrol: d.requirePaymentBeforeEnrol,
    offerValidDays: d.offerValidDays, offerNeedsApproval: d.offerNeedsApproval, allowDirectRegistration: d.allowDirectRegistration, interviewMinutes: d.interviewMinutes, paymentNeedsSecondPerson: d.paymentNeedsSecondPerson, assessmentByLevel: levelIds.length === 0 ? (await getAdmissionPolicy(db, ctx.schoolId)).assessmentByLevel : assessmentByLevel,
  };
  const before = await getAdmissionPolicy(db, ctx.schoolId);
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
