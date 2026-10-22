import { describe, expect, it } from "vitest";
import { checkDecision, clearanceState, examCompletion, isCleared, nextGrade, nextStep, orderClasses, placesLeft, promotionSignal, recommendStream, type GradeClass } from "@/lib/lifecycle/rules";

const c = (id: string, name: string, levelSort: number, sortOrder: number, extra: Partial<GradeClass> = {}): GradeClass => ({ id, name, levelSort, sortOrder, nextClassId: null, isFinalGrade: false, ...extra });
const school = [c("g1", "Grade One", 1, 1), c("g2", "Grade Two", 1, 2), c("g3", "Grade Three", 1, 3), c("f1", "Form I", 2, 1, { isFinalGrade: false }), c("f2", "Form II", 2, 2, { isFinalGrade: true })];

describe("the grade that follows", () => {
  it("is the next class in the school's order, across levels, and nothing is hard-coded", () => {
    expect(orderClasses([...school].reverse()).map((x) => x.id)).toEqual(["g1", "g2", "g3", "f1", "f2"]);
    expect(nextGrade(school[0]!, school)).toEqual({ kind: "NEXT", classId: "g2" });
    expect(nextGrade(school[2]!, school)).toEqual({ kind: "NEXT", classId: "f1" }); // the last class of one level leads to the first of the next
  });
  it("a final grade, or the last class, completes school instead of inventing a next grade", () => {
    expect(nextGrade(school[4]!, school)).toEqual({ kind: "FINAL" });
    expect(nextGrade(c("x", "Last", 9, 9), [...school, c("x", "Last", 9, 9)])).toEqual({ kind: "FINAL" });
  });
  it("a class that names its own next grade overrides the order", () => {
    const withOverride = school.map((x) => (x.id === "g1" ? { ...x, nextClassId: "g3" } : x));
    expect(nextGrade(withOverride[0]!, withOverride)).toEqual({ kind: "NEXT", classId: "g3" });
  });
});

describe("examination completion of a year", () => {
  const req = [{ examSubjectId: "a", label: "English", unit: "LOCKED" as const }, { examSubjectId: "b", label: "Maths", unit: "LOCKED" as const }];
  it("is complete only when every examined subject is finalized and the student has a result for it", () => {
    const marks = new Map([["a", { status: "SCORED", percent: 80 }], ["b", { status: "SCORED", percent: 60 }]]);
    expect(examCompletion(req, marks)).toMatchObject({ state: "COMPLETE", average: 70, missing: [] });
    expect(examCompletion(req, new Map([["a", { status: "SCORED", percent: 80 }]]))).toMatchObject({ state: "INCOMPLETE", missing: ["Maths (no result)"] });
    expect(examCompletion([{ ...req[0]!, unit: "OPEN" }, req[1]!], marks).missing).toEqual(["English (results not finalized)"]);
  });
  it("an explicit absent or exempt result counts as a result but not in the average; no examinations at all is not complete", () => {
    const marks = new Map([["a", { status: "ABSENT", percent: null }], ["b", { status: "SCORED", percent: 50 }]]);
    expect(examCompletion(req, marks)).toMatchObject({ state: "COMPLETE", average: 50, scored: 1 });
    expect(examCompletion([], new Map()).state).toBe("NO_EXAMS");
  });
  it("only gives a hint: not ready, ready, eligible or below the configured average; never a decision", () => {
    const done = examCompletion(req, new Map([["a", { status: "SCORED", percent: 80 }], ["b", { status: "SCORED", percent: 60 }]]));
    expect(promotionSignal(examCompletion(req, new Map()), 50)).toBe("NOT_READY");
    expect(promotionSignal(done, null)).toBe("READY"); // the school set no average: the office decides
    expect(promotionSignal(done, 60)).toBe("ELIGIBLE");
    expect(promotionSignal(done, 75)).toBe("BELOW");
  });
});

describe("fee clearance of a year", () => {
  const base = { billed: true, currentOutstanding: 0, previousOutstanding: 0, maxOutstanding: 0, previousCounts: false, exception: false };
  it("needs the year to be billed and paid up to the allowed limit, from verified money", () => {
    expect(clearanceState(base)).toBe("CLEARED");
    expect(clearanceState({ ...base, billed: false })).toBe("NOT_BILLED");
    expect(clearanceState({ ...base, currentOutstanding: 5_000_000 })).toBe("OUTSTANDING");
    expect(clearanceState({ ...base, currentOutstanding: 500, maxOutstanding: 1000 })).toBe("CLEARED"); // within the school's limit
  });
  it("an earlier year's debt blocks clearance only when the school says so, and an approved arrangement clears without changing a balance", () => {
    expect(clearanceState({ ...base, previousOutstanding: 9_000_000 })).toBe("CLEARED");
    expect(clearanceState({ ...base, previousOutstanding: 9_000_000, previousCounts: true })).toBe("OUTSTANDING");
    expect(clearanceState({ ...base, currentOutstanding: 9, previousCounts: true, exception: true })).toBe("CLEARED_EXCEPTION");
    expect(isCleared("CLEARED_EXCEPTION")).toBe(true);
    expect(isCleared("NOT_BILLED")).toBe(false);
  });
});

describe("filling a class", () => {
  it("counts the students in the class and the places reserved for returning students", () => {
    expect(placesLeft(30, 28, 1)).toBe(1);
    expect(placesLeft(30, 30, 0)).toBe(0);
    expect(placesLeft(30, 25, 9)).toBe(0);
    expect(placesLeft(null, 99, 99)).toBeNull();
  });
  it("suggests the least filled stream", () => {
    expect(recommendStream([{ id: "A", count: 12 }, { id: "B", count: 9 }, { id: "C", count: 9 }])).toBe("B");
    expect(recommendStream([])).toBeNull();
  });
});

describe("who acts next for a returning student", () => {
  const base = { outcome: "PROMOTED", decision: "APPROVED" as const, registration: "PENDING" as const, placed: false, clearance: "NOT_BILLED" as const, feePolicy: "INFORM_ONLY" as const, yearOpen: false };
  it("follows academic review, head approval, placement, registration, fees and activation, each with its department", () => {
    expect(nextStep({ ...base, decision: "NONE", outcome: null, registration: "NONE" })).toEqual({ stage: "ACADEMIC_REVIEW", department: "ACADEMIC", blocked: true });
    expect(nextStep({ ...base, outcome: "PENDING_REVIEW" })).toMatchObject({ stage: "ACADEMIC_REVIEW" }); // never moves on without the Academic Office
    expect(nextStep({ ...base, decision: "AWAITING_HEAD" })).toMatchObject({ stage: "HEAD_APPROVAL", department: "HEAD" });
    expect(nextStep({ ...base, registration: "NONE" })).toMatchObject({ stage: "NEEDS_REGISTRATION_RECORD", department: "ADMISSIONS" });
    expect(nextStep(base)).toMatchObject({ stage: "NEEDS_PLACEMENT", department: "ADMISSIONS" });
    expect(nextStep({ ...base, placed: true })).toMatchObject({ stage: "NEEDS_REGISTRATION", department: "ADMISSIONS" });
    expect(nextStep({ ...base, placed: true, registration: "REGISTERED", clearance: "CLEARED" })).toMatchObject({ stage: "WAITING_YEAR_OPEN" });
    expect(nextStep({ ...base, placed: true, registration: "REGISTERED", clearance: "CLEARED", yearOpen: true })).toMatchObject({ stage: "READY_TO_ACTIVATE", department: "ADMISSIONS" });
    expect(nextStep({ ...base, placed: true, registration: "ACTIVE", clearance: "CLEARED", yearOpen: true })).toMatchObject({ stage: "ACTIVE" });
  });
  it("unpaid fees hold back a step only when the school's policy says so; otherwise they only inform", () => {
    const reg = { ...base, placed: true, registration: "REGISTERED" as const, clearance: "OUTSTANDING" as const, yearOpen: true };
    expect(nextStep({ ...reg, feePolicy: "INFORM_ONLY" })).toMatchObject({ stage: "READY_TO_ACTIVATE", blocked: false });
    expect(nextStep({ ...reg, feePolicy: "BLOCK_ACTIVATION" })).toEqual({ stage: "NEEDS_FEE", department: "FINANCE", blocked: true });
    expect(nextStep({ ...base, placed: true, clearance: "OUTSTANDING", feePolicy: "BLOCK_REGISTRATION" })).toMatchObject({ stage: "NEEDS_FEE" });
    expect(nextStep({ ...base, placed: true, clearance: "OUTSTANDING", feePolicy: "BLOCK_ACTIVATION" })).toMatchObject({ stage: "NEEDS_REGISTRATION" }); // registration is not held back
  });
  it("completed and left students have no next grade to prepare", () => {
    expect(nextStep({ ...base, outcome: "COMPLETED", registration: "NONE" })).toMatchObject({ stage: "COMPLETED", department: "NONE" });
    expect(nextStep({ ...base, outcome: "TRANSFERRED", registration: "NONE" })).toMatchObject({ stage: "LEFT" });
    expect(nextStep({ ...base, registration: "CANCELLED" })).toMatchObject({ stage: "NOT_RETURNING" });
  });
});

describe("checkDecision", () => {
  const classes: GradeClass[] = [
    { id: "c1", name: "I", levelSort: 1, sortOrder: 1, nextClassId: null, isFinalGrade: false },
    { id: "c2", name: "II", levelSort: 1, sortOrder: 2, nextClassId: null, isFinalGrade: false },
    { id: "c3", name: "III", levelSort: 1, sortOrder: 3, nextClassId: null, isFinalGrade: true },
  ];
  const complete = { state: "COMPLETE" as const, missing: [], average: 70, scored: 2, required: 2 };
  const incomplete = { state: "INCOMPLETE" as const, missing: ["Maths (results not finalized)"], average: null, scored: 0, required: 1 };
  const base = { classes, requestedTo: null, completion: complete, signal: "READY" as const, note: "" };
  it("promotes to the next grade without an exception when results are complete", () => {
    expect(checkDecision({ ...base, outcome: "PROMOTED", cls: classes[0]! })).toEqual({ toClassId: "c2", exceptions: [], error: null });
  });
  it("repeat keeps the grade", () => {
    expect(checkDecision({ ...base, outcome: "REPEAT", cls: classes[1]! }).toClassId).toBe("c2");
  });
  it("the final grade cannot be promoted but can be completed without an exception", () => {
    expect(checkDecision({ ...base, outcome: "PROMOTED", cls: classes[2]! }).error).toMatch(/final grade/i);
    expect(checkDecision({ ...base, outcome: "COMPLETED", cls: classes[2]! })).toEqual({ toClassId: null, exceptions: [], error: null });
  });
  it("skipping a grade, incomplete results and promoting below the school's average are exceptions", () => {
    expect(checkDecision({ ...base, outcome: "PROMOTED", cls: classes[0]!, requestedTo: "c3" }).exceptions).toHaveLength(1);
    expect(checkDecision({ ...base, outcome: "PROMOTED", cls: classes[0]!, completion: incomplete }).exceptions[0]).toMatch(/not complete/i);
    expect(checkDecision({ ...base, outcome: "PROMOTED", cls: classes[0]!, signal: "BELOW" }).exceptions[0]).toMatch(/below/i);
    expect(checkDecision({ ...base, outcome: "COMPLETED", cls: classes[0]! }).exceptions[0]).toMatch(/not the final grade/i);
  });
  it("pending review needs nothing; leaving needs a reason", () => {
    expect(checkDecision({ ...base, outcome: "PENDING_REVIEW", cls: classes[0]!, completion: incomplete })).toEqual({ toClassId: null, exceptions: [], error: null });
    expect(checkDecision({ ...base, outcome: "WITHDRAWN", cls: classes[0]! }).error).toMatch(/why/i);
    expect(checkDecision({ ...base, outcome: "TRANSFERRED", cls: classes[0]!, note: "Moved away" }).error).toBeNull();
  });
});
