import { describe, expect, it } from "vitest";
import { computeTermResults, divisionFor, gradeFor, percentOf, rankCompetition, round, subjectPercent, subjectSummary, validateBands, DEFAULT_POLICY, type Band, type MarkEntry } from "@/lib/results/engine";

// A generic test scale (NOT any official scale): A 80+, B 60-79, C 40-59, D 20-39, F 0-19.
const BANDS: Band[] = [
  { grade: "A", min: 80, max: 100, points: 1 }, { grade: "B", min: 60, max: 79, points: 2 }, { grade: "C", min: 40, max: 59, points: 3 },
  { grade: "D", min: 20, max: 39, points: 4 }, { grade: "F", min: 0, max: 19, points: 5 },
];
const entry = (studentId: string, subjectId: string, score: number | null, o: Partial<MarkEntry> = {}): MarkEntry => ({ studentId, subjectId, examId: "e1", status: score === null ? "ABSENT" : "SCORED", score, maxMarks: 100, weight: 100, ...o });

describe("rounding and percentages", () => {
  it("rounds half away from zero consistently", () => {
    expect(round(0.285, 2)).toBe(0.29);
    expect(round(2.5, 0)).toBe(3);
    expect(round(74.45, 1)).toBe(74.5);
    expect(percentOf(37, 50)).toBe(74);
    expect(percentOf(1, 3)).toBe(33.33);
  });
});

describe("grade lookup", () => {
  it("uses band minimums so decimals never fall between bands", () => {
    expect(gradeFor(79.9, BANDS)?.grade).toBe("B");
    expect(gradeFor(80, BANDS)?.grade).toBe("A");
    expect(gradeFor(0, BANDS)?.grade).toBe("F");
    expect(gradeFor(100, BANDS)?.grade).toBe("A");
    expect(gradeFor(19.99, BANDS)?.grade).toBe("F");
    expect(gradeFor(NaN, BANDS)).toBeNull();
    expect(gradeFor(50, [])).toBeNull();
  });
  it("validates band sets", () => {
    expect(validateBands(BANDS)).toBeNull();
    expect(validateBands([])).toMatch(/at least one/);
    expect(validateBands(BANDS.slice(0, 4))).toMatch(/start at 0/);
    expect(validateBands(BANDS.slice(1))).toMatch(/end at 100/);
    expect(validateBands([{ grade: "A", min: 0, max: 60, points: 1 }, { grade: "B", min: 50, max: 100, points: 2 }])).toMatch(/overlap/);
    expect(validateBands([{ grade: "A", min: 0, max: 40, points: 1 }, { grade: "B", min: 60, max: 100, points: 2 }])).toMatch(/gap/);
    expect(validateBands([{ grade: "A", min: 0, max: 100, points: 1 }, { grade: "a", min: 0, max: 100, points: 1 }])).toMatch(/once/);
  });
});

describe("weighted subject result", () => {
  it("weights exams and normalises by the weights actually present", () => {
    // 20/50 = 40% at weight 30, 80/100 = 80% at weight 70 => (40*30 + 80*70) / 100 = 68
    const v = subjectPercent([entry("s", "m", 20, { maxMarks: 50, weight: 30 }), entry("s", "m", 80, { weight: 70 })], DEFAULT_POLICY);
    expect(v).toBe(68);
  });
  it("never turns a missing or exempt mark into zero", () => {
    expect(subjectPercent([entry("s", "m", 60, { weight: 40 }), { ...entry("s", "m", null), status: "EXEMPT", weight: 60 }], DEFAULT_POLICY)).toBe(60);
    expect(subjectPercent([], DEFAULT_POLICY)).toBeNull();
    expect(subjectPercent([{ ...entry("s", "m", null), status: "EXEMPT" }], DEFAULT_POLICY)).toBeNull();
  });
  it("treats absence according to the school's policy", () => {
    const rows = [entry("s", "m", 80, { weight: 50 }), entry("s", "m", null, { weight: 50 })]; // absent in the second exam
    expect(subjectPercent(rows, { ...DEFAULT_POLICY, absentAs: "EXCLUDE" })).toBe(80);
    expect(subjectPercent(rows, { ...DEFAULT_POLICY, absentAs: "ZERO" })).toBe(40);
  });
});

describe("ranking", () => {
  it("uses competition ranking for ties: 1, 2, 2, 4", () => {
    const r = rankCompetition([{ id: "a", value: 90 }, { id: "b", value: 80 }, { id: "c", value: 80 }, { id: "d", value: 70 }]);
    expect([r.get("a"), r.get("b"), r.get("c"), r.get("d")]).toEqual([1, 2, 2, 4]);
  });
  it("ties are decided after rounding to the configured precision", () => {
    const r = rankCompetition([{ id: "a", value: 70.04 }, { id: "b", value: 70.01 }], 1);
    expect(r.get("a")).toBe(1);
    expect(r.get("b")).toBe(1);
  });
});

describe("division", () => {
  const rules = [{ division: "I", minPoints: 7, maxPoints: 17 }, { division: "II", minPoints: 18, maxPoints: 21 }, { division: "III", minPoints: 22, maxPoints: 25 }];
  it("sums the best N subject points", () => {
    expect(divisionFor([1, 2, 2, 3, 3, 5, 5, 5], 7, rules)).toEqual({ division: "II", pointsSum: 21 }); // 1+2+2+3+3+5+5
    expect(divisionFor([1, 1, 2, 2, 3, 3, 4, 9], 7, rules)).toEqual({ division: "I", pointsSum: 16 });
  });
  it("is incomplete with fewer than N graded subjects and absent without rules", () => {
    expect(divisionFor([1, 2, 3], 7, rules)).toEqual({ division: "INC", pointsSum: null });
    expect(divisionFor([1, 2, 3], null, rules)).toEqual({ division: null, pointsSum: null });
    expect(divisionFor([5, 5, 5, 5, 5, 5, 5], 7, rules)).toEqual({ division: null, pointsSum: 35 }); // outside every configured rule
  });
});

describe("term results for a class", () => {
  const students = [{ id: "s1", streamId: "A" }, { id: "s2", streamId: "A" }, { id: "s3", streamId: "B" }, { id: "s4", streamId: "B" }, { id: "s5", streamId: "B" }];
  const subjects = ["math", "eng"];
  const marks = [
    entry("s1", "math", 90), entry("s1", "eng", 70), // avg 80
    entry("s2", "math", 80), entry("s2", "eng", 80), // avg 80 (tie with s1)
    entry("s3", "math", 60), entry("s3", "eng", 40), // avg 50
    entry("s4", "math", 100), // only one subject: avg 100, eng missing (not zero)
    // s5: no marks at all
  ];
  const res = computeTermResults({ students, subjectIds: subjects, entries: marks, bands: BANDS, divisionRules: [], divisionBestN: null, policy: DEFAULT_POLICY });
  const by = (id: string) => res.find((r) => r.studentId === id)!;

  it("computes subject lines, totals, averages and grades", () => {
    expect(by("s1")).toMatchObject({ total: 160, average: 80, grade: "A", subjectCount: 2 });
    expect(by("s3")).toMatchObject({ total: 100, average: 50, grade: "C" });
    expect(by("s1").subjects.map((l) => [l.subjectId, l.percent, l.grade])).toEqual([["math", 90, "A"], ["eng", 70, "B"]]);
  });
  it("does not penalise a missing subject and gives no result to a student without marks", () => {
    expect(by("s4")).toMatchObject({ subjectCount: 1, average: 100, total: 100 });
    expect(by("s5")).toMatchObject({ subjectCount: 0, average: null, grade: null, position: null });
  });
  it("assigns class positions with ties (s4 first, s1 and s2 tied second, s3 fourth) and stream positions", () => {
    expect([by("s4").position, by("s1").position, by("s2").position, by("s3").position]).toEqual([1, 2, 2, 4]);
    expect([by("s1").streamPosition, by("s2").streamPosition]).toEqual([1, 1]);
    expect([by("s4").streamPosition, by("s3").streamPosition]).toEqual([1, 2]);
  });
  it("ranks each subject and summarises the class", () => {
    expect(by("s4").subjects[0]!.position).toBe(1); // math: 100
    expect(by("s1").subjects[0]!.position).toBe(2); // math: 90
    expect(subjectSummary(res, "math")).toMatchObject({ students: 4, mean: 82.5, distribution: { A: 3, B: 1 } });
  });
  it("can rank by total instead of average", () => {
    const byTotal = computeTermResults({ students, subjectIds: subjects, entries: marks, bands: BANDS, divisionRules: [], divisionBestN: null, policy: { ...DEFAULT_POLICY, positionBy: "TOTAL" } });
    // totals: s1 160, s2 160, s3 100, s4 100, so ties share ranks 1 and 3
    expect(["s1", "s2", "s3", "s4"].map((id) => byTotal.find((r) => r.studentId === id)!.position)).toEqual([1, 1, 3, 3]);
  });
  it("is deterministic: the same input always gives the same output", () => {
    const again = computeTermResults({ students, subjectIds: subjects, entries: [...marks].reverse(), bands: BANDS, divisionRules: [], divisionBestN: null, policy: DEFAULT_POLICY });
    expect(JSON.stringify(again.map((r) => [r.studentId, r.average, r.position]).sort())).toBe(JSON.stringify(res.map((r) => [r.studentId, r.average, r.position]).sort()));
  });
});

import { normalizeMark } from "@/lib/results/entry";

describe("normalizeMark", () => {
  it("accepts a valid score and treats empty input as not entered (never zero)", () => {
    expect(normalizeMark({ score: "45.5" }, 100)).toEqual({ ok: true, value: { status: "SCORED", score: 45.5 } });
    expect(normalizeMark({ score: "45,5" }, 100)).toEqual({ ok: true, value: { status: "SCORED", score: 45.5 } });
    expect(normalizeMark({ score: "0" }, 100)).toEqual({ ok: true, value: { status: "SCORED", score: 0 } });
    expect(normalizeMark({ score: "" }, 100)).toEqual({ ok: true, value: null });
    expect(normalizeMark({ status: "", score: null }, 100)).toEqual({ ok: true, value: null });
  });
  it("rejects negative, too large, non-numeric and over-precise scores", () => {
    expect(normalizeMark({ score: "-1" }, 100)).toMatchObject({ ok: false });
    expect(normalizeMark({ score: "100.5" }, 100)).toMatchObject({ ok: false });
    expect(normalizeMark({ score: "abc" }, 100)).toMatchObject({ ok: false });
    expect(normalizeMark({ score: "1e2" }, 100)).toMatchObject({ ok: false });
    expect(normalizeMark({ score: "12.345" }, 100)).toMatchObject({ ok: false });
    expect(normalizeMark({ score: "50" }, 40)).toMatchObject({ ok: false });
    expect(normalizeMark({ score: "40" }, 40)).toMatchObject({ ok: true });
  });
  it("absent/exempt carry no score; scored needs one", () => {
    expect(normalizeMark({ status: "ABSENT" }, 100)).toEqual({ ok: true, value: { status: "ABSENT", score: null } });
    expect(normalizeMark({ status: "exempt", score: "" }, 100)).toEqual({ ok: true, value: { status: "EXEMPT", score: null } });
    expect(normalizeMark({ status: "ABSENT", score: "10" }, 100)).toMatchObject({ ok: false });
    expect(normalizeMark({ status: "SCORED", score: "" }, 100)).toMatchObject({ ok: false });
    expect(normalizeMark({ status: "BOGUS", score: "5" }, 100)).toMatchObject({ ok: false });
  });
});
