import { z } from "zod";
import { db, type Db, type Tx } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { actorOf, diffFields, writeAudit } from "@/server/audit";
import { checkbox, optEmailField, optPhoneField, optText, parse, text } from "@/lib/validation";

export type AdmissionSettings = { prefix: string; pattern: string; seqPadding: number; resetYearly: boolean };

export const DEFAULT_ADMISSION_PATTERN = "{PREFIX}/{YEAR}/{SEQ}";

const admissionSchema = z.object({
  prefix: z.string().trim().min(1, "Required").max(12).regex(/^[A-Za-z0-9-]+$/, "Letters, numbers and dashes only").transform((v) => v.toUpperCase()),
  pattern: z
    .string()
    .trim()
    .max(60)
    .refine((v) => v.includes("{SEQ}"), "The pattern must contain {SEQ}")
    .refine((v) => /^[A-Za-z0-9/\-_.{}]+$/.test(v.replace(/\{(PREFIX|YEAR|YY|SEQ)\}/g, "")), "Only {PREFIX}, {YEAR}, {YY}, {SEQ} and / - _ . are allowed"),
  seqPadding: z.coerce.number().int().min(1).max(8),
  resetYearly: checkbox(),
}).refine((v) => !v.resetYearly || /\{(YEAR|YY)\}/.test(v.pattern), {
  path: ["pattern"],
  message: "Include {YEAR} or {YY} when numbering restarts every year",
});

export async function getAdmissionSettings(client: Db | Tx, schoolId: string): Promise<AdmissionSettings> {
  const [row, school] = await Promise.all([
    client.schoolSetting.findUnique({ where: { schoolId_key: { schoolId, key: "admission" } } }),
    client.school.findUnique({ where: { id: schoolId }, select: { code: true } }),
  ]);
  const stored = (row?.value ?? {}) as Partial<AdmissionSettings>;
  return {
    prefix: stored.prefix ?? school?.code ?? "ADM",
    pattern: stored.pattern ?? DEFAULT_ADMISSION_PATTERN,
    seqPadding: stored.seqPadding ?? 4,
    resetYearly: stored.resetYearly ?? true,
  };
}

export async function ensureDefaultSettings(client: Db | Tx, school: { id: string; code: string }) {
  await client.schoolSetting.upsert({
    where: { schoolId_key: { schoolId: school.id, key: "admission" } },
    create: {
      schoolId: school.id,
      key: "admission",
      value: { prefix: school.code, pattern: DEFAULT_ADMISSION_PATTERN, seqPadding: 4, resetYearly: true },
    },
    update: {},
  });
}

export async function updateAdmissionSettings(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "school.settings.update");
  const data = parse(admissionSchema, input);
  const before = await getAdmissionSettings(db, ctx.schoolId);
  await db.$transaction(async (tx) => {
    await tx.schoolSetting.upsert({
      where: { schoolId_key: { schoolId: ctx.schoolId, key: "admission" } },
      create: { schoolId: ctx.schoolId, key: "admission", value: data, updatedById: ctx.userId },
      update: { value: data, updatedById: ctx.userId },
    });
    await writeAudit(tx, actorOf(ctx), {
      action: "settings.admission_update",
      entityType: "SchoolSetting",
      entityId: "admission",
      changes: diffFields(before, data, ["prefix", "pattern", "seqPadding", "resetYearly"]),
    });
  });
}

export async function getSchoolProfile(ctx: AuthContext) {
  requirePermission(ctx, "school.settings.read");
  const school = await db.school.findUnique({ where: { id: ctx.schoolId } });
  if (!school) throw notFound("School");
  return school;
}

/** Light read for the app shell (name/timezone); no permission needed, scoped to the user's own school. */
export async function getSchoolBasics(schoolId: string) {
  return db.school.findUniqueOrThrow({
    where: { id: schoolId },
    select: { id: true, name: true, code: true, timezone: true, currency: true, defaultLocale: true, motto: true },
  });
}

const timezoneField = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "Unknown timezone");

const schoolSchema = z.object({
  name: text(120),
  motto: optText(160),
  email: optEmailField(),
  phone: optPhoneField(),
  address: optText(300),
  timezone: timezoneField,
  defaultLocale: z.enum(["EN", "SW"]),
});

export async function updateSchoolProfile(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "school.settings.update");
  const data = parse(schoolSchema, input);
  const before = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId } });
  await db.$transaction(async (tx) => {
    await tx.school.update({ where: { id: ctx.schoolId }, data });
    await writeAudit(tx, actorOf(ctx), {
      action: "settings.school_update",
      entityType: "School",
      entityId: ctx.schoolId,
      changes: diffFields(before, data, ["name", "motto", "email", "phone", "address", "timezone", "defaultLocale"]),
    });
  });
}
