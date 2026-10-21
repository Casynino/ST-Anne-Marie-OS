import { z } from "zod";
import { db, type Db, type Tx } from "@/lib/db";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { centsOf } from "@/lib/finance/money";
import { formatDateOnly } from "@/lib/dates";
import { actorOf, writeAudit } from "@/server/audit";
import { loadAdmissionAccount } from "@/server/admission-offers";
import { examSummaryOf } from "@/server/admission-exams";
import { getFeeSettings } from "@/server/fees";
import { dateOnly, parse } from "@/lib/validation";
import type { AccountStatus } from "@/lib/admissions/rules";

/*
 * The joining instructions of an accepted applicant: what the family has to pay and how, what to bring, when to report, and the entrance results.
 * One document for everyone who may see it: staff print it, and the family reads and downloads it in their account. Nothing is invented:
 * the amounts come from the admission offer and Finance's verified payments, how to pay is exactly what the school typed in Fee settings, and what
 * to bring and the reporting date are what the school typed in Admission rules.
 */

type Client = Db | Tx;
const KEY = "admission_joining";

export type JoiningSettings = { reportingOn: string | null; reportingNote: string; bringList: string[]; notes: string };
const EMPTY: JoiningSettings = { reportingOn: null, reportingNote: "", bringList: [], notes: "" };

export async function getJoiningSettings(client: Client, schoolId: string): Promise<JoiningSettings> {
  const row = await client.schoolSetting.findUnique({ where: { schoolId_key: { schoolId, key: KEY } } });
  const s = (row?.value ?? {}) as Partial<JoiningSettings>;
  return {
    reportingOn: typeof s.reportingOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.reportingOn) ? s.reportingOn : EMPTY.reportingOn,
    reportingNote: typeof s.reportingNote === "string" ? s.reportingNote : "",
    bringList: Array.isArray(s.bringList) ? s.bringList.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [],
    notes: typeof s.notes === "string" ? s.notes : "",
  };
}

const schema = z.object({
  reportingOn: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), dateOnly().optional()),
  reportingNote: z.string().trim().max(300).optional(),
  bringList: z.string().max(2000).optional(),
  notes: z.string().trim().max(1500).optional(),
});

export async function updateJoiningSettings(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "school.settings.update");
  const d = parse(schema, input);
  const before = await getJoiningSettings(db, ctx.schoolId);
  const value: JoiningSettings = {
    reportingOn: d.reportingOn ? formatDateOnly(d.reportingOn) : null,
    reportingNote: d.reportingNote ?? "",
    bringList: (d.bringList ?? "").split(/\r?\n/).map((x) => x.trim().replace(/^[-•*]\s*/, "")).filter(Boolean).slice(0, 40),
    notes: d.notes ?? "",
  };
  await db.$transaction(async (tx) => {
    await tx.schoolSetting.upsert({ where: { schoolId_key: { schoolId: ctx.schoolId, key: KEY } }, create: { schoolId: ctx.schoolId, key: KEY, value, updatedById: ctx.userId }, update: { value, updatedById: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "settings.admission_joining_update", entityType: "SchoolSetting", entityId: KEY, changes: { before, after: value } });
  });
}

export type JoiningView = {
  applicationId: string; applicationNo: string; applicantName: string; className: string | null; acceptedOn: Date | null; letterNo: string | null; studentId: string | null;
  school: { name: string; motto: string | null; address: string | null; phone: string | null; email: string | null; timezone: string; currency: string };
  fee: { requiredCents: number; verifiedCents: number; balanceCents: number; pendingCents: number; status: AccountStatus; reference: string; howToPay: string };
  results: { subject: string; mark: number | null; outcome: string | null; maxMark: number }[]; average: number | null; passMark: number | null;
  settings: JoiningSettings;
};

/**
 * The joining instructions for an application. Staff who read admissions open it by the application id; the family that applied opens it by the
 * id of their own application (the draft). Only an accepted (or registered) applicant has them; anybody else's is "not found".
 */
export async function joiningView(ctx: AuthContext, id: string): Promise<JoiningView> {
  let applicationId: string | null = null;
  if (ctx.userType === "STAFF") {
    requirePermission(ctx, "admission.read");
    applicationId = (await db.application.findFirst({ where: { id, schoolId: ctx.schoolId }, select: { id: true } }))?.id ?? null;
  } else if (ctx.userType === "GUARDIAN") {
    applicationId = (await db.applicationDraft.findFirst({ where: { id, schoolId: ctx.schoolId, userId: ctx.userId }, select: { applicationId: true } }))?.applicationId ?? null;
  } else throw forbidden();
  if (!applicationId) throw notFound("Application");
  const app = await db.application.findFirst({ where: { id: applicationId, schoolId: ctx.schoolId }, select: { id: true, applicationNo: true, firstName: true, middleName: true, lastName: true, status: true, classAppliedId: true, decidedAt: true, studentId: true } });
  if (!app) throw notFound("Application");
  if (app.status !== "ACCEPTED" && app.status !== "ENROLLED") throw conflict("Joining instructions are available once the applicant has been accepted.");
  const [school, { offer, account }, feeSettings, settings, summary] = await Promise.all([
    db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { name: true, motto: true, address: true, phone: true, email: true, timezone: true, currency: true } }),
    loadAdmissionAccount(db, ctx.schoolId, app.id),
    getFeeSettings(db, ctx.schoolId),
    getJoiningSettings(db, ctx.schoolId),
    examSummaryOf(db, ctx.schoolId, app.id),
  ]);
  const classId = offer?.classOfferedId ?? app.classAppliedId;
  const cls = classId ? await db.schoolClass.findFirst({ where: { id: classId, schoolId: ctx.schoolId }, select: { name: true } }) : null;
  // The entrance results are shown once they are all final: marks only, never the teachers' comments.
  const final = summary.progress.state === "COMPLETE" && summary.lines.length > 0;
  return {
    applicationId: app.id, applicationNo: app.applicationNo, applicantName: [app.firstName, app.middleName, app.lastName].filter(Boolean).join(" "), className: cls?.name ?? null,
    acceptedOn: app.decidedAt, letterNo: offer?.letterNo ?? null, studentId: app.studentId, school,
    fee: {
      requiredCents: account?.requiredCents ?? (offer ? centsOf(offer.feeAmount) : 0), verifiedCents: account?.verifiedCents ?? 0, balanceCents: account?.balanceCents ?? 0, pendingCents: account?.pendingCents ?? 0,
      status: account?.status ?? "NOT_REQUIRED", reference: app.applicationNo, howToPay: feeSettings.paymentInstructions.trim(),
    },
    results: final ? summary.lines.map((l) => ({ subject: l.subject, mark: l.mark, outcome: l.outcome, maxMark: l.maxMark })) : [], average: final ? summary.average : null, passMark: final ? summary.passMark : null,
    settings,
  };
}
