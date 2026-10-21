import { describe, expect, it } from "vitest";
import { examLabel, examProgress, examsAllowDecision, interviewStage, isFinal, isOpenForMarks, validateMark } from "@/lib/admissions/exams";
import { stageHref } from "@/lib/admissions/links";

const t = (subjectId: string, status: Parameters<typeof isFinal>[0]) => ({ subjectId, status });

describe("examination progress of an applicant", () => {
  it("is NONE when nothing is required and nothing is assigned", () => {
    expect(examProgress({ requiredSubjectIds: [], tasks: [], approval: false }).state).toBe("NONE");
    expect(examsAllowDecision("NONE")).toBe(true);
  });
  it("is NOT_ASSIGNED while a required subject has no teacher", () => {
    const p = examProgress({ requiredSubjectIds: ["eng", "math"], tasks: [t("eng", "SUBMITTED")], approval: false });
    expect(p.state).toBe("NOT_ASSIGNED");
    expect(p.missingSubjectIds).toEqual(["math"]);
    expect(examsAllowDecision(p.state)).toBe(false);
  });
  it("stays INCOMPLETE when one of two required subjects is not marked", () => {
    const p = examProgress({ requiredSubjectIds: ["eng", "math"], tasks: [t("eng", "SUBMITTED"), t("math", "ASSIGNED")], approval: false });
    expect(p).toMatchObject({ state: "INCOMPLETE", total: 2, final: 1, openSubjectIds: ["math"] });
    expect(examProgress({ requiredSubjectIds: ["eng", "math"], tasks: [t("eng", "SUBMITTED"), t("math", "DRAFT")], approval: false }).state).toBe("INCOMPLETE"); // saved but not submitted
    expect(examProgress({ requiredSubjectIds: ["eng", "math"], tasks: [t("eng", "SUBMITTED"), t("math", "RETURNED")], approval: false }).state).toBe("INCOMPLETE"); // returned for correction
  });
  it("is COMPLETE once every required result is submitted (no approval asked)", () => {
    const p = examProgress({ requiredSubjectIds: ["eng", "math"], tasks: [t("eng", "SUBMITTED"), t("math", "APPROVED")], approval: false });
    expect(p.state).toBe("COMPLETE");
    expect(examsAllowDecision(p.state)).toBe(true);
  });
  it("waits for approval when the school asks for it: submitted is not final until approved", () => {
    expect(isFinal("SUBMITTED", true)).toBe(false);
    expect(isFinal("APPROVED", true)).toBe(true);
    expect(isFinal("SUBMITTED", false)).toBe(true);
    const both = [t("eng", "SUBMITTED"), t("math", "SUBMITTED")];
    expect(examProgress({ requiredSubjectIds: ["eng", "math"], tasks: both, approval: true }).state).toBe("AWAITING_REVIEW");
    expect(examProgress({ requiredSubjectIds: ["eng", "math"], tasks: [t("eng", "APPROVED"), t("math", "SUBMITTED")], approval: true }).state).toBe("AWAITING_REVIEW");
    expect(examProgress({ requiredSubjectIds: ["eng", "math"], tasks: [t("eng", "APPROVED"), t("math", "DRAFT")], approval: true }).state).toBe("INCOMPLETE"); // a missing mark outranks a pending approval
    expect(examProgress({ requiredSubjectIds: ["eng", "math"], tasks: [t("eng", "APPROVED"), t("math", "APPROVED")], approval: true }).state).toBe("COMPLETE");
  });
  it("ignores withdrawn assignments", () => {
    const p = examProgress({ requiredSubjectIds: ["eng"], tasks: [t("eng", "CANCELLED")], approval: false });
    expect(p.state).toBe("NOT_ASSIGNED");
    expect(examProgress({ requiredSubjectIds: [], tasks: [t("eng", "CANCELLED")], approval: false }).state).toBe("NONE");
  });
  it("only an unsubmitted or returned task is open for marks", () => {
    expect(["ASSIGNED", "DRAFT", "RETURNED"].every((s) => isOpenForMarks(s as "DRAFT"))).toBe(true);
    expect(["SUBMITTED", "APPROVED", "CANCELLED"].some((s) => isOpenForMarks(s as "DRAFT"))).toBe(false);
  });
});

describe("where an applicant stands in the interview list", () => {
  const later = new Date(Date.now() + 86_400_000), earlier = new Date(Date.now() - 3_600_000);
  it("is SCHEDULED until the interview time, then follows the results", () => {
    expect(interviewStage({ interviewAt: later, now: Date.now(), progress: "INCOMPLETE" })).toBe("SCHEDULED");
    expect(interviewStage({ interviewAt: earlier, now: Date.now(), progress: "INCOMPLETE" })).toBe("EXAMS");
    expect(interviewStage({ interviewAt: earlier, now: Date.now(), progress: "NOT_ASSIGNED" })).toBe("EXAMS");
    expect(interviewStage({ interviewAt: earlier, now: Date.now(), progress: "AWAITING_REVIEW" })).toBe("REVIEW");
    expect(interviewStage({ interviewAt: earlier, now: Date.now(), progress: "COMPLETE" })).toBe("READY");
    expect(interviewStage({ interviewAt: earlier, now: Date.now(), progress: "NONE" })).toBe("READY");
  });
  it("labels a task from its status and the interview time", () => {
    expect(examLabel("ASSIGNED", later, Date.now(), false)).toBe("SCHEDULED");
    expect(examLabel("ASSIGNED", earlier, Date.now(), false)).toBe("AWAITING_MARKING");
    expect(examLabel("DRAFT", earlier, Date.now(), false)).toBe("MARKING");
    expect(examLabel("SUBMITTED", earlier, Date.now(), true)).toBe("AWAITING_REVIEW");
    expect(examLabel("SUBMITTED", earlier, Date.now(), false)).toBe("SUBMITTED");
    expect(examLabel("RETURNED", earlier, Date.now(), false)).toBe("RETURNED");
  });
});

describe("marks", () => {
  const base = { max: 100, outcomes: ["Pass", "Absent"] };
  it("accepts a mark from 0 to the maximum and refuses one above it", () => {
    expect(validateMark({ ...base, mark: "85" })).toEqual({ ok: true, mark: 85, outcome: null });
    expect(validateMark({ ...base, mark: "72.5" })).toEqual({ ok: true, mark: 72.5, outcome: null });
    expect(validateMark({ ...base, mark: "0" })).toEqual({ ok: true, mark: 0, outcome: null });
    expect(validateMark({ ...base, mark: "120" })).toMatchObject({ ok: false, field: "mark" });
    expect(validateMark({ max: 50, outcomes: [], mark: "60" })).toMatchObject({ ok: false, field: "mark" }); // another scale, another maximum
    expect(validateMark({ max: 50, outcomes: [], mark: "45" })).toMatchObject({ ok: true });
  });
  it("refuses blanks, negatives, text and three decimals", () => {
    for (const bad of ["", "abc", "-5", "7.123", "1e3"]) expect(validateMark({ ...base, mark: bad }).ok).toBe(false);
  });
  it("accepts a non-numeric outcome only when the school configured it, and not together with a mark", () => {
    expect(validateMark({ ...base, outcome: "Pass" })).toEqual({ ok: true, mark: null, outcome: "Pass" });
    expect(validateMark({ ...base, outcome: "Maybe" })).toMatchObject({ ok: false, field: "outcome" });
    expect(validateMark({ max: 100, outcomes: [], outcome: "Pass" })).toMatchObject({ ok: false });
    expect(validateMark({ ...base, mark: "50", outcome: "Pass" })).toMatchObject({ ok: false });
  });
});

describe("opening a record shows the screen of its own stage", () => {
  it("never sends an interview, accepted or enrolled applicant back to the application page", () => {
    expect(stageHref({ id: "a1", state: "NEW" })).toBe("/admissions/a1");
    expect(stageHref({ id: "a1", state: "REVIEWED" })).toBe("/admissions/a1");
    expect(stageHref({ id: "a1", state: "INTERVIEW_SCHEDULED", interviewId: "i9" })).toBe("/admissions/interviews/i9");
    expect(stageHref({ id: "a1", state: "AWAITING_DECISION", interviewId: null })).toBe("/admissions/interviews/a1");
    expect(stageHref({ id: "a1", state: "ACCEPTED" })).toBe("/admissions/accepted/a1");
  });
});
