import { db } from "@/lib/db";
import { requireAnyPermission, type AuthContext } from "@/lib/auth/context";
import { formatDateOnly } from "@/lib/dates";
import { nextGrade } from "@/lib/lifecycle/rules";
import { schoolToday } from "@/server/balances";
import { loadGrades, loadYears, yearAfter, yearBefore } from "@/server/lifecycle-data";

/*
 * Is a new academic year ready? A plain checklist worked out from the records (nothing is stored): the year and its terms, the registration
 * dates, the previous year's decisions, the classes and their next grades, the fee structures, and how far the returning students have come.
 * Each line says what it counted so the person knows what to fix, and which department fixes it.
 */

export type ReadyCheck = { key: string; ok: boolean; warn?: boolean; n?: number; of?: number; text?: string; href?: string };

export async function yearReadiness(ctx: AuthContext, yearId?: string) {
  requireAnyPermission(ctx, ["progression.read", "registration.read", "school.settings.read"]);
  const years = await loadYears(db, ctx.schoolId);
  const current = years.find((y) => y.isCurrent) ?? null;
  const year = (yearId ? years.find((y) => y.id === yearId) : null) ?? (current ? yearAfter(years, current.id) : null) ?? current;
  if (!year) return { year: null, years, previous: null, checks: [] as ReadyCheck[], ready: false };
  const previous = yearBefore(years, year.id);
  const today = await schoolToday(db, ctx.schoolId);
  const grades = await loadGrades(db, ctx.schoolId);
  const checks: ReadyCheck[] = [];

  const terms = await db.term.count({ where: { schoolId: ctx.schoolId, academicYearId: year.id } });
  checks.push({ key: "terms", ok: terms > 0, n: terms, href: "/academic-setup" });
  checks.push({ key: "dates", ok: !!(year.registrationOpensOn && year.registrationClosesOn), text: year.registrationOpensOn && year.registrationClosesOn ? `${formatDateOnly(year.registrationOpensOn)} → ${formatDateOnly(year.registrationClosesOn)}` : undefined, href: "/academic-setup" });
  if (year.registrationClosesOn && formatDateOnly(year.registrationClosesOn) < today) checks.push({ key: "closed", ok: false, warn: true, text: formatDateOnly(year.registrationClosesOn) });

  const lastGrade = grades.filter((g) => g.isActive).length;
  const noNext = grades.filter((g) => g.isActive && nextGrade(g, grades).kind === "FINAL" && !g.isFinalGrade && !g.nextClassId);
  checks.push({ key: "grades", ok: lastGrade > 0, n: lastGrade, href: "/academic-setup" });
  checks.push({ key: "finalGrade", ok: grades.some((g) => g.isFinalGrade || g.nextClassId === null), n: grades.filter((g) => g.isFinalGrade).length, text: noNext.map((g) => g.name).join(", "), warn: noNext.length > 1, href: "/academic-setup" });
  checks.push({ key: "capacity", ok: grades.filter((g) => g.isActive).every((g) => g.capacity !== null), n: grades.filter((g) => g.isActive && g.capacity === null).length, warn: true, href: "/academic-setup" });

  const structures = await db.feeStructure.count({ where: { schoolId: ctx.schoolId, academicYearId: year.id, isActive: true } });
  checks.push({ key: "fees", ok: structures > 0, n: structures, href: "/finance/fees" });

  if (previous) {
    const roll = await db.studentEnrollment.findMany({ where: { schoolId: ctx.schoolId, academicYearId: previous.id, status: "ACTIVE", student: { status: "ENROLLED" } }, select: { studentId: true } });
    const decided = await db.studentProgression.findMany({ where: { schoolId: ctx.schoolId, fromAcademicYearId: previous.id, status: { not: "SUPERSEDED" } }, select: { studentId: true, status: true, outcome: true } });
    const onRoll = new Set(roll.map((r) => r.studentId));
    const approved = decided.filter((d) => d.status === "APPROVED").length;
    const waiting = decided.filter((d) => d.status === "AWAITING_HEAD").length;
    const review = decided.filter((d) => d.outcome === "PENDING_REVIEW").length;
    const undecided = [...onRoll].filter((id) => !decided.some((d) => d.studentId === id)).length;
    checks.push({ key: "undecided", ok: undecided === 0, n: undecided, of: onRoll.size + decided.filter((d) => !onRoll.has(d.studentId)).length, href: "/academic-office/progression" });
    checks.push({ key: "review", ok: review === 0, n: review, href: "/academic-office/progression?show=review" });
    checks.push({ key: "headWaiting", ok: waiting === 0, n: waiting, href: "/academic-office/progression?show=awaiting_head" });
    checks.push({ key: "approved", ok: approved > 0 && undecided === 0 && waiting === 0 && review === 0, n: approved, href: "/academic-office/progression" });
  }

  const regs = await db.annualRegistration.groupBy({ by: ["status"], where: { schoolId: ctx.schoolId, academicYearId: year.id }, _count: { _all: true } });
  const count = (s: string) => regs.find((r) => r.status === s)?._count._all ?? 0;
  const placedPending = await db.annualRegistration.count({ where: { schoolId: ctx.schoolId, academicYearId: year.id, status: "PENDING", classId: { not: null } } });
  const unplaced = count("PENDING") - placedPending;
  checks.push({ key: "registrations", ok: regs.length > 0, n: regs.reduce((n, r) => n + r._count._all, 0), href: "/admissions/returning" });
  checks.push({ key: "unplaced", ok: unplaced === 0, n: unplaced, href: "/admissions/returning?stage=NEEDS_PLACEMENT" });
  checks.push({ key: "toActivate", ok: count("REGISTERED") === 0, n: count("REGISTERED"), href: "/admissions/returning?stage=READY_TO_ACTIVATE" });
  checks.push({ key: "active", ok: count("ACTIVE") > 0, n: count("ACTIVE"), href: "/admissions/returning" });

  const required = checks.filter((c) => !c.warn);
  return { year, years, previous, checks, ready: required.every((c) => c.ok) };
}

// ───────────────────────── One student's years ─────────────────────────

export type TimelineEntry = { at: Date; kind: "ENROLMENT" | "DECISION" | "REGISTRATION" | "STATUS" | "FEES"; title: string; detail: string };

/**
 * The student's whole story at school in one place, newest first: where they studied each year, what was decided at the end of it, how they came
 * back, status changes and (only for people who may see money) what each year's fees came to. One student, one record, one ID for life.
 */
export async function studentTimeline(ctx: AuthContext, studentId: string): Promise<TimelineEntry[]> {
  const out: TimelineEntry[] = [];
  const grades = await loadGrades(db, ctx.schoolId);
  const className = new Map(grades.map((g) => [g.id, g.name]));
  const enrols = await db.studentEnrollment.findMany({ where: { schoolId: ctx.schoolId, studentId }, include: { academicYear: { select: { name: true } }, stream: { select: { name: true } } }, orderBy: { startedOn: "asc" } });
  for (const e of enrols) out.push({ at: e.startedOn, kind: "ENROLMENT", title: `${e.academicYear.name}: ${className.get(e.classId) ?? ""}${e.stream ? ` ${e.stream.name}` : ""}`, detail: `${e.status}${e.endedOn ? ` · until ${formatDateOnly(e.endedOn)}` : ""}` });
  const statuses = await db.studentStatusHistory.findMany({ where: { schoolId: ctx.schoolId, studentId }, orderBy: { effectiveOn: "asc" } });
  for (const s of statuses) out.push({ at: s.effectiveOn, kind: "STATUS", title: `${s.fromStatus} → ${s.toStatus}`, detail: s.reason });
  if (ctx.permissions.has("progression.read")) {
    const progs = await db.studentProgression.findMany({ where: { schoolId: ctx.schoolId, studentId, status: { not: "SUPERSEDED" } }, include: { fromYear: { select: { name: true } } } });
    for (const p of progs) out.push({ at: p.approvedAt ?? p.preparedAt, kind: "DECISION", title: `${p.fromYear.name}: ${p.outcome}${p.toClassId ? ` → ${className.get(p.toClassId) ?? ""}` : ""}`, detail: `${p.status}${p.exceptionReason ? ` · exception: ${p.exceptionReason}` : ""}` });
  }
  if (ctx.permissions.has("registration.read")) {
    const regs = await db.annualRegistration.findMany({ where: { schoolId: ctx.schoolId, studentId }, include: { academicYear: { select: { name: true } } } });
    for (const r of regs) out.push({ at: r.activatedAt ?? r.registeredAt ?? r.placedAt ?? r.createdAt, kind: "REGISTRATION", title: `${r.academicYear.name}: ${r.status}${r.classId ? ` · ${className.get(r.classId) ?? ""}` : ""}`, detail: r.cancelReason ?? "" });
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}
