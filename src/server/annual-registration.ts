import { z } from "zod";
import { db, type Db, type Tx } from "@/lib/db";
import { AppError, conflict, invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { formatDateOnly } from "@/lib/dates";
import { isCleared, nextStep, placesLeft, recommendStream, type ClearanceState, type Department, type FeePolicy, type NextStage } from "@/lib/lifecycle/rules";
import { actorOf, writeAudit } from "@/server/audit";
import { schoolToday } from "@/server/balances";
import { getLifecycleSettings } from "@/server/lifecycle-settings";
import { loadGrades, loadYears, yearAfter, yearFinances, type YearFinance } from "@/server/lifecycle-data";
import { getFeeSettings } from "@/server/fees";
import { placeStudentTx } from "@/server/students";
import { closeTasks, openTask } from "@/server/workflow";
import { childIds } from "@/server/portal";
import { checkbox, optText, optUuid, parse, text, uuid } from "@/lib/validation";

/*
 * Returning students: the annual registration. A student keeps ONE record and ONE Student ID for all their years. Each year they come back
 * through three separate steps, each its own fact: the Academic Office decided where they go (progression), Admissions places them in a grade and
 * stream and confirms the registration, and only then do they join the class roster (an enrolment). Fees never rewrite any of these: the
 * clearance is worked out from verified payments and the school's own policy says which step, if any, it holds back.
 */

type Client = Db | Tx;
const label = (s: { firstName: string; middleName?: string | null; lastName: string; admissionNo: string }) => `${[s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ")} (${s.admissionNo})`;
const nameOf = (s: { firstName: string; middleName?: string | null; lastName: string }) => [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");
const isUnique = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

// ───────────────────────── Creating the registration record ─────────────────────────

type DecisionRef = { id: string; studentId: string; fromAcademicYearId: string; outcome: string; toClassId: string | null };

/**
 * The returning-student record for the year after the decision's year, created when a moving decision (promoted or repeat) is final. It already
 * exists once: it is re-linked to a revised decision (and its placement cleared when the grade changed), never duplicated. Without a next year
 * there is nothing to create yet (`createMissingRegistrations` does it when the year is set up).
 */
export async function ensureRegistrationTx(tx: Tx, ctx: AuthContext, prog: DecisionRef): Promise<"created" | "linked" | "none"> {
  const years = await loadYears(tx, ctx.schoolId);
  const next = yearAfter(years, prog.fromAcademicYearId);
  if (!next) return "none";
  const student = await tx.student.findFirstOrThrow({ where: { id: prog.studentId, schoolId: ctx.schoolId }, select: { firstName: true, middleName: true, lastName: true, admissionNo: true } });
  const existing = await tx.annualRegistration.findUnique({ where: { studentId_academicYearId: { studentId: prog.studentId, academicYearId: next.id } } });
  if (!existing) {
    const created = await tx.annualRegistration.create({ data: { schoolId: ctx.schoolId, studentId: prog.studentId, academicYearId: next.id, progressionId: prog.id } });
    await openTask(tx, { schoolId: ctx.schoolId, kind: "RETURNING_PLACEMENT", relatedType: "AnnualRegistration", relatedId: created.id, relatedLabel: `${label(student)} · ${next.name}`, sourceEvent: "progression.approved", createdById: ctx.userId });
    await writeAudit(tx, actorOf(ctx), { action: "registration.create", entityType: "AnnualRegistration", entityId: created.id, summary: `${label(student)} · ${next.name}`, changes: { progressionId: prog.id, academicYearId: next.id } });
    return "created";
  }
  if (existing.status === "REGISTERED" || existing.status === "ACTIVE") throw conflict(`${label(student)} is already registered for ${next.name}. Cancel that registration before changing the decision.`);
  const gradeChanged = existing.classId !== null && existing.classId !== prog.toClassId;
  await tx.annualRegistration.update({
    where: { id: existing.id },
    data: { progressionId: prog.id, status: "PENDING", cancelReason: null, ...(gradeChanged ? { classId: null, streamId: null, placedAt: null, placedById: null, capacityOverrideReason: null, gradeOverrideReason: null } : {}) },
  });
  await openTask(tx, { schoolId: ctx.schoolId, kind: "RETURNING_PLACEMENT", relatedType: "AnnualRegistration", relatedId: existing.id, relatedLabel: `${label(student)} · ${next.name}`, sourceEvent: "progression.approved", createdById: ctx.userId });
  return "linked";
}

/** A decision that is final but does not bring the student back (pending review, completed, left) cancels a registration that was waiting. */
export async function releaseRegistrationTx(tx: Tx, ctx: AuthContext, prog: DecisionRef, reason: string): Promise<void> {
  const years = await loadYears(tx, ctx.schoolId);
  const next = yearAfter(years, prog.fromAcademicYearId);
  if (!next) return;
  const reg = await tx.annualRegistration.findUnique({ where: { studentId_academicYearId: { studentId: prog.studentId, academicYearId: next.id } } });
  if (!reg || reg.status === "CANCELLED") return;
  if (reg.status === "ACTIVE" || reg.status === "REGISTERED") throw conflict("The student is already registered for the next year. Cancel that registration first.");
  await tx.annualRegistration.update({ where: { id: reg.id }, data: { status: "CANCELLED", cancelReason: reason } });
  await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "AnnualRegistration", relatedId: reg.id, status: "CANCELLED", by: ctx.userId, note: reason });
}

/** Creates the returning-student records for decisions that were approved before the next year existed. Idempotent. */
export async function createMissingRegistrations(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "registration.manage");
  const { yearId } = parse(z.object({ yearId: uuid() }), input);
  const years = await loadYears(db, ctx.schoolId);
  const target = years.find((y) => y.id === yearId);
  if (!target) throw notFound("Academic year");
  const idx = years.findIndex((y) => y.id === yearId);
  const previous = idx > 0 ? years[idx - 1] : undefined;
  if (!previous) return { created: 0 };
  const approved = await db.studentProgression.findMany({
    where: { schoolId: ctx.schoolId, fromAcademicYearId: previous.id, status: "APPROVED", outcome: { in: ["PROMOTED", "REPEAT"] }, student: { status: "ENROLLED" } },
    select: { id: true, studentId: true, fromAcademicYearId: true, outcome: true, toClassId: true },
  });
  const have = new Set((await db.annualRegistration.findMany({ where: { schoolId: ctx.schoolId, academicYearId: yearId }, select: { studentId: true } })).map((r) => r.studentId));
  let created = 0;
  for (const p of approved) {
    if (have.has(p.studentId)) continue;
    try {
      const r = await db.$transaction((tx) => ensureRegistrationTx(tx, ctx, p));
      if (r === "created") created++;
    } catch (e) {
      if (!isUnique(e)) throw e;
    }
  }
  return { created };
}

// ───────────────────────── Reading ─────────────────────────

export type Stage = NextStage;
export type RegistrationRow = {
  id: string; studentId: string; admissionNo: string; name: string; outcome: string;
  fromClassName: string; decidedClassId: string | null; decidedClassName: string | null;
  classId: string | null; className: string | null; streamId: string | null; streamName: string | null;
  status: string; stage: Stage; department: Department; blocked: boolean;
  clearance: ClearanceState; firstTermOutstanding: number | null; previousOutstanding: number | null; hasPreviousDebt: boolean; exception: boolean;
  placedAt: Date | null; registeredAt: Date | null; activatedAt: Date | null; gradeOverrideReason: string | null; capacityOverrideReason: string | null;
};
export type ClassPlaces = { classId: string; name: string; capacity: number | null; inClass: number; reserved: number; left: number | null; streams: { id: string; name: string; count: number }[]; recommendedStreamId: string | null };

export const REGISTRATION_STAGES: readonly Stage[] = ["NEEDS_PLACEMENT", "NEEDS_REGISTRATION", "NEEDS_FEE", "READY_TO_ACTIVATE", "WAITING_YEAR_OPEN", "ACTIVE", "NOT_RETURNING"];

/** Which year the returning-student screens open on: the year after the current one when it exists, else the current year. */
export async function defaultTargetYear(client: Client, schoolId: string) {
  const years = await loadYears(client, schoolId);
  const current = years.find((y) => y.isCurrent) ?? null;
  const after = current ? yearAfter(years, current.id) : null;
  return { years, target: after ?? current };
}

/** Places in every class for a year: students in the roster plus places promised to returning students, per stream. */
export async function classPlaces(client: Client, schoolId: string, yearId: string): Promise<Map<string, ClassPlaces>> {
  const [grades, streams, enrolled, reserved] = await Promise.all([
    loadGrades(client, schoolId),
    client.stream.findMany({ where: { schoolId }, select: { id: true, name: true, classId: true }, orderBy: { name: "asc" } }),
    client.studentEnrollment.groupBy({ by: ["classId", "streamId"], where: { schoolId, academicYearId: yearId, status: "ACTIVE" }, _count: { _all: true } }),
    client.annualRegistration.groupBy({ by: ["classId", "streamId"], where: { schoolId, academicYearId: yearId, status: { in: ["PENDING", "REGISTERED"] }, classId: { not: null } }, _count: { _all: true } }),
  ]);
  const out = new Map<string, ClassPlaces>();
  for (const g of grades) {
    const inClass = enrolled.filter((e) => e.classId === g.id).reduce((n, e) => n + e._count._all, 0);
    const held = reserved.filter((e) => e.classId === g.id).reduce((n, e) => n + e._count._all, 0);
    const list = streams.filter((s) => s.classId === g.id).map((s) => ({
      id: s.id, name: s.name,
      count: enrolled.filter((e) => e.streamId === s.id).reduce((n, e) => n + e._count._all, 0) + reserved.filter((e) => e.streamId === s.id).reduce((n, e) => n + e._count._all, 0),
    }));
    out.set(g.id, { classId: g.id, name: g.name, capacity: g.capacity, inClass, reserved: held, left: placesLeft(g.capacity, inClass, held), streams: list, recommendedStreamId: recommendStream(list) });
  }
  return out;
}

const PAGE = 50;
export type ReturningFilter = { yearId?: string; classId?: string; stage?: string; q?: string; money?: "cleared" | "owing"; page?: number };

export async function returningBoard(ctx: AuthContext, opts: ReturningFilter = {}) {
  requirePermission(ctx, "registration.read");
  const { years, target: fallback } = await defaultTargetYear(db, ctx.schoolId);
  const year = (opts.yearId ? years.find((y) => y.id === opts.yearId) : null) ?? fallback;
  if (!year) return { year: null, years, rows: [] as RegistrationRow[], total: 0, page: 1, pages: 1, counts: emptyCounts(), places: [] as ClassPlaces[], options: [] as PlaceOption[], missing: 0, settings: await getLifecycleSettings(db, ctx.schoolId), open: false, classes: [] as { id: string; name: string }[] };

  const [settings, grades, today] = await Promise.all([getLifecycleSettings(db, ctx.schoolId), loadGrades(db, ctx.schoolId), schoolToday(db, ctx.schoolId)]);
  const regs = await db.annualRegistration.findMany({
    where: { schoolId: ctx.schoolId, academicYearId: year.id },
    include: { student: { select: { firstName: true, middleName: true, lastName: true, admissionNo: true, status: true } }, progression: true },
  });
  const exceptions = new Set(regs.filter((r) => r.clearanceExceptionReason).map((r) => r.studentId));
  const money = await yearFinances(db, ctx.schoolId, regs.map((r) => r.studentId), year.id, settings, exceptions);
  const streams = await db.stream.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true } });
  const className = new Map(grades.map((g) => [g.id, g.name]));
  const streamName = new Map(streams.map((s) => [s.id, s.name]));
  const open = today >= formatDateOnly(year.startsOn) && today <= formatDateOnly(year.endsOn);
  const seeMoney = ctx.permissions.has("fees.read");

  const all: RegistrationRow[] = regs.map((r) => {
    const m: YearFinance | undefined = money.get(r.studentId);
    const clearance = m?.state ?? "NOT_BILLED";
    const step = nextStep({ outcome: r.progression.outcome, decision: "APPROVED", registration: r.status, placed: r.classId !== null, clearance, feePolicy: settings.feePolicy, yearOpen: open });
    return {
      id: r.id, studentId: r.studentId, admissionNo: r.student.admissionNo, name: nameOf(r.student), outcome: r.progression.outcome,
      fromClassName: className.get(r.progression.fromClassId) ?? "", decidedClassId: r.progression.toClassId, decidedClassName: r.progression.toClassId ? className.get(r.progression.toClassId) ?? null : null,
      classId: r.classId, className: r.classId ? className.get(r.classId) ?? null : null, streamId: r.streamId, streamName: r.streamId ? streamName.get(r.streamId) ?? null : null,
      status: r.status, stage: step.stage, department: step.department, blocked: step.blocked,
      clearance,
      // Amounts are for people who may see money; everyone with access sees the clearance state and whether older debt exists.
      firstTermOutstanding: seeMoney ? m?.firstTerm.outstanding ?? 0 : null, previousOutstanding: seeMoney ? m?.previousOutstanding ?? 0 : null, hasPreviousDebt: (m?.previousOutstanding ?? 0) > 0, exception: r.clearanceExceptionReason !== null,
      placedAt: r.placedAt, registeredAt: r.registeredAt, activatedAt: r.activatedAt, gradeOverrideReason: r.gradeOverrideReason, capacityOverrideReason: r.capacityOverrideReason,
    };
  });
  const counts = emptyCounts();
  for (const r of all) { counts.total++; counts.byStage[r.stage] = (counts.byStage[r.stage] ?? 0) + 1; if (isCleared(r.clearance)) counts.cleared++; else if (r.stage !== "NOT_RETURNING") counts.owing++; }

  const q = opts.q?.trim().toLowerCase();
  let rows = all.filter((r) => (!opts.classId || (r.classId ?? r.decidedClassId) === opts.classId) && (!opts.stage || r.stage === opts.stage) && (!q || r.name.toLowerCase().includes(q) || r.admissionNo.toLowerCase().includes(q)) && (!opts.money || (opts.money === "cleared" ? isCleared(r.clearance) : !isCleared(r.clearance))));
  // Students who need something done come first (grade, registration, joining the class), then those waiting on others, then those already in.
  const ORDER: Stage[] = ["NEEDS_PLACEMENT", "NEEDS_REGISTRATION", "READY_TO_ACTIVATE", "NEEDS_FEE", "WAITING_YEAR_OPEN", "ACTIVE", "NOT_RETURNING"];
  const urgency = (st: Stage) => { const i = ORDER.indexOf(st); return i < 0 ? 99 : i; };
  rows = rows.sort((a, b) => urgency(a.stage) - urgency(b.stage) || (a.className ?? a.decidedClassName ?? "").localeCompare(b.className ?? b.decidedClassName ?? "") || a.name.localeCompare(b.name));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const page = Math.min(Math.max(1, opts.page ?? 1), pages);

  const years2 = years; const at = years2.findIndex((y) => y.id === year.id);
  const previous = at > 0 ? years2[at - 1]! : null;
  const missing = previous
    ? await db.studentProgression.count({ where: { schoolId: ctx.schoolId, fromAcademicYearId: previous.id, status: "APPROVED", outcome: { in: ["PROMOTED", "REPEAT"] }, student: { status: "ENROLLED", registrations: { none: { academicYearId: year.id } } } } })
    : 0;
  const places = [...(await classPlaces(db, ctx.schoolId, year.id)).values()];
  // Where a student can be placed (every active class and stream, with the places taken), so a row can place someone without opening their page.
  const active = await db.schoolClass.findMany({ where: { schoolId: ctx.schoolId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { streams: { orderBy: { name: "asc" } } } });
  const options: PlaceOption[] = active.flatMap((c) => {
    const p = places.find((x) => x.classId === c.id);
    const note = c.capacity ? ` (${(p?.inClass ?? 0) + (p?.reserved ?? 0)}/${c.capacity})` : "";
    const full = p?.left === 0;
    return c.streams.length ? c.streams.map((st) => ({ value: `${c.id}|${st.id}`, label: `${c.name} – ${st.name}${note}`, full })) : [{ value: c.id, label: `${c.name}${note}`, full }];
  });
  return { year, years, rows: rows.slice((page - 1) * PAGE, page * PAGE), total: rows.length, page, pages, counts, places, options, missing, settings, open, classes: grades.map((g) => ({ id: g.id, name: g.name })) };
}
function emptyCounts() { return { total: 0, cleared: 0, owing: 0, byStage: {} as Partial<Record<Stage, number>> }; }

export type PlaceOption = { value: string; label: string; full: boolean };

/** Everything a registration page needs for one student: the registration, the decision, where they can be placed, the fee clearance and who acts next. */
export async function registrationDetail(ctx: AuthContext, id: string) {
  requirePermission(ctx, "registration.read");
  const reg = await db.annualRegistration.findFirst({ where: { id, schoolId: ctx.schoolId }, include: { student: true, progression: true, academicYear: true } });
  if (!reg) throw notFound("Registration");
  const [settings, grades, today, places, classes] = await Promise.all([
    getLifecycleSettings(db, ctx.schoolId), loadGrades(db, ctx.schoolId), schoolToday(db, ctx.schoolId), classPlaces(db, ctx.schoolId, reg.academicYearId),
    db.schoolClass.findMany({ where: { schoolId: ctx.schoolId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { streams: { orderBy: { name: "asc" } } } }),
  ]);
  const money = (await yearFinances(db, ctx.schoolId, [reg.studentId], reg.academicYearId, settings, new Set(reg.clearanceExceptionReason ? [reg.studentId] : []))).get(reg.studentId)!;
  const open = today >= formatDateOnly(reg.academicYear.startsOn) && today <= formatDateOnly(reg.academicYear.endsOn);
  const step = nextStep({ outcome: reg.progression.outcome, decision: "APPROVED", registration: reg.status, placed: reg.classId !== null, clearance: money.state, feePolicy: settings.feePolicy, yearOpen: open });
  const className = new Map(grades.map((g) => [g.id, g.name]));
  const options: PlaceOption[] = classes.flatMap((c) => {
    const p = places.get(c.id);
    const note = c.capacity ? ` (${(p?.inClass ?? 0) + (p?.reserved ?? 0)}/${c.capacity})` : "";
    const full = p?.left === 0;
    return c.streams.length ? c.streams.map((st) => ({ value: `${c.id}|${st.id}`, label: `${c.name} – ${st.name}${note}`, full })) : [{ value: c.id, label: `${c.name}${note}`, full }];
  });
  const decided = reg.progression.toClassId;
  const chosen = reg.classId ? (reg.streamId ? `${reg.classId}|${reg.streamId}` : reg.classId) : null;
  let preferred = chosen ?? "";
  if (!preferred && decided) {
    const p = places.get(decided);
    preferred = p && p.streams.length ? `${decided}|${p.recommendedStreamId}` : decided;
  }
  const seeMoney = ctx.permissions.has("fees.read");
  return {
    reg, student: reg.student, year: reg.academicYear, decidedClass: decided ? className.get(decided) ?? null : null, fromClass: className.get(reg.progression.fromClassId) ?? "",
    placedClass: reg.classId ? className.get(reg.classId) ?? null : null, placedStream: reg.streamId ? (await db.stream.findFirst({ where: { id: reg.streamId }, select: { name: true } }))?.name ?? null : null,
    options, preferred, step, open, settings, clearance: money.state, hasPreviousDebt: money.previousOutstanding > 0,
    money: seeMoney ? { firstTerm: money.firstTerm, year: money.year, previous: money.previous, previousOutstanding: money.previousOutstanding } : null,
    places: places.get(decided ?? reg.classId ?? "") ?? null,
  };
}

// ───────────────────────── Placing and registering ─────────────────────────

const placeSchema = z.object({
  registrationId: uuid(), classId: uuid(), streamId: optUuid(),
  overrideCapacity: checkbox().default(false), overrideReason: optText(300), gradeReason: optText(300),
});

/**
 * Places a returning student in a grade and stream for the year. The grade is the one the Academic Office decided; a different grade is an
 * academic exception (`progression.exception` and a reason). The class may be full only with the capacity override (permission and reason).
 * Capacity is checked under a lock per class and year, counting the roster and the places already promised, so two people cannot both take the last place.
 */
export async function placeReturning(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "registration.manage");
  const d = parse(placeSchema, input);
  return db.$transaction(async (tx) => {
    const reg = await tx.annualRegistration.findFirst({ where: { id: d.registrationId, schoolId: ctx.schoolId }, include: { student: true, progression: true, academicYear: true } });
    if (!reg) throw notFound("Registration");
    if (reg.status === "ACTIVE") throw conflict("The student is already in the class roster for this year.");
    if (reg.status === "CANCELLED") throw conflict("This registration was cancelled.");
    const cls = await tx.schoolClass.findFirst({ where: { id: d.classId, schoolId: ctx.schoolId } });
    if (!cls) throw notFound("Class");
    if (!cls.isActive) throw invalid("This class is not active.", { classId: "Class is inactive" });
    const hasStreams = (await tx.stream.count({ where: { classId: d.classId } })) > 0;
    if (d.streamId) {
      if (!(await tx.stream.findFirst({ where: { id: d.streamId, schoolId: ctx.schoolId, classId: d.classId } }))) throw invalid("That stream does not belong to the selected class.", { streamId: "Invalid stream" });
    } else if (hasStreams) throw invalid("Select a stream for this class.", { streamId: "Required for this class" });

    let gradeOverride: string | null = null;
    if (reg.progression.toClassId && reg.progression.toClassId !== d.classId) {
      requirePermission(ctx, "progression.exception");
      if (!d.gradeReason) throw invalid("Say why the student goes to a different grade than the one decided.", { gradeReason: "Required" });
      gradeOverride = d.gradeReason;
    }

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cap:${reg.academicYearId}:${d.classId}`}, 0))`;
    let capacityOverride: string | null = null;
    if (cls.capacity !== null) {
      const inClass = await tx.studentEnrollment.count({ where: { schoolId: ctx.schoolId, academicYearId: reg.academicYearId, classId: d.classId, status: "ACTIVE", studentId: { not: reg.studentId } } });
      const held = await tx.annualRegistration.count({ where: { schoolId: ctx.schoolId, academicYearId: reg.academicYearId, classId: d.classId, status: { in: ["PENDING", "REGISTERED"] }, id: { not: reg.id } } });
      if (inClass + held >= cls.capacity) {
        if (!d.overrideCapacity) throw conflict(`${cls.name} is full (${inClass + held} of ${cls.capacity}, including places promised to returning students). Choose another class, or ask someone who is allowed to place a student in a full class.`);
        requirePermission(ctx, "class.capacity_override");
        if (!d.overrideReason) throw invalid("Say why the class capacity is being exceeded.", { overrideReason: "Required" });
        capacityOverride = `${cls.name} ${inClass + held + 1}/${cls.capacity}: ${d.overrideReason}`;
      }
    }
    await tx.annualRegistration.update({
      where: { id: reg.id },
      data: { classId: d.classId, streamId: d.streamId ?? null, placedById: ctx.userId, placedAt: new Date(), gradeOverrideReason: gradeOverride, capacityOverrideReason: capacityOverride },
    });
    await writeAudit(tx, actorOf(ctx), {
      action: "registration.place", entityType: "AnnualRegistration", entityId: reg.id, summary: `${label(reg.student)} · ${reg.academicYear.name}`,
      changes: { classId: d.classId, streamId: d.streamId ?? null, decidedClassId: reg.progression.toClassId, ...(gradeOverride ? { gradeOverride } : {}), ...(capacityOverride ? { capacityOverride } : {}) },
    });
    await syncFeeTaskTx(tx, ctx.schoolId, reg.id);
  });
}

const confirmSchema = z.object({
  registrationId: uuid(),
  confirmed: checkbox().refine((v) => v, "Confirm the details with the family first"),
  note: optText(300),
});

/**
 * Annual registration: the family confirmed they are returning and the details on file (guardians, emergency contact, medical information).
 * Needs a placement first. When the school's policy asks for fee clearance before registration, it is checked here and nowhere else.
 */
export async function confirmRegistration(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "registration.manage");
  const d = parse(confirmSchema, input);
  return db.$transaction(async (tx) => {
    const reg = await tx.annualRegistration.findFirst({ where: { id: d.registrationId, schoolId: ctx.schoolId }, include: { student: true, academicYear: true } });
    if (!reg) throw notFound("Registration");
    if (reg.status === "REGISTERED") throw conflict("This student is already registered for the year.");
    if (reg.status !== "PENDING") throw conflict(reg.status === "ACTIVE" ? "The student is already in the class roster." : "This registration was cancelled.");
    if (!reg.classId) throw conflict("Place the student in a grade first.");
    const settings = await getLifecycleSettings(tx, ctx.schoolId);
    if (settings.feePolicy === "BLOCK_REGISTRATION") {
      const m = (await yearFinances(tx, ctx.schoolId, [reg.studentId], reg.academicYearId, settings, new Set(reg.clearanceExceptionReason ? [reg.studentId] : []))).get(reg.studentId);
      if (!m || !isCleared(m.state)) {
        // Finance learns about it even though this step is refused (a separate write: the refusal rolls back this transaction).
        await openTask(db, { schoolId: ctx.schoolId, kind: "RETURNING_FEE", relatedType: "AnnualRegistration", relatedId: reg.id, relatedLabel: `${label(reg.student)} · ${reg.academicYear.name}`, sourceEvent: "registration.fee_needed", createdById: ctx.userId });
        throw conflict("The school asks for fee clearance before registration, and this student is not cleared yet. Finance records payments and can approve an arrangement.");
      }
    }
    await tx.annualRegistration.update({
      where: { id: reg.id },
      data: { status: "REGISTERED", registeredById: ctx.userId, registeredAt: new Date(), confirmations: { confirmedAt: new Date().toISOString(), confirmedBy: ctx.fullName, note: d.note ?? null } },
    });
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "AnnualRegistration", relatedId: reg.id, kinds: ["RETURNING_PLACEMENT"], by: ctx.userId, note: "Registered" });
    await writeAudit(tx, actorOf(ctx), { action: "registration.confirm", entityType: "AnnualRegistration", entityId: reg.id, summary: `${label(reg.student)} · ${reg.academicYear.name}`, changes: { classId: reg.classId, streamId: reg.streamId } });
    await syncFeeTaskTx(tx, ctx.schoolId, reg.id);
  });
}

// ───────────────────────── The family registers their own child ─────────────────────────

export type FamilyRegistration = {
  /** NONE: nothing to register (no approved moving decision yet). OPEN: the family can register now. FEES: the school's rule asks for fee clearance first. */
  state: "OPEN" | "NOT_YET" | "CLOSED" | "FEES" | "REGISTERED" | "JOINED" | "CANCELLED";
  outcome: "PROMOTED" | "REPEAT";
  year: { id: string; name: string; startsOn: string; opensOn: string | null; closesOn: string | null };
  toClassName: string;
  placed: string | null;
  /** What the new year costs this child and what verified payments cover (the one balance calculation); earlier-year debt stays on its own line. */
  fees: { state: ClearanceState; firstTerm: { billed: boolean; charged: number; paid: number; outstanding: number }; initialRequired: number | null; previousOutstanding: number; previous: { yearName: string; outstanding: number }[]; paymentInstructions: string } | null;
};

/** The decision and registration for the family's child for the coming year: only an APPROVED promote/repeat decision with a registration record counts. */
async function familyRecord(client: Client, ctx: AuthContext, studentId: string) {
  const prog = await client.studentProgression.findFirst({ where: { schoolId: ctx.schoolId, studentId, status: "APPROVED", outcome: { in: ["PROMOTED", "REPEAT"] } }, orderBy: { approvedAt: "desc" } });
  if (!prog) return null;
  const reg = await client.annualRegistration.findFirst({ where: { schoolId: ctx.schoolId, studentId, progressionId: prog.id }, include: { academicYear: true, student: true } });
  return reg ? { prog, reg } : null;
}

/** What the parent or student sees about next year, or null when there is nothing to show yet (the Academic Office has not made a final decision). */
export async function familyRegistrationView(ctx: AuthContext, studentId: string): Promise<FamilyRegistration | null> {
  if (!(await childIds(ctx)).includes(studentId)) throw notFound("Student");
  const rec = await familyRecord(db, ctx, studentId);
  if (!rec) return null;
  const { prog, reg } = rec;
  const grades = await loadGrades(db, ctx.schoolId);
  const toClassName = grades.find((g) => g.id === prog.toClassId)?.name ?? "";
  const stream = reg.streamId ? (await db.stream.findFirst({ where: { id: reg.streamId }, select: { name: true } }))?.name ?? null : null;
  const placedName = reg.classId ? `${grades.find((g) => g.id === reg.classId)?.name ?? ""}${stream ? ` · ${stream}` : ""}` : null;
  const year = { id: reg.academicYear.id, name: reg.academicYear.name, startsOn: formatDateOnly(reg.academicYear.startsOn), opensOn: reg.academicYear.registrationOpensOn ? formatDateOnly(reg.academicYear.registrationOpensOn) : null, closesOn: reg.academicYear.registrationClosesOn ? formatDateOnly(reg.academicYear.registrationClosesOn) : null };
  const [settings, feeSettings] = await Promise.all([getLifecycleSettings(db, ctx.schoolId), getFeeSettings(db, ctx.schoolId)]);
  const m = (await yearFinances(db, ctx.schoolId, [studentId], reg.academicYearId, settings, new Set(reg.clearanceExceptionReason ? [studentId] : []))).get(studentId);
  const fees: FamilyRegistration["fees"] = m ? {
    state: m.state, firstTerm: m.firstTerm,
    initialRequired: feeSettings.initialPaymentPct !== null && m.firstTerm.billed ? Math.ceil((m.firstTerm.charged * feeSettings.initialPaymentPct) / 100) : null,
    previousOutstanding: m.previousOutstanding, previous: m.previous.map((p) => ({ yearName: p.yearName, outstanding: p.outstanding })), paymentInstructions: feeSettings.paymentInstructions,
  } : null;
  const base = { outcome: prog.outcome as "PROMOTED" | "REPEAT", year, toClassName, placed: placedName, fees };
  if (reg.status === "CANCELLED") return { ...base, state: "CANCELLED" };
  if (reg.status === "ACTIVE") return { ...base, state: "JOINED" };
  if (reg.status === "REGISTERED") return { ...base, state: "REGISTERED" };
  const today = await schoolToday(db, ctx.schoolId);
  if (year.opensOn && today < year.opensOn) return { ...base, state: "NOT_YET" };
  if (year.closesOn && today > year.closesOn) return { ...base, state: "CLOSED" };
  if (settings.feePolicy === "BLOCK_REGISTRATION" && (!m || !isCleared(m.state))) return { ...base, state: "FEES" };
  return { ...base, state: "OPEN" };
}

const familySchema = z.object({ confirmed: checkbox().refine((v) => v, "Confirm that you are returning and that the details are correct") });

/**
 * A parent (or the student) registers the child for the coming year after the Academic Office's decision is final: the child is placed in the
 * decided grade (the stream with the fewest students) and the registration is confirmed, in one step. The same rules as at the office apply:
 * the registration window, the class capacity (a full class is refused, never overridden) and the school's fee policy. Joining the class roster
 * stays a separate step that happens when the year starts. Idempotent: a second press changes nothing.
 */
export async function registerMyChild(ctx: AuthContext, studentId: string, input: unknown): Promise<{ already: boolean }> {
  if (!(await childIds(ctx)).includes(studentId)) throw notFound("Student");
  parse(familySchema, input);
  let feeRefused: { id: string; label: string } | null = null;
  try {
    return await db.$transaction(async (tx) => {
      const rec = await familyRecord(tx, ctx, studentId);
      if (!rec) throw conflict("The school has not made a final decision about next year yet.");
      const { prog, reg } = rec;
      if (reg.status === "REGISTERED" || reg.status === "ACTIVE") return { already: true };
      if (reg.status === "CANCELLED") throw conflict("This registration was cancelled. Please contact the school office.");
      const today = await schoolToday(tx, ctx.schoolId);
      const opens = reg.academicYear.registrationOpensOn ? formatDateOnly(reg.academicYear.registrationOpensOn) : null;
      const closes = reg.academicYear.registrationClosesOn ? formatDateOnly(reg.academicYear.registrationClosesOn) : null;
      if (opens && today < opens) throw conflict(`Registration for ${reg.academicYear.name} opens on ${opens}.`);
      if (closes && today > closes) throw conflict(`Registration for ${reg.academicYear.name} closed on ${closes}. Please contact the school office.`);

      let classId = reg.classId, streamId = reg.streamId;
      if (!classId) {
        if (!prog.toClassId) throw conflict("The school has not chosen the grade yet.");
        const cls = await tx.schoolClass.findFirst({ where: { id: prog.toClassId, schoolId: ctx.schoolId } });
        if (!cls || !cls.isActive) throw conflict("The grade for next year is not open yet. Please contact the school office.");
        classId = cls.id;
        const places = (await classPlaces(tx, ctx.schoolId, reg.academicYearId)).get(cls.id);
        streamId = places && places.streams.length ? places.recommendedStreamId : null;
        if (places && places.streams.length && !streamId) throw conflict("No stream is available. Please contact the school office.");
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cap:${reg.academicYearId}:${cls.id}`}, 0))`;
        if (cls.capacity !== null) {
          const inClass = await tx.studentEnrollment.count({ where: { schoolId: ctx.schoolId, academicYearId: reg.academicYearId, classId: cls.id, status: "ACTIVE", studentId: { not: reg.studentId } } });
          const held = await tx.annualRegistration.count({ where: { schoolId: ctx.schoolId, academicYearId: reg.academicYearId, classId: cls.id, status: { in: ["PENDING", "REGISTERED"] }, id: { not: reg.id } } });
          if (inClass + held >= cls.capacity) throw conflict(`${cls.name} is full for ${reg.academicYear.name}. Please contact the school office.`);
        }
        await tx.annualRegistration.update({ where: { id: reg.id }, data: { classId, streamId, placedById: ctx.userId, placedAt: new Date() } });
        await writeAudit(tx, actorOf(ctx), { action: "registration.place", entityType: "AnnualRegistration", entityId: reg.id, summary: `${label(reg.student)} · ${reg.academicYear.name}`, changes: { classId, streamId, decidedClassId: prog.toClassId, via: "FAMILY_PORTAL" } });
      }

      const settings = await getLifecycleSettings(tx, ctx.schoolId);
      if (settings.feePolicy === "BLOCK_REGISTRATION") {
        const m = (await yearFinances(tx, ctx.schoolId, [reg.studentId], reg.academicYearId, settings, new Set(reg.clearanceExceptionReason ? [reg.studentId] : []))).get(reg.studentId);
        if (!m || !isCleared(m.state)) { feeRefused = { id: reg.id, label: `${label(reg.student)} · ${reg.academicYear.name}` }; throw conflict("The school asks for school fees to be cleared before registration. Please contact the school office."); }
      }
      await tx.annualRegistration.update({ where: { id: reg.id }, data: { status: "REGISTERED", registeredById: ctx.userId, registeredAt: new Date(), confirmations: { confirmedAt: new Date().toISOString(), confirmedBy: ctx.fullName, via: "FAMILY_PORTAL", note: null } } });
      await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "AnnualRegistration", relatedId: reg.id, kinds: ["RETURNING_PLACEMENT"], by: ctx.userId, note: "Registered by the family" });
      await writeAudit(tx, actorOf(ctx), { action: "registration.confirm", entityType: "AnnualRegistration", entityId: reg.id, summary: `${label(reg.student)} · ${reg.academicYear.name}`, changes: { classId, streamId, via: "FAMILY_PORTAL" } });
      await syncFeeTaskTx(tx, ctx.schoolId, reg.id);
      return { already: false };
    });
  } catch (e) {
    // Finance still learns that a family tried to register while the fee condition was not met (a separate write: the refusal rolled the registration back).
    if (feeRefused) { const f: { id: string; label: string } = feeRefused; await openTask(db, { schoolId: ctx.schoolId, kind: "RETURNING_FEE", relatedType: "AnnualRegistration", relatedId: f.id, relatedLabel: f.label, sourceEvent: "registration.fee_needed", createdById: ctx.userId }); }
    throw e;
  }
}

// ───────────────────────── Joining the class roster ─────────────────────────

export type ActivateResult = { id: string; name: string; ok: boolean; message: string };

async function activateOne(ctx: AuthContext, id: string): Promise<ActivateResult> {
  const head = await db.annualRegistration.findFirst({ where: { id, schoolId: ctx.schoolId }, include: { student: true } });
  if (!head) return { id, name: "", ok: false, message: "Registration not found." };
  const name = nameOf(head.student);
  try {
    await db.$transaction(async (tx) => {
      const reg = await tx.annualRegistration.findFirstOrThrow({ where: { id, schoolId: ctx.schoolId }, include: { student: true, academicYear: true } });
      if (reg.status === "ACTIVE") throw conflict("Already in the class roster.");
      if (reg.status !== "REGISTERED" || !reg.classId) throw conflict(reg.status === "CANCELLED" ? "This registration was cancelled." : "Register the student first (placement and confirmation).");
      if (reg.student.status !== "ENROLLED") throw conflict("The student's status is not Enrolled.");
      const today = await schoolToday(tx, ctx.schoolId);
      if (today < formatDateOnly(reg.academicYear.startsOn)) throw conflict(`${reg.academicYear.name} has not started yet. The student joins the class roster when the year starts.`);
      if (today > formatDateOnly(reg.academicYear.endsOn)) throw conflict(`${reg.academicYear.name} has ended.`);
      const settings = await getLifecycleSettings(tx, ctx.schoolId);
      if (settings.feePolicy === "BLOCK_ACTIVATION") {
        const m = (await yearFinances(tx, ctx.schoolId, [reg.studentId], reg.academicYearId, settings, new Set(reg.clearanceExceptionReason ? [reg.studentId] : []))).get(reg.studentId);
        if (!m || !isCleared(m.state)) throw conflict("The school asks for fee clearance before a student joins the class, and this student is not cleared yet.");
      }
      const placed = await placeStudentTx(tx, ctx, reg.studentId, { academicYearId: reg.academicYearId, classId: reg.classId, streamId: reg.streamId ?? undefined }, { capacityReserved: true, extraAudit: { annualRegistrationId: reg.id } });
      await tx.annualRegistration.update({ where: { id: reg.id }, data: { status: "ACTIVE", enrollmentId: placed.created.id, activatedById: ctx.userId, activatedAt: new Date() } });
      await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "AnnualRegistration", relatedId: reg.id, by: ctx.userId, note: "In the class roster" });
      await writeAudit(tx, actorOf(ctx), { action: "registration.activate", entityType: "AnnualRegistration", entityId: reg.id, summary: `${label(reg.student)} · ${reg.academicYear.name}`, changes: { enrollmentId: placed.created.id, classId: reg.classId, streamId: reg.streamId } });
    });
    return { id, name, ok: true, message: "In the class roster." };
  } catch (e) {
    if (e instanceof AppError) return { id, name, ok: false, message: e.message };
    throw e;
  }
}

/** Puts registered students in the class roster, each in its own transaction (one refusal never blocks the rest) and each result reported. */
export async function activateRegistrations(ctx: AuthContext, ids: string[]): Promise<ActivateResult[]> {
  requirePermission(ctx, "registration.manage");
  const unique = [...new Set(ids)].slice(0, 200);
  const out: ActivateResult[] = [];
  for (const id of unique) out.push(await activateOne(ctx, id));
  return out;
}

const cancelSchema = z.object({ registrationId: uuid(), reason: text(300) });

/** The student is not returning this year. The decision and the student record stay; the registration is closed with a reason (never deleted). */
export async function cancelRegistration(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "registration.manage");
  const d = parse(cancelSchema, input);
  await db.$transaction(async (tx) => {
    const reg = await tx.annualRegistration.findFirst({ where: { id: d.registrationId, schoolId: ctx.schoolId }, include: { student: true, academicYear: true } });
    if (!reg) throw notFound("Registration");
    if (reg.status === "ACTIVE") throw conflict("The student is already in the class roster. Move or withdraw the student instead.");
    if (reg.status === "CANCELLED") throw conflict("This registration is already cancelled.");
    await tx.annualRegistration.update({ where: { id: reg.id }, data: { status: "CANCELLED", cancelReason: d.reason } });
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "AnnualRegistration", relatedId: reg.id, status: "CANCELLED", by: ctx.userId, note: d.reason });
    await writeAudit(tx, actorOf(ctx), { action: "registration.cancel", entityType: "AnnualRegistration", entityId: reg.id, summary: `${label(reg.student)} · ${reg.academicYear.name}`, reason: d.reason });
  });
}

/** A cancelled registration can be opened again (the family changed their mind). Placement starts over. */
export async function reopenRegistration(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "registration.manage");
  const { registrationId } = parse(z.object({ registrationId: uuid() }), input);
  await db.$transaction(async (tx) => {
    const reg = await tx.annualRegistration.findFirst({ where: { id: registrationId, schoolId: ctx.schoolId }, include: { student: true, academicYear: true, progression: true } });
    if (!reg) throw notFound("Registration");
    if (reg.status !== "CANCELLED") throw conflict("Only a cancelled registration can be opened again.");
    if (reg.progression.status !== "APPROVED" || !(reg.progression.outcome === "PROMOTED" || reg.progression.outcome === "REPEAT")) throw conflict("The student's decision no longer brings them back to school.");
    await tx.annualRegistration.update({ where: { id: reg.id }, data: { status: "PENDING", cancelReason: null, classId: null, streamId: null, placedAt: null, placedById: null, capacityOverrideReason: null, gradeOverrideReason: null } });
    await openTask(tx, { schoolId: ctx.schoolId, kind: "RETURNING_PLACEMENT", relatedType: "AnnualRegistration", relatedId: reg.id, relatedLabel: `${label(reg.student)} · ${reg.academicYear.name}`, sourceEvent: "registration.reopen", createdById: ctx.userId, discriminator: String(Date.now()) });
    await writeAudit(tx, actorOf(ctx), { action: "registration.reopen", entityType: "AnnualRegistration", entityId: reg.id, summary: `${label(reg.student)} · ${reg.academicYear.name}` });
  });
}

// ───────────────────────── Fee clearance exceptions and tasks ─────────────────────────

const exceptionSchema = z.object({ registrationId: uuid(), reason: text(300) });

/**
 * Finance approves a payment arrangement: the fee condition is treated as met for this registration. No balance, invoice or payment is changed;
 * the reason, the person and the time are kept, and it can be withdrawn.
 */
export async function setClearanceException(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "fees.clearance.exception");
  const d = parse(exceptionSchema, input);
  await db.$transaction(async (tx) => {
    const reg = await tx.annualRegistration.findFirst({ where: { id: d.registrationId, schoolId: ctx.schoolId }, include: { student: true, academicYear: true } });
    if (!reg) throw notFound("Registration");
    if (reg.status === "CANCELLED" || reg.status === "ACTIVE") throw conflict("This registration is already closed.");
    await tx.annualRegistration.update({ where: { id: reg.id }, data: { clearanceExceptionReason: d.reason, clearanceExceptionById: ctx.userId, clearanceExceptionAt: new Date() } });
    await writeAudit(tx, actorOf(ctx), { action: "registration.clearance_exception", entityType: "AnnualRegistration", entityId: reg.id, summary: `${label(reg.student)} · ${reg.academicYear.name}`, reason: d.reason });
    await syncFeeTaskTx(tx, ctx.schoolId, reg.id);
  });
}

export async function removeClearanceException(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "fees.clearance.exception");
  const { registrationId } = parse(z.object({ registrationId: uuid() }), input);
  await db.$transaction(async (tx) => {
    const reg = await tx.annualRegistration.findFirst({ where: { id: registrationId, schoolId: ctx.schoolId }, include: { student: true, academicYear: true } });
    if (!reg) throw notFound("Registration");
    if (!reg.clearanceExceptionReason) throw conflict("There is no arrangement to withdraw.");
    await tx.annualRegistration.update({ where: { id: reg.id }, data: { clearanceExceptionReason: null, clearanceExceptionById: null, clearanceExceptionAt: null } });
    await writeAudit(tx, actorOf(ctx), { action: "registration.clearance_exception_removed", entityType: "AnnualRegistration", entityId: reg.id, summary: `${label(reg.student)} · ${reg.academicYear.name}` });
    await syncFeeTaskTx(tx, ctx.schoolId, reg.id);
  });
}

/**
 * Keeps the Finance task for a registration in line with the facts: open while the school's policy holds the next step back for fees and the
 * student is not cleared, closed as soon as they are (a payment, an arrangement, a changed policy). Nothing is ever marked paid here.
 */
export async function syncFeeTaskTx(tx: Tx, schoolId: string, registrationId: string): Promise<void> {
  const reg = await tx.annualRegistration.findFirst({ where: { id: registrationId, schoolId }, include: { student: true, academicYear: true } });
  if (!reg) return;
  const settings = await getLifecycleSettings(tx, schoolId);
  const holds: FeePolicy[] = reg.status === "PENDING" && reg.classId ? ["BLOCK_REGISTRATION"] : reg.status === "REGISTERED" ? ["BLOCK_REGISTRATION", "BLOCK_ACTIVATION"] : [];
  let needs = false;
  if (holds.includes(settings.feePolicy)) {
    const m = (await yearFinances(tx, schoolId, [reg.studentId], reg.academicYearId, settings, new Set(reg.clearanceExceptionReason ? [reg.studentId] : []))).get(reg.studentId);
    needs = !m || !isCleared(m.state);
  }
  if (needs) await openTask(tx, { schoolId, kind: "RETURNING_FEE", relatedType: "AnnualRegistration", relatedId: reg.id, relatedLabel: `${label(reg.student)} · ${reg.academicYear.name}`, sourceEvent: "registration.fee_needed" });
  else await closeTasks(tx, { schoolId, relatedType: "AnnualRegistration", relatedId: reg.id, kinds: ["RETURNING_FEE"], by: null, note: "Fee condition met or no longer needed" });
}

/** After money moves (a payment, a reversal): re-check the open registrations of that student so Finance's task and the clearance stay in line. */
export async function syncFeeTasksForStudentTx(tx: Tx, schoolId: string, studentId: string): Promise<void> {
  const regs = await tx.annualRegistration.findMany({ where: { schoolId, studentId, status: { in: ["PENDING", "REGISTERED"] } }, select: { id: true } });
  for (const r of regs) await syncFeeTaskTx(tx, schoolId, r.id);
}
