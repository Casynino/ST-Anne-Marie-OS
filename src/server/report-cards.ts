import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Db, type Tx } from "@/lib/db";
import { AppError, conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { requireAnyPermission, requirePermission, type AuthContext } from "@/lib/auth/context";
import { formatDateOnly } from "@/lib/dates";
import { sameContent, type ReportSnapshot } from "@/lib/results/report-types";
import { actorOf, writeAudit } from "@/server/audit";
import { getAttendanceSettings } from "@/server/attendance";
import { attendanceRate, emptyCounts } from "@/server/attendance-reports";
import { clearedStudents } from "@/server/fees";
import { loadRoster } from "@/server/marks";
import { computeClassResults } from "@/server/results";
import { checkbox, optText, optUuid, parse, text, uuid } from "@/lib/validation";

// ───────────────────────── Settings ─────────────────────────

export type ReportCardSettings = { requireFinancialClearance: boolean };

export async function getReportCardSettings(client: Db | Tx, schoolId: string): Promise<ReportCardSettings> {
  const row = await client.schoolSetting.findUnique({ where: { schoolId_key: { schoolId, key: "reportCards" } } });
  return { requireFinancialClearance: (row?.value as Partial<ReportCardSettings> | undefined)?.requireFinancialClearance === true };
}

const settingsSchema = z.object({ requireFinancialClearance: checkbox() });

export async function updateReportCardSettings(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "reportcard.publish");
  const d = parse(settingsSchema, input);
  await db.$transaction(async (tx) => {
    await tx.schoolSetting.upsert({ where: { schoolId_key: { schoolId: ctx.schoolId, key: "reportCards" } }, create: { schoolId: ctx.schoolId, key: "reportCards", value: d, updatedById: ctx.userId }, update: { value: d, updatedById: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "reportcard.settings_update", entityType: "SchoolSetting", entityId: "reportCards", changes: d });
  });
}

/**
 * Financial clearance hook: the set of students who are cleared. Defaults to the fees module's rule (a student must
 * have been billed for the term and owe no more than the school's limit); tests and special deployments can replace it.
 * Nothing is ever assumed cleared.
 */
type ClearanceProvider = (client: Db | Tx, schoolId: string, termId: string, studentIds: string[]) => Promise<Set<string>>;
let clearanceProvider: ClearanceProvider | null = clearedStudents;
export function setClearanceProvider(p: ClearanceProvider | null) { clearanceProvider = p; }

// ───────────────────────── Scope ─────────────────────────

async function termOrThrow(client: Db | Tx, schoolId: string, termId: string) {
  const term = await client.term.findFirst({ where: { id: termId, schoolId }, include: { academicYear: { select: { id: true, name: true } } } });
  if (!term) throw notFound("Term");
  return term;
}

async function classTeacherRows(ctx: AuthContext, academicYearId: string, classId: string) {
  if (!ctx.staffId) return [];
  return db.classTeacher.findMany({ where: { staffId: ctx.staffId, schoolId: ctx.schoolId, academicYearId, classId }, select: { streamId: true } });
}
const coversStream = (rows: { streamId: string | null }[], streamId: string | null) => rows.some((r) => r.streamId === null || r.streamId === streamId);

// ───────────────────────── Remarks ─────────────────────────

const targetSchema = z.object({ termId: uuid(), classId: uuid(), streamId: optUuid() });

export async function listRemarks(ctx: AuthContext, input: unknown) {
  requireAnyPermission(ctx, ["remarks.class", "remarks.head", "reportcard.read"]);
  const q = parse(targetSchema, input);
  const term = await termOrThrow(db, ctx.schoolId, q.termId);
  const cls = await db.schoolClass.findFirst({ where: { id: q.classId, schoolId: ctx.schoolId }, include: { streams: { select: { id: true, name: true } } } });
  if (!cls) throw notFound("Class");
  if (q.streamId && !cls.streams.some((s) => s.id === q.streamId)) throw invalid("That stream does not belong to the selected class.", { streamId: "Invalid stream" });
  const head = ctx.permissions.has("remarks.head");
  const mine = head || ctx.permissions.has("reportcard.read") ? [] : await classTeacherRows(ctx, term.academicYearId, q.classId);
  const classAccess = head || (ctx.permissions.has("remarks.class") && coversStream(mine, q.streamId ?? null));
  if (!classAccess && !ctx.permissions.has("reportcard.read")) throw forbidden("Remarks are written by the class teacher of this class.");
  const roster = await loadRoster(db, ctx.schoolId, { academicYearId: term.academicYearId, termId: term.id }, q.classId, q.streamId ?? null);
  const [remarks, cards] = await Promise.all([
    db.reportRemark.findMany({ where: { schoolId: ctx.schoolId, termId: q.termId, studentId: { in: roster.map((s) => s.id) } } }),
    db.reportCard.findMany({ where: { schoolId: ctx.schoolId, termId: q.termId, studentId: { in: roster.map((s) => s.id) } }, select: { studentId: true, status: true } }),
  ]);
  const rm = new Map(remarks.map((r) => [r.studentId, r]));
  const cs = new Map(cards.map((c) => [c.studentId, c.status]));
  return {
    term: { id: term.id, name: term.name, year: term.academicYear.name }, className: cls.name, streams: cls.streams,
    can: { class: classAccess, head },
    rows: roster.map((s) => ({
      studentId: s.id, admissionNo: s.admissionNo, name: [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" "),
      classRemark: rm.get(s.id)?.classRemark ?? "", headRemark: rm.get(s.id)?.headRemark ?? "", cardStatus: cs.get(s.id) ?? null,
    })),
  };
}

const remarksSchema = targetSchema.extend({
  entries: z.array(z.object({ studentId: uuid(), classRemark: optText(500), headRemark: optText(500) })).max(500),
});

/** Saves remarks for students on the class list. A published card is frozen: withdraw it first. */
export async function saveRemarks(ctx: AuthContext, input: unknown) {
  requireAnyPermission(ctx, ["remarks.class", "remarks.head"]);
  const d = parse(remarksSchema, input);
  const term = await termOrThrow(db, ctx.schoolId, d.termId);
  const head = ctx.permissions.has("remarks.head");
  const mine = head ? [] : await classTeacherRows(ctx, term.academicYearId, d.classId);
  const classAccess = head || coversStream(mine, d.streamId ?? null);
  if (!classAccess) throw forbidden("Remarks are written by the class teacher of this class.");
  const roster = new Set((await loadRoster(db, ctx.schoolId, { academicYearId: term.academicYearId, termId: term.id }, d.classId, d.streamId ?? null)).map((s) => s.id));
  const errors: Record<string, string> = {};
  for (const e of d.entries) if (!roster.has(e.studentId)) errors[`remarks.${e.studentId}`] = "Not on this class list";
  if (Object.keys(errors).length) throw new AppError("VALIDATION", "Some students are not on this class list.", errors);

  let saved = 0;
  await db.$transaction(async (tx) => {
    const frozen = new Set((await tx.reportCard.findMany({ where: { schoolId: ctx.schoolId, termId: d.termId, status: "PUBLISHED", studentId: { in: d.entries.map((e) => e.studentId) } }, select: { studentId: true } })).map((c) => c.studentId));
    const existing = new Map((await tx.reportRemark.findMany({ where: { schoolId: ctx.schoolId, termId: d.termId, studentId: { in: d.entries.map((e) => e.studentId) } } })).map((r) => [r.studentId, r]));
    for (const e of d.entries) {
      const old = existing.get(e.studentId);
      const nextClass = e.classRemark ?? null;
      const nextHead = head ? (e.headRemark ?? null) : (old?.headRemark ?? null);
      const classChanged = (old?.classRemark ?? null) !== nextClass;
      const headChanged = (old?.headRemark ?? null) !== nextHead;
      if (!classChanged && !headChanged) continue;
      if (frozen.has(e.studentId)) errors[`remarks.${e.studentId}`] = "Report card already published. Withdraw it before changing remarks.";
      else {
        await tx.reportRemark.upsert({
          where: { studentId_termId: { studentId: e.studentId, termId: d.termId } },
          create: { schoolId: ctx.schoolId, studentId: e.studentId, termId: d.termId, classRemark: nextClass, headRemark: nextHead, classRemarkById: classChanged ? ctx.userId : null, headRemarkById: headChanged ? ctx.userId : null },
          update: { classRemark: nextClass, headRemark: nextHead, ...(classChanged ? { classRemarkById: ctx.userId } : {}), ...(headChanged ? { headRemarkById: ctx.userId } : {}) },
        });
        saved++;
      }
    }
    if (Object.keys(errors).length) throw new AppError("CONFLICT", "Some report cards are already published, so their remarks were not changed. Nothing was saved.", errors);
    if (saved) await writeAudit(tx, actorOf(ctx), { action: "reportcard.remarks_save", entityType: "Term", entityId: d.termId, summary: `${saved} remark(s)`, changes: { classId: d.classId, saved } });
  });
  return { saved };
}

// ───────────────────────── Building snapshots ─────────────────────────

export async function buildSnapshots(client: Db | Tx, schoolId: string, opts: { termId: string; classId: string; streamId?: string | null }, now = new Date()) {
  const res = await computeClassResults(client, schoolId, { ...opts, basis: "OFFICIAL" });
  const term = await termOrThrow(client, schoolId, opts.termId);
  const school = await client.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true, motto: true, address: true, phone: true, email: true } });
  const ids = res.rows.map((r) => r.studentId);
  const [students, remarks, att, settings] = await Promise.all([
    client.student.findMany({ where: { schoolId, id: { in: ids } }, select: { id: true, gender: true, dateOfBirth: true } }),
    client.reportRemark.findMany({ where: { schoolId, termId: opts.termId, studentId: { in: ids } } }),
    client.studentAttendance.groupBy({ by: ["studentId", "status"], where: { schoolId, studentId: { in: ids }, date: { gte: term.startsOn, lte: term.endsOn }, register: { status: "FINALISED" } }, _count: { _all: true } }),
    getAttendanceSettings(client, schoolId),
  ]);
  const stuInfo = new Map(students.map((s) => [s.id, s]));
  const rm = new Map(remarks.map((r) => [r.studentId, r]));
  const counts = new Map<string, ReturnType<typeof emptyCounts>>();
  for (const a of att) {
    const c = counts.get(a.studentId) ?? emptyCounts();
    c[a.status] = a._count._all;
    counts.set(a.studentId, c);
  }
  const ranked = res.rows.filter((r) => r.position !== null);
  const streamSize = new Map<string, number>();
  for (const r of ranked) if (r.streamId) streamSize.set(r.streamId, (streamSize.get(r.streamId) ?? 0) + 1);
  const subjectById = new Map(res.subjects.map((s) => [s.id, s]));
  const scale = res.scale;
  const snapshots = new Map<string, ReportSnapshot>();
  const skipped: { studentId: string; name: string }[] = [];
  if (!scale) return { res, snapshots, skipped };

  for (const r of res.rows) {
    if (r.subjectCount === 0) { skipped.push({ studentId: r.studentId, name: r.student.name }); continue; }
    const info = stuInfo.get(r.studentId);
    const c = counts.get(r.studentId) ?? emptyCounts();
    const recorded = c.PRESENT + c.ABSENT + c.LATE + c.EXCUSED;
    snapshots.set(r.studentId, {
      schema: 1,
      school: { name: school.name, motto: school.motto, address: school.address, phone: school.phone, email: school.email },
      student: { id: r.studentId, admissionNo: r.student.admissionNo, name: r.student.name, gender: info?.gender ?? "", dateOfBirth: info ? formatDateOnly(info.dateOfBirth) : "" },
      term: { id: term.id, name: term.name, year: term.academicYear.name, startsOn: formatDateOnly(term.startsOn), endsOn: formatDateOnly(term.endsOn) },
      class: { id: res.class.id, name: res.class.name, stream: r.streamName, level: res.class.level },
      scale: { name: scale.name, bands: scale.bands, passMark: scale.passMark, divisionBestN: scale.divisionBestN },
      policy: { absentAs: res.policy.absentAs, positionBy: res.policy.positionBy, decimals: res.policy.decimals },
      exams: res.exams.map((e) => ({ id: e.id, name: e.name, weight: e.weight })),
      subjects: r.subjects.map((l) => {
        const sub = subjectById.get(l.subjectId)!;
        return {
          subjectId: l.subjectId, name: sub.name, code: sub.code ?? "",
          exams: (res.examMarks.get(`${r.studentId}:${l.subjectId}`) ?? []).map((m) => ({ examId: m.examId, examName: m.examName, status: m.status, score: m.score, maxMarks: m.maxMarks, percent: m.percent })),
          percent: l.percent, grade: l.grade, points: l.points, position: l.position, classMean: res.summaries[l.subjectId]?.mean ?? null, classCount: res.summaries[l.subjectId]?.students ?? 0,
        };
      }),
      summary: {
        total: r.total, average: r.average, grade: r.grade, pointsSum: r.pointsSum, division: r.division, subjectCount: r.subjectCount,
        position: r.position, classSize: ranked.length, streamPosition: r.streamPosition, streamSize: r.streamId ? (streamSize.get(r.streamId) ?? null) : null,
      },
      attendance: { recorded, present: c.PRESENT, absent: c.ABSENT, late: c.LATE, excused: c.EXCUSED, ratePct: attendanceRate(c, settings) },
      remarks: { class: rm.get(r.studentId)?.classRemark ?? null, head: rm.get(r.studentId)?.headRemark ?? null },
      generatedAt: now.toISOString(),
    });
  }
  return { res, snapshots, skipped };
}

// ───────────────────────── Generate / publish / withdraw ─────────────────────────

const classTargetSchema = targetSchema.extend({ studentIds: z.array(uuid()).optional() });

export async function generateReportCards(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "reportcard.generate");
  const q = parse(classTargetSchema, input);
  const built = await buildSnapshots(db, ctx.schoolId, q);
  const { res } = built;
  if (!res.scale) throw conflict("No grading scale is configured for this class, so report cards cannot be generated.");
  if (res.coverage.total === 0) throw conflict("No examinations have been set up for this class in this term.");
  if (!res.coverage.complete) throw conflict(`${res.coverage.total - res.coverage.counted} of ${res.coverage.total} subject results are not locked yet. Lock every result of this class before generating report cards.`);
  const only = q.studentIds ? new Set(q.studentIds) : null;

  const out = { generated: 0, regenerated: 0, unchanged: 0, skippedPublished: [] as string[], noResults: built.skipped.map((s) => s.name) };
  await db.$transaction(async (tx) => {
    const existing = new Map((await tx.reportCard.findMany({ where: { schoolId: ctx.schoolId, termId: q.termId, studentId: { in: [...built.snapshots.keys()] } } })).map((c) => [c.studentId, c]));
    for (const [studentId, snap] of built.snapshots) {
      if (only && !only.has(studentId)) continue;
      const old = existing.get(studentId);
      if (!old) {
        await tx.reportCard.create({ data: { schoolId: ctx.schoolId, studentId, termId: q.termId, classId: q.classId, streamId: res.rows.find((r) => r.studentId === studentId)?.streamId ?? null, snapshot: snap as unknown as Prisma.InputJsonValue, generatedById: ctx.userId } });
        out.generated++;
        continue;
      }
      if (old.status === "PUBLISHED") { out.skippedPublished.push(snap.student.name); continue; }
      if (old.status === "GENERATED" && sameContent(old.snapshot as unknown as ReportSnapshot, snap)) { out.unchanged++; continue; }
      await tx.reportCardRevision.create({ data: { reportCardId: old.id, version: old.version, snapshot: old.snapshot as Prisma.InputJsonValue, generatedById: old.generatedById, generatedAt: old.generatedAt } });
      await tx.reportCard.update({
        where: { id: old.id },
        data: { status: "GENERATED", version: { increment: 1 }, snapshot: snap as unknown as Prisma.InputJsonValue, classId: q.classId, streamId: res.rows.find((r) => r.studentId === studentId)?.streamId ?? null, generatedById: ctx.userId, generatedAt: new Date(), withdrawnAt: null, withdrawnById: null, withdrawReason: null },
      });
      out.regenerated++;
    }
    await writeAudit(tx, actorOf(ctx), { action: "reportcard.generate", entityType: "SchoolClass", entityId: q.classId, summary: `${res.class.name} · ${res.term.name}`, changes: { generated: out.generated, regenerated: out.regenerated, unchanged: out.unchanged, skippedPublished: out.skippedPublished.length } });
  });
  return out;
}

const publishSchema = targetSchema.extend({ ids: z.array(uuid()).optional() });

/**
 * Publishes generated cards of a class. Each card is re-checked against today's locked results and remarks:
 * a card that no longer matches (something was unlocked, corrected or re-marked) is refused and must be regenerated.
 */
export async function publishReportCards(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "reportcard.publish");
  const q = parse(publishSchema, input);
  const settings = await getReportCardSettings(db, ctx.schoolId);
  const built = await buildSnapshots(db, ctx.schoolId, q);
  if (!built.res.coverage.complete) throw conflict("Some results of this class are no longer locked. Lock them and regenerate the report cards before publishing.");
  const cards = await db.reportCard.findMany({ where: { schoolId: ctx.schoolId, termId: q.termId, classId: q.classId, status: "GENERATED", ...(q.streamId ? { streamId: q.streamId } : {}), ...(q.ids ? { id: { in: q.ids } } : {}) } });
  let cleared: Set<string> | null = null;
  if (settings.requireFinancialClearance) {
    if (!clearanceProvider) throw conflict("Financial clearance is required before publishing, but fee records are not available. Turn the requirement off or set up fees first.");
    cleared = await clearanceProvider(db, ctx.schoolId, q.termId, cards.map((c) => c.studentId));
  }
  const out = { published: 0, stale: [] as string[], notCleared: [] as string[] };
  const now = new Date();
  await db.$transaction(async (tx) => {
    for (const c of cards) {
      const fresh = built.snapshots.get(c.studentId);
      const stored = c.snapshot as unknown as ReportSnapshot;
      if (!fresh || !sameContent(stored, fresh)) { out.stale.push(stored.student.name); continue; }
      if (cleared && !cleared.has(c.studentId)) { out.notCleared.push(stored.student.name); continue; }
      await tx.reportCard.update({ where: { id: c.id }, data: { status: "PUBLISHED", publishedAt: now, publishedById: ctx.userId } });
      out.published++;
    }
    await writeAudit(tx, actorOf(ctx), { action: "reportcard.publish", entityType: "SchoolClass", entityId: q.classId, summary: `${built.res.class.name} · ${built.res.term.name}`, changes: { published: out.published, stale: out.stale.length, notCleared: out.notCleared.length } });
  });
  return out;
}

const withdrawSchema = z.object({ reason: text(300) });

export async function withdrawReportCard(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "reportcard.publish");
  const { reason } = parse(withdrawSchema, input);
  const card = await db.reportCard.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!card) throw notFound("Report card");
  if (card.status === "WITHDRAWN") throw conflict("This report card is already withdrawn.");
  await db.$transaction(async (tx) => {
    await tx.reportCard.update({ where: { id }, data: { status: "WITHDRAWN", withdrawnAt: new Date(), withdrawnById: ctx.userId, withdrawReason: reason } });
    await writeAudit(tx, actorOf(ctx), { action: "reportcard.withdraw", entityType: "ReportCard", entityId: id, summary: (card.snapshot as unknown as ReportSnapshot).student.name, changes: { reason, wasPublished: card.status === "PUBLISHED" } });
  });
}

// ───────────────────────── Reading (staff) ─────────────────────────

export async function listClassReportCards(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "reportcard.read");
  const q = parse(targetSchema, input);
  const term = await termOrThrow(db, ctx.schoolId, q.termId);
  const cls = await db.schoolClass.findFirst({ where: { id: q.classId, schoolId: ctx.schoolId }, include: { streams: { select: { id: true, name: true } } } });
  if (!cls) throw notFound("Class");
  const roster = await loadRoster(db, ctx.schoolId, { academicYearId: term.academicYearId, termId: term.id }, q.classId, q.streamId ?? null);
  const [cards, remarks, res] = await Promise.all([
    db.reportCard.findMany({ where: { schoolId: ctx.schoolId, termId: q.termId, studentId: { in: roster.map((s) => s.id) } }, select: { id: true, studentId: true, status: true, version: true, generatedAt: true, publishedAt: true } }),
    db.reportRemark.findMany({ where: { schoolId: ctx.schoolId, termId: q.termId, studentId: { in: roster.map((s) => s.id) } }, select: { studentId: true, classRemark: true, headRemark: true } }),
    computeClassResults(db, ctx.schoolId, { ...q, basis: "OFFICIAL" }),
  ]);
  const cm = new Map(cards.map((c) => [c.studentId, c]));
  const rm = new Map(remarks.map((r) => [r.studentId, r]));
  const result = new Map(res.rows.map((r) => [r.studentId, r]));
  return {
    term: { id: term.id, name: term.name, year: term.academicYear.name }, className: cls.name, streams: cls.streams, coverage: res.coverage, hasScale: !!res.scale,
    rows: roster.map((s) => ({
      studentId: s.id, admissionNo: s.admissionNo, name: [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" "), studentStatus: s.status,
      card: cm.get(s.id) ?? null, hasClassRemark: !!rm.get(s.id)?.classRemark, hasHeadRemark: !!rm.get(s.id)?.headRemark,
      average: result.get(s.id)?.average ?? null, position: result.get(s.id)?.position ?? null,
    })),
  };
}

export async function getReportCard(ctx: AuthContext, id: string) {
  requirePermission(ctx, "reportcard.read");
  const card = await db.reportCard.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!card) throw notFound("Report card");
  return { ...card, snapshot: card.snapshot as unknown as ReportSnapshot };
}

/** Cards of a class for a combined PDF. Staff only; every card is included regardless of status except withdrawn ones. */
export async function cardsForClass(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "reportcard.read");
  const q = parse(targetSchema, input);
  const cards = await db.reportCard.findMany({ where: { schoolId: ctx.schoolId, termId: q.termId, classId: q.classId, status: { not: "WITHDRAWN" }, ...(q.streamId ? { streamId: q.streamId } : {}) } });
  const snaps = cards.map((c) => ({ id: c.id, snapshot: c.snapshot as unknown as ReportSnapshot }));
  return snaps.sort((a, b) => (a.snapshot.summary.position ?? 1e9) - (b.snapshot.summary.position ?? 1e9) || a.snapshot.student.name.localeCompare(b.snapshot.student.name));
}

export async function auditDownload(ctx: AuthContext, entityId: string, summary: string, extra?: Record<string, unknown>) {
  await writeAudit(db, actorOf(ctx), { action: "reportcard.download", entityType: "ReportCard", entityId, summary, changes: extra });
}
