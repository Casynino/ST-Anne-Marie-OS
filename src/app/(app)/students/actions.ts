"use server";

import { run, str, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import * as students from "@/server/students";
import * as guardians from "@/server/guardians";

type Input = Record<string, string | string[] | undefined>;

const GUARDIAN_FIELDS = ["guardianId", "fullName", "phone", "altPhone", "email", "occupation", "relationship", "isFinanciallyResponsible", "allowSharedPhone"] as const;

/** Reads one guardian block from a flat form (`g1_fullName`…), making unchecked boxes explicit. */
function guardianFromForm(i: Input, prefix: string, opts: { primary?: boolean } = {}) {
  const g: Record<string, string | undefined> = {};
  for (const f of GUARDIAN_FIELDS) g[f] = str(i[`${prefix}${f}`]) || undefined;
  g.receivesNotifications = str(i[`${prefix}receivesNotifications`]) === "on" ? "on" : "false";
  if (opts.primary) g.isPrimary = "on";
  return g;
}

const hasGuardian = (i: Input, prefix: string) => Boolean(str(i[`${prefix}guardianId`]) || str(i[`${prefix}fullName`]) || str(i[`${prefix}phone`]));

/** Parses "classId" or "classId|streamId" from the combined placement select. */
async function splitPlacement(value: string): Promise<{ classId?: string; streamId?: string }> {
  const [classId, streamId] = value.split("|");
  return { classId: classId || undefined, streamId: streamId || undefined };
}

function mapRegistrationErrors(errors: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(errors)) {
    const g = /^guardians\.(\d+)\.(.+)$/.exec(k);
    const e = /^emergencyContacts\.(\d+)\.(.+)$/.exec(k);
    if (g) out[`g${Number(g[1]) + 1}_${g[2]}`] = v;
    else if (e) out[`ec${Number(e[1]) + 1}_${e[2]}`] = v;
    else if (k === "classId" || k === "streamId") out.placement = v;
    else if (k === "guardians") out.g1_fullName = v;
    else out[k] = v;
  }
  return out;
}

export async function createStudentAction(_: ActionState, form: FormData) {
  return run(
    form,
    async (ctx, i) => {
      const placement = await splitPlacement(str(i.placement));
      const guardianBlocks = [1, 2].filter((n) => n === 1 || hasGuardian(i, `g${n}_`));
      const emergency = [1, 2]
        .filter((n) => str(i[`ec${n}_name`]) || str(i[`ec${n}_phone`]))
        .map((n) => ({ name: str(i[`ec${n}_name`]), relationship: str(i[`ec${n}_relationship`]), phone: str(i[`ec${n}_phone`]) }));
      const student = await students.createStudent(ctx, {
        firstName: i.firstName, middleName: i.middleName, lastName: i.lastName, dateOfBirth: i.dateOfBirth, gender: i.gender,
        admissionDate: i.admissionDate, nationality: i.nationality, religion: i.religion, birthCertificateNo: i.birthCertificateNo,
        previousSchool: i.previousSchool, address: i.address, medicalNotes: i.medicalNotes,
        classId: placement.classId, streamId: placement.streamId,
        guardians: guardianBlocks.map((n) => guardianFromForm(i, `g${n}_`, { primary: n === 1 })),
        emergencyContacts: emergency,
        confirmDuplicate: i.confirmDuplicate,
      });
      return { redirectTo: `/students/${student.id}` };
    },
    { mapFieldErrors: mapRegistrationErrors },
  );
}

export async function updateStudentAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await students.updateStudent(ctx, str(i.id), i);
    return { redirectTo: `/students/${str(i.id)}` };
  });
}

export async function enrollStudentAction(_: ActionState, form: FormData) {
  return run(
    form,
    async (ctx, i) => {
      const placement = await splitPlacement(str(i.placement));
      await students.enrollStudent(ctx, str(i.studentId), { academicYearId: str(i.academicYearId) || undefined, classId: placement.classId, streamId: placement.streamId, overrideCapacity: i.overrideCapacity, overrideReason: i.overrideReason });
      return { message: makeT(ctx.locale)("common.saved") };
    },
    { mapFieldErrors: (e) => ({ ...e, placement: e.classId ?? e.streamId ?? "" }) },
  );
}

export async function changeStatusAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await students.changeStudentStatus(ctx, str(i.studentId), i);
    return { message: makeT(ctx.locale)("common.saved") };
  });
}

export async function linkGuardianAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await guardians.linkGuardian(ctx, str(i.studentId), guardianFromForm(i, ""));
    return { message: makeT(ctx.locale)("common.saved") };
  });
}

export async function updateRelationshipAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await guardians.updateRelationship(ctx, str(i.studentId), str(i.guardianId), i);
    return { message: makeT(ctx.locale)("common.saved") };
  });
}

export async function unlinkGuardianAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await guardians.unlinkGuardian(ctx, str(i.studentId), str(i.guardianId), str(i.reason));
    return { message: makeT(ctx.locale)("common.saved") };
  });
}

export async function verifyGuardianAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await guardians.setRelationshipVerified(ctx, str(i.studentId), str(i.guardianId), str(i.verified) === "true");
    return { message: makeT(ctx.locale)("common.saved") };
  });
}

export async function updateGuardianAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await guardians.updateGuardian(ctx, str(i.guardianId), i);
    return { message: makeT(ctx.locale)("common.saved") };
  });
}
