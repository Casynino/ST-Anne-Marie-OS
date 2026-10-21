import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import * as recruitment from "@/server/recruitment";
import { createTestSchool, createTestUser } from "../helpers";

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, head: AuthContext, academic: AuthContext, teacher: AuthContext, registrar: AuthContext;
let n = Math.floor(Math.random() * 900_000);
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const inDays = (d: number, h = 9) => { const t = new Date(Date.now() + d * 86_400_000); t.setUTCHours(h, 0, 0, 0); return t.toISOString(); };
const cand = (c: AuthContext, extra: Record<string, unknown> = {}) => recruitment.createCandidate(c, { fullName: `Candidate ${++n}`, positionApplied: "Teacher", phone: `0713${String(n % 1_000_000).padStart(6, "0")}`, ...extra });

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  head = (await createTestUser(school.id, ["head_teacher"])).ctx;
  academic = (await createTestUser(school.id, ["academic_office"])).ctx;
  teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
});

describe("staff recruitment rules", () => {
  it("keeps recruitment to the people who handle it", async () => {
    expect(await code(cand(teacher))).toBe("FORBIDDEN");
    expect(await code(cand(registrar))).toBe("FORBIDDEN");
    expect(await code(recruitment.listCandidates(teacher))).toBe("FORBIDDEN");
    const c = await cand(academic);
    expect(c.candidateNo).toMatch(/^REC\/\d{4}\/\d{5}$/);
    expect((await recruitment.listCandidates(head)).map((x) => x.id)).toContain(c.id);
  });

  it("will not double-book an interviewer, nor record a result before the interview, nor let the recorder decide", async () => {
    const a = await cand(academic), b = await cand(academic);
    const at = inDays(3, 10);
    await recruitment.scheduleCandidateInterview(academic, a.id, { interviewAt: at, interviewerId: head.userId });
    expect(await code(recruitment.scheduleCandidateInterview(academic, b.id, { interviewAt: at, interviewerId: head.userId }))).toBe("CONFLICT");
    expect(await code(recruitment.recordCandidateResult(head, a.id, { outcome: "PASSED" }))).toBe("CONFLICT"); // not held yet
    await db.staffCandidate.update({ where: { id: a.id }, data: { interviewAt: new Date(Date.now() - 3_600_000) } });
    expect(await code(recruitment.recordCandidateResult(teacher, a.id, { outcome: "PASSED" }))).toBe("FORBIDDEN"); // neither the interviewer nor recruitment staff
    await recruitment.recordCandidateResult(head, a.id, { outcome: "PASSED", score: 70, notes: "Quiet but capable", suitability: "Fits Standard III Science" });
    // interview notes are for the people who decide, the recorder and the interviewer
    expect((await recruitment.getCandidate(academic, a.id)).interviewNotes).toBe("Quiet but capable");
    const other = (await createTestUser(school.id, ["academic_office"])).ctx;
    expect((await recruitment.getCandidate(other, a.id)).interviewNotes).toBeNull();
    expect(await code(recruitment.decideCandidate(academic, a.id, { decision: "ACCEPT" }))).toBe("FORBIDDEN"); // recommends, does not decide
    expect(await code(recruitment.decideCandidate(head, a.id, { decision: "REJECT" }))).toBe("VALIDATION");
    await recruitment.decideCandidate(admin, a.id, { decision: "ACCEPT" });
    expect(await code(recruitment.decideCandidate(admin, a.id, { decision: "ACCEPT" }))).toBe("CONFLICT");
  });

  it("does not create an account before approval, and does not let the recorder approve their own candidate", async () => {
    await recruitment.updateRecruitmentSettings(admin, { docs: "Signed contract" });
    const a = await cand(admin); // recorded by the administrator
    await recruitment.scheduleCandidateInterview(admin, a.id, { interviewAt: inDays(1) });
    await db.staffCandidate.update({ where: { id: a.id }, data: { interviewAt: new Date(Date.now() - 3_600_000) } });
    await recruitment.recordCandidateResult(admin, a.id, { outcome: "PASSED" });
    expect(await code(recruitment.decideCandidate(admin, a.id, { decision: "ACCEPT" }))).toBe("CONFLICT"); // the recorder cannot decide
    await recruitment.decideCandidate(head, a.id, { decision: "ACCEPT" });
    await recruitment.startOnboarding(admin, a.id, {});
    expect(await code(recruitment.approveEmployment(admin, a.id))).toBe("CONFLICT"); // required paper missing (and not their own to approve)
    await recruitment.recordCandidateDocument(admin, a.id, { docType: "Signed contract", received: "on" });
    expect(await code(recruitment.approveEmployment(admin, a.id))).toBe("CONFLICT"); // the recorder cannot approve
    await recruitment.approveEmployment(head, a.id);
    const before = await db.user.count({ where: { schoolId: school.id } });
    expect(await code(recruitment.activateEmployee(head, a.id, { email: `h-${n}@test.example` }))).toBe("FORBIDDEN"); // the Head Teacher cannot create accounts
    expect(await db.user.count({ where: { schoolId: school.id } })).toBe(before);
    const role = await db.role.findFirstOrThrow({ where: { schoolId: school.id, key: "subject_teacher" } });
    await recruitment.activateEmployee(admin, a.id, { email: `ok-${n}@test.example`, roleIds: [role.id] });
    expect(await db.user.count({ where: { schoolId: school.id } })).toBe(before + 1);
  });

  it("is invisible to another school", async () => {
    const other = await createTestSchool("Other recruiter");
    const o = (await createTestUser(other.id, ["super_admin"])).ctx;
    const c = await cand(academic);
    expect(await code(recruitment.getCandidate(o, c.id))).toBe("NOT_FOUND");
    expect(await code(recruitment.decideCandidate(o, c.id, { decision: "ACCEPT" }))).toBe("NOT_FOUND");
    expect((await recruitment.listCandidates(o)).length).toBe(0);
  });
});
