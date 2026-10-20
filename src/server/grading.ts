import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Db, type Tx } from "@/lib/db";
import { conflict, invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { DEFAULT_POLICY, validateBands, type Band, type DivisionRuleDef, type Policy } from "@/lib/results/engine";
import { actorOf, writeAudit } from "@/server/audit";
import { checkbox, optText, optUuid, parse, text } from "@/lib/validation";

/*
 * Grading scales are school data: nothing official is hard-coded. The only built-in content is the optional
 * TEMPLATES below, which merely pre-fill the form; a scale exists only after an authorised user saves it.
 */

export type ScaleTemplate = { key: string; name: string; note: string; bands: string; divisions: string; divisionBestN: number | null };

export const TEMPLATES: ScaleTemplate[] = [
  {
    key: "tz-olevel-csee",
    name: "Tanzania O-Level (CSEE pattern)",
    note: "A widely published national pattern for Forms I–IV. Check every boundary against the school's approved grading policy before saving.",
    bands: "A | 75 | 100 | 1\nB | 65 | 74 | 2\nC | 45 | 64 | 3\nD | 30 | 44 | 4\nF | 0 | 29 | 5",
    divisions: "I | 7 | 17\nII | 18 | 21\nIII | 22 | 25\nIV | 26 | 33\n0 | 34 | 35",
    divisionBestN: 7,
  },
];

const bandLine = /^\s*([^|]+?)\s*\|\s*(-?\d+(?:\.\d+)?)\s*\|\s*(-?\d+(?:\.\d+)?)\s*(?:\|\s*(-?\d+))?\s*(?:\|\s*(.*))?$/;
export function parseBands(raw: string): Band[] {
  return raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l, i) => {
    const m = bandLine.exec(l);
    if (!m) throw invalid("Please correct the highlighted fields.", { bands: `Line ${i + 1}: use  Grade | min | max | points` });
    return { grade: m[1]!.trim(), min: Number(m[2]), max: Number(m[3]), points: m[4] === undefined || m[4] === "" ? null : Number(m[4]) };
  });
}
const divLine = /^\s*([^|]+?)\s*\|\s*(-?\d+)\s*\|\s*(-?\d+)\s*$/;
export function parseDivisions(raw: string | undefined): DivisionRuleDef[] {
  return (raw ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l, i) => {
    const m = divLine.exec(l);
    if (!m) throw invalid("Please correct the highlighted fields.", { divisions: `Line ${i + 1}: use  Division | min points | max points` });
    return { division: m[1]!.trim(), minPoints: Number(m[2]), maxPoints: Number(m[3]) };
  });
}

const scaleSchema = z.object({
  name: text(80),
  levelId: optUuid(),
  bands: z.string().trim().min(1, "Add at least one grade band"),
  divisions: optText(1000),
  divisionBestN: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.coerce.number().int().min(1).max(20).optional()),
  passMark: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.coerce.number().min(0).max(100).optional()),
  isDefault: checkbox(),
  isActive: z.preprocess((v) => (v === undefined ? true : v === "on" || v === true || v === "true"), z.boolean()),
  notes: optText(500),
});

function validateScale(d: z.infer<typeof scaleSchema>) {
  const bands = parseBands(d.bands);
  const err = validateBands(bands);
  if (err) throw invalid("Please correct the highlighted fields.", { bands: err });
  const divisions = parseDivisions(d.divisions);
  if (divisions.length && !d.divisionBestN) throw invalid("Please correct the highlighted fields.", { divisionBestN: "Enter how many best subjects decide the division" });
  if (divisions.length && bands.some((b) => b.points === null)) throw invalid("Please correct the highlighted fields.", { bands: "Every band needs points when division rules are used" });
  const rs = [...divisions].sort((a, b) => a.minPoints - b.minPoints);
  for (let i = 1; i < rs.length; i++) if (rs[i]!.minPoints <= rs[i - 1]!.maxPoints) throw invalid("Please correct the highlighted fields.", { divisions: `Divisions ${rs[i - 1]!.division} and ${rs[i]!.division} overlap` });
  return { bands, divisions };
}

export async function listScales(ctx: AuthContext) {
  requirePermission(ctx, "exam.read");
  return db.gradingScale.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], include: { bands: { orderBy: { minPercent: "desc" } }, divisions: { orderBy: { minPoints: "asc" } } } });
}

async function saveScaleTx(tx: Tx, ctx: AuthContext, id: string | null, d: z.infer<typeof scaleSchema>) {
  const { bands, divisions } = validateScale(d);
  if (d.levelId && !(await tx.academicLevel.findFirst({ where: { id: d.levelId, schoolId: ctx.schoolId }, select: { id: true } }))) throw notFound("Level");
  if (d.isDefault) await tx.gradingScale.updateMany({ where: { schoolId: ctx.schoolId, isDefault: true, ...(id ? { id: { not: id } } : {}) }, data: { isDefault: false } });
  const data = { name: d.name, levelId: d.levelId ?? null, isDefault: d.isDefault, isActive: d.isActive, passMark: d.passMark ?? null, divisionBestN: d.divisions ? (d.divisionBestN ?? null) : null, notes: d.notes ?? null };
  const scale = id ? await tx.gradingScale.update({ where: { id }, data }) : await tx.gradingScale.create({ data: { ...data, schoolId: ctx.schoolId } });
  await tx.gradeBand.deleteMany({ where: { scaleId: scale.id } });
  await tx.divisionRule.deleteMany({ where: { scaleId: scale.id } });
  await tx.gradeBand.createMany({ data: bands.map((b, i) => ({ scaleId: scale.id, grade: b.grade, minPercent: b.min, maxPercent: b.max, points: b.points, sortOrder: i })) });
  if (divisions.length) await tx.divisionRule.createMany({ data: divisions.map((r, i) => ({ scaleId: scale.id, division: r.division, minPoints: r.minPoints, maxPoints: r.maxPoints, sortOrder: i })) });
  await writeAudit(tx, actorOf(ctx), { action: id ? "grading.update" : "grading.create", entityType: "GradingScale", entityId: scale.id, summary: scale.name, changes: { bands: bands.length, divisions: divisions.length } });
  return scale;
}

export async function createScale(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "grading.manage");
  const d = parse(scaleSchema, input);
  if (await db.gradingScale.findUnique({ where: { schoolId_name: { schoolId: ctx.schoolId, name: d.name } } })) throw invalid("Please correct the highlighted fields.", { name: "A scale with this name already exists" });
  return db.$transaction((tx) => saveScaleTx(tx, ctx, null, d));
}

/**
 * Editing a scale never changes results that are already locked: those carry their own grade snapshot.
 * New results (and a re-lock after an audited unlock) use the edited bands.
 */
export async function updateScale(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "grading.manage");
  const d = parse(scaleSchema, input);
  const existing = await db.gradingScale.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!existing) throw notFound("Grading scale");
  if (d.name !== existing.name && (await db.gradingScale.findUnique({ where: { schoolId_name: { schoolId: ctx.schoolId, name: d.name } } }))) throw invalid("Please correct the highlighted fields.", { name: "A scale with this name already exists" });
  return db.$transaction((tx) => saveScaleTx(tx, ctx, id, d));
}

export async function deleteScale(ctx: AuthContext, id: string) {
  requirePermission(ctx, "grading.manage");
  const scale = await db.gradingScale.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!scale) throw notFound("Grading scale");
  const [exams, marks] = await Promise.all([db.exam.count({ where: { schoolId: ctx.schoolId, gradingScaleId: id } }), db.mark.count({ where: { schoolId: ctx.schoolId, lockedScaleId: id } })]);
  if (exams || marks) throw conflict("This scale is used by examinations or locked results. Deactivate it instead of deleting.");
  await db.$transaction(async (tx) => {
    await tx.gradingScale.delete({ where: { id } });
    await writeAudit(tx, actorOf(ctx), { action: "grading.delete", entityType: "GradingScale", entityId: id, summary: scale.name });
  });
}

export type ResolvedScale = { id: string; name: string; bands: Band[]; divisions: DivisionRuleDef[]; divisionBestN: number | null; passMark: number | null };

/** The scale for an exam: the exam's own, else an active scale for the class's level, else the school default. */
export async function resolveScale(client: Db | Tx, schoolId: string, opts: { examScaleId?: string | null; levelId?: string | null }): Promise<ResolvedScale | null> {
  const include = { bands: true, divisions: true } satisfies Prisma.GradingScaleInclude;
  const row =
    (opts.examScaleId ? await client.gradingScale.findFirst({ where: { id: opts.examScaleId, schoolId }, include }) : null) ??
    (opts.levelId ? await client.gradingScale.findFirst({ where: { schoolId, levelId: opts.levelId, isActive: true }, include, orderBy: { name: "asc" } }) : null) ??
    (await client.gradingScale.findFirst({ where: { schoolId, isDefault: true, isActive: true }, include }));
  if (!row) return null;
  return {
    id: row.id, name: row.name, divisionBestN: row.divisionBestN, passMark: row.passMark ? Number(row.passMark) : null,
    bands: row.bands.map((b) => ({ grade: b.grade, min: Number(b.minPercent), max: Number(b.maxPercent), points: b.points })),
    divisions: row.divisions.map((r) => ({ division: r.division, minPoints: r.minPoints, maxPoints: r.maxPoints })),
  };
}

// ───────────────────────── School-wide results policy ─────────────────────────

export type ResultsSettings = Policy & { requireAllMarksBeforeSubmit: boolean };
export const DEFAULT_RESULTS_SETTINGS: ResultsSettings = { ...DEFAULT_POLICY, requireAllMarksBeforeSubmit: true };

export async function getResultsSettings(client: Db | Tx, schoolId: string): Promise<ResultsSettings> {
  const row = await client.schoolSetting.findUnique({ where: { schoolId_key: { schoolId, key: "results" } } });
  const s = (row?.value ?? {}) as Partial<ResultsSettings>;
  return {
    absentAs: s.absentAs === "ZERO" ? "ZERO" : "EXCLUDE",
    decimals: s.decimals === 2 ? 2 : s.decimals === 0 ? 0 : 1,
    positionBy: s.positionBy === "TOTAL" ? "TOTAL" : "AVERAGE",
    requireAllMarksBeforeSubmit: s.requireAllMarksBeforeSubmit ?? true,
  };
}

const settingsSchema = z.object({
  absentAs: z.enum(["EXCLUDE", "ZERO"]),
  decimals: z.coerce.number().int().min(0).max(2),
  positionBy: z.enum(["AVERAGE", "TOTAL"]),
  requireAllMarksBeforeSubmit: checkbox(),
});

export async function updateResultsSettings(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "grading.manage");
  const d = parse(settingsSchema, input);
  const before = await getResultsSettings(db, ctx.schoolId);
  await db.$transaction(async (tx) => {
    await tx.schoolSetting.upsert({ where: { schoolId_key: { schoolId: ctx.schoolId, key: "results" } }, create: { schoolId: ctx.schoolId, key: "results", value: d, updatedById: ctx.userId }, update: { value: d, updatedById: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "results.settings_update", entityType: "SchoolSetting", entityId: "results", changes: { before, after: d } });
  });
}
