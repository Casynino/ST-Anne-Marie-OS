import { describe, expect, it } from "vitest";
import { assessmentResolved, completeness, interviewState, stageOf, workflowProgress, workflowState, WORKFLOW_STATES } from "@/lib/admissions/rules";

const base = { status: "APPLIED" as const, review: "PENDING" as const, liveInterview: false, assessmentResolved: false };

describe("the single status of an application", () => {
  it("follows the review step by step and never calls an unreviewed application ready for a decision", () => {
    expect(workflowState(base)).toBe("NEW");
    expect(workflowState({ ...base, review: "IN_REVIEW" })).toBe("UNDER_REVIEW");
    expect(workflowState({ ...base, review: "RETURNED" })).toBe("NEEDS_INFO");
    expect(workflowState({ ...base, review: "VERIFIED" })).toBe("REVIEWED");
    expect(workflowState({ ...base, review: "VERIFIED", assessmentResolved: true })).toBe("AWAITING_DECISION");
    expect(workflowState({ ...base, assessmentResolved: true })).toBe("NEW"); // reviewed first, whatever the interview says
  });
  it("an application with an interview date is in the interview list, reviewed or not; a returned one still needs more information", () => {
    expect(workflowState({ ...base, review: "VERIFIED", liveInterview: true })).toBe("INTERVIEW_SCHEDULED");
    expect(workflowState({ ...base, status: "INTERVIEW", review: "PENDING", liveInterview: true })).toBe("INTERVIEW_SCHEDULED");
    expect(workflowState({ ...base, review: "RETURNED", liveInterview: true })).toBe("NEEDS_INFO");
    expect(workflowState({ ...base, review: "PENDING" })).toBe("NEW"); // no date: it waits under review
    expect(workflowState({ ...base, review: "PENDING", assessmentResolved: true, interviewHeld: true })).toBe("AWAITING_DECISION"); // the interview was held: it does not fall back under review
    expect(workflowState({ ...base, review: "PENDING", assessmentResolved: true })).toBe("NEW"); // nothing was required and nothing held: still under review
  });
  it("puts each status in the list it belongs to: review, then interview (an accepted applicant not yet enrolled stays in the interview list)", () => {
    expect((["NEW", "UNDER_REVIEW", "NEEDS_INFO"] as const).map(stageOf)).toEqual(["review", "review", "review"]);
    expect((["REVIEWED", "INTERVIEW_SCHEDULED", "AWAITING_DECISION", "ACCEPTED"] as const).map(stageOf)).toEqual(["interview", "interview", "interview", "interview"]);
    expect(stageOf("ENROLLED")).toBe("enrolled");
    expect(stageOf("REJECTED")).toBe("closed");
    expect(stageOf("WITHDRAWN")).toBe("closed");
  });
  it("closed and accepted applications show their final status", () => {
    for (const s of ["ACCEPTED", "ENROLLED", "REJECTED", "WITHDRAWN"] as const) expect(workflowState({ ...base, status: s, review: "VERIFIED", liveInterview: true })).toBe(s);
  });
});

describe("interview state and what the school requires", () => {
  it("a live appointment, then a completed interview, then a recorded waiver, then policy", () => {
    expect(interviewState({ live: true, completed: true, waived: true, required: true })).toBe("SCHEDULED");
    expect(interviewState({ live: false, completed: true, waived: true, required: true })).toBe("COMPLETED");
    expect(interviewState({ live: false, completed: false, waived: true, required: true })).toBe("WAIVED");
    expect(interviewState({ live: false, completed: false, waived: false, required: false })).toBe("NOT_REQUIRED");
    expect(interviewState({ live: false, completed: false, waived: false, required: true })).toBe("TO_ARRANGE");
  });
  it("is resolved when each required step is done, waived (interview only) or not required", () => {
    const ok = { needInterview: false, needExam: false, interviewDone: false, examDone: false, interviewWaived: false };
    expect(assessmentResolved(ok)).toBe(true);
    expect(assessmentResolved({ ...ok, needInterview: true })).toBe(false);
    expect(assessmentResolved({ ...ok, needInterview: true, interviewDone: true })).toBe(true);
    expect(assessmentResolved({ ...ok, needInterview: true, interviewWaived: true })).toBe(true);
    expect(assessmentResolved({ ...ok, needExam: true, interviewWaived: true })).toBe(false); // a waived interview never waives the examination
    expect(assessmentResolved({ ...ok, needExam: true, examDone: true })).toBe(true);
  });
});

describe("completeness", () => {
  it("counts provided papers, the class and a contact; a paper that needs correction is missing", () => {
    const c = completeness({ checklist: [{ docType: "BIRTH_CERTIFICATE", state: "VERIFIED" }, { docType: "PASSPORT_PHOTO", state: "PENDING" }, { docType: "REPORT", state: "NEEDS_CORRECTION" }, { docType: "TRANSFER_LETTER", state: "MISSING" }], hasClass: true, hasContact: false });
    expect(c.percent).toBe(Math.round((3 / 6) * 100));
    expect(c.complete).toBe(false);
    expect(c.missing.map((m) => m.key)).toEqual(["doc:REPORT", "doc:TRANSFER_LETTER", "contact"]);
    expect(c.checked).toBe(1);
    expect(completeness({ checklist: [], hasClass: true, hasContact: true })).toMatchObject({ percent: 100, complete: true });
  });
});

describe("progress along the road", () => {
  it("only moves forward through the states, and a closed application shows none", () => {
    const order = ["NEW", "UNDER_REVIEW", "NEEDS_INFO", "REVIEWED", "INTERVIEW_SCHEDULED", "AWAITING_DECISION", "ACCEPTED", "ENROLLED"] as const;
    const steps = order.map(workflowProgress);
    expect(steps).toEqual([1, 1, 1, 2, 2, 3, 4, 5]);
    expect(workflowProgress("REJECTED")).toBe(0);
    expect(workflowProgress("WITHDRAWN")).toBe(0);
    for (const st of WORKFLOW_STATES) expect(workflowProgress(st)).toBeLessThanOrEqual(5);
  });
});
