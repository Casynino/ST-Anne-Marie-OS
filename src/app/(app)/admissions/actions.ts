"use server";

import { run, str, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import { db } from "@/lib/db";
import * as admissions from "@/server/admissions";
import * as documents from "@/server/documents";
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

const DETAIL_FIELDS = ["firstName", "middleName", "lastName", "dateOfBirth", "gender", "classAppliedId", "nationality", "religion", "birthCertificateNo", "previousSchool", "address", "assessmentNotes", "confirmDuplicate"] as const;
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
    await admissions.transitionApplication(ctx, str(i.id), { to: str(i.to), reason: i.reason, interviewOn: i.interviewOn, assessmentNotes: i.assessmentNotes });
    return { message: makeT(ctx.locale)("common.saved") };
  });
}

export async function enrolApplicationAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const [classId, streamId] = str(i.placement).split("|");
    const student = await admissions.enrolApplication(ctx, str(i.id), { classId: classId || undefined, streamId: streamId || undefined, admissionDate: i.admissionDate, confirmDuplicate: i.confirmDuplicate, confirmSharedPhone: i.confirmSharedPhone });
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
