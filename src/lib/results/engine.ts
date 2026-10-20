/*
 * Results engine: pure, deterministic, independent of the database. Every rule here is policy-driven:
 * grade bands, points, divisions and how absence is treated all come from the school's configuration.
 * Marks are never silently turned into zero: absent/exempt/missing are explicit states.
 */

export type Band = { grade: string; min: number; max: number; points: number | null };
export type DivisionRuleDef = { division: string; minPoints: number; maxPoints: number };
export type Policy = {
  /** ABSENT marks: leave them out of averages (default) or count them as 0%. */
  absentAs: "EXCLUDE" | "ZERO";
  /** Decimal places for percentages and averages (1 or 2 typical). */
  decimals: number;
  /** Class position is decided by the average or by the total. */
  positionBy: "AVERAGE" | "TOTAL";
};
export const DEFAULT_POLICY: Policy = { absentAs: "EXCLUDE", decimals: 1, positionBy: "AVERAGE" };

export type MarkEntry = { studentId: string; subjectId: string; examId: string; status: "SCORED" | "ABSENT" | "EXEMPT"; score: number | null; maxMarks: number; weight: number };

/** Round half away from zero with a tiny epsilon so 0.285 → 0.29 consistently. */
export function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * f) / f;
}

export const percentOf = (score: number, max: number, decimals = 2): number => round((score / max) * 100, decimals);

/**
 * The grade for a percentage: the band with the highest minimum that the percentage reaches. Using minimums only
 * means decimal percentages (74.5) never fall into a gap between bands such as 65–74 and 75–100.
 */
export function gradeFor(percent: number, bands: Band[]): { grade: string; points: number | null } | null {
  if (!bands.length || !Number.isFinite(percent)) return null;
  const p = Math.min(100, Math.max(0, percent));
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  const hit = sorted.find((b) => p >= b.min);
  return hit ? { grade: hit.grade, points: hit.points } : null;
}

/** Checks a set of bands: they must start at 0, end at 100, not overlap and leave no gap larger than one mark. */
export function validateBands(bands: Band[]): string | null {
  if (!bands.length) return "Add at least one grade band.";
  const s = [...bands].sort((a, b) => a.min - b.min);
  if (new Set(s.map((b) => b.grade.toLowerCase())).size !== s.length) return "Each grade may be used once.";
  if (s[0]!.min !== 0) return "The lowest band must start at 0.";
  if (s[s.length - 1]!.max !== 100) return "The highest band must end at 100.";
  for (const b of s) if (b.min > b.max) return `Band ${b.grade}: the minimum is above the maximum.`;
  for (let i = 1; i < s.length; i++) {
    const gap = s[i]!.min - s[i - 1]!.max;
    if (gap <= 0) return `Bands ${s[i - 1]!.grade} and ${s[i]!.grade} overlap.`;
    if (gap > 1) return `There is a gap between ${s[i - 1]!.grade} and ${s[i]!.grade}.`;
  }
  return null;
}

/**
 * Weighted subject percentage for one student across the exams of a term.
 * Exams with no countable mark (missing, exempt, or absent under EXCLUDE) are left out and the remaining weights are
 * re-normalised, so a missing mark never drags the result down. Returns null when nothing is countable.
 */
export function subjectPercent(entries: MarkEntry[], policy: Policy): number | null {
  let weighted = 0, weights = 0;
  for (const e of entries) {
    let pct: number | null = null;
    if (e.status === "SCORED" && e.score !== null) pct = (e.score / e.maxMarks) * 100;
    else if (e.status === "ABSENT" && policy.absentAs === "ZERO") pct = 0;
    if (pct === null) continue;
    weighted += pct * e.weight;
    weights += e.weight;
  }
  return weights > 0 ? round(weighted / weights, 2) : null;
}

/** Competition ranking: equal values share a rank and the next rank is skipped (1, 2, 2, 4). */
export function rankCompetition<T extends string>(items: { id: T; value: number }[], decimals = 2): Map<T, number> {
  const sorted = [...items].map((i) => ({ id: i.id, v: round(i.value, decimals) })).sort((a, b) => b.v - a.v);
  const out = new Map<T, number>();
  let rank = 0;
  sorted.forEach((it, i) => {
    if (i === 0 || it.v !== sorted[i - 1]!.v) rank = i + 1;
    out.set(it.id, rank);
  });
  return out;
}

export type SubjectLine = { subjectId: string; percent: number; grade: string | null; points: number | null; position: number | null };
export type StudentResult = {
  studentId: string;
  streamId: string | null;
  subjects: SubjectLine[];
  total: number;
  average: number | null;
  grade: string | null;
  pointsSum: number | null;
  division: string | null;
  subjectCount: number;
  position: number | null;
  streamPosition: number | null;
};

export type TermInput = {
  students: { id: string; streamId: string | null }[];
  subjectIds: string[];
  entries: MarkEntry[];
  bands: Band[];
  divisionRules: DivisionRuleDef[];
  divisionBestN: number | null;
  policy: Policy;
};

/** Division from the best N subject points; "INC" when the student has fewer than N graded subjects. */
export function divisionFor(points: number[], bestN: number | null, rules: DivisionRuleDef[]): { division: string | null; pointsSum: number | null } {
  if (!bestN || !rules.length) return { division: null, pointsSum: null };
  if (points.length < bestN) return { division: "INC", pointsSum: null };
  const sum = [...points].sort((a, b) => a - b).slice(0, bestN).reduce((n, p) => n + p, 0);
  const rule = rules.find((r) => sum >= r.minPoints && sum <= r.maxPoints);
  return { division: rule?.division ?? null, pointsSum: sum };
}

/**
 * Term results for a class: subject percentages, grades, totals, averages, division, class and stream positions,
 * and subject positions. Students with no countable subject get no average and no position.
 */
export function computeTermResults(input: TermInput): StudentResult[] {
  const { policy } = input;
  const byStudentSubject = new Map<string, MarkEntry[]>();
  for (const e of input.entries) {
    const k = `${e.studentId}|${e.subjectId}`;
    (byStudentSubject.get(k) ?? byStudentSubject.set(k, []).get(k)!).push(e);
  }

  const results: StudentResult[] = input.students.map((s) => {
    const subjects: SubjectLine[] = [];
    for (const subjectId of input.subjectIds) {
      const percent = subjectPercent(byStudentSubject.get(`${s.id}|${subjectId}`) ?? [], policy);
      if (percent === null) continue;
      const g = gradeFor(percent, input.bands);
      subjects.push({ subjectId, percent: round(percent, policy.decimals), grade: g?.grade ?? null, points: g?.points ?? null, position: null });
    }
    const total = round(subjects.reduce((n, x) => n + x.percent, 0), 2);
    const average = subjects.length ? round(total / subjects.length, policy.decimals) : null;
    const pts = subjects.flatMap((x) => (x.points === null ? [] : [x.points]));
    const { division, pointsSum } = divisionFor(pts, input.divisionBestN, input.divisionRules);
    return {
      studentId: s.id, streamId: s.streamId, subjects, total, average,
      grade: average === null ? null : (gradeFor(average, input.bands)?.grade ?? null),
      pointsSum, division, subjectCount: subjects.length, position: null, streamPosition: null,
    };
  });

  // Class and stream positions.
  const metric = (r: StudentResult) => (policy.positionBy === "TOTAL" ? r.total : (r.average as number));
  const ranked = results.filter((r) => r.subjectCount > 0);
  const overall = rankCompetition(ranked.map((r) => ({ id: r.studentId, value: metric(r) })), policy.decimals);
  const streams = new Set(ranked.map((r) => r.streamId));
  const inStream = new Map<string, Map<string, number>>();
  for (const st of streams) {
    if (st === null) continue;
    inStream.set(st, rankCompetition(ranked.filter((r) => r.streamId === st).map((r) => ({ id: r.studentId, value: metric(r) })), policy.decimals));
  }
  for (const r of ranked) {
    r.position = overall.get(r.studentId) ?? null;
    r.streamPosition = r.streamId ? (inStream.get(r.streamId)?.get(r.studentId) ?? null) : null;
  }

  // Subject positions.
  for (const subjectId of input.subjectIds) {
    const rows = results.flatMap((r) => { const l = r.subjects.find((x) => x.subjectId === subjectId); return l ? [{ id: r.studentId, value: l.percent, line: l }] : []; });
    const rk = rankCompetition(rows.map((x) => ({ id: x.id, value: x.value })), policy.decimals);
    for (const x of rows) x.line.position = rk.get(x.id) ?? null;
  }
  return results;
}

/** Class summary per subject: how many students, mean percentage and grade distribution. */
export function subjectSummary(results: StudentResult[], subjectId: string, decimals = 1) {
  const lines = results.flatMap((r) => r.subjects.filter((l) => l.subjectId === subjectId));
  const dist: Record<string, number> = {};
  for (const l of lines) if (l.grade) dist[l.grade] = (dist[l.grade] ?? 0) + 1;
  return { students: lines.length, mean: lines.length ? round(lines.reduce((n, l) => n + l.percent, 0) / lines.length, decimals) : null, distribution: dist };
}
