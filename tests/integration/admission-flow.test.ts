import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import { todayInTimezone } from "@/lib/dates";
import * as admissions from "@/server/admissions";
import * as desk from "@/server/admission-desk";
import * as documents from "@/server/documents";
import * as flow from "@/server/admission-flow";
import * as days from "@/server/interview-days";
import * as offers from "@/server/admission-offers";
import * as policy from "@/server/admission-policy";
import * as review from "@/server/admission-review";
import { LocalDiskStorage } from "@/lib/storage/local";
import { setStorageForTests } from "@/lib/storage";
import { createCurrentYearAcademics, createTestSchool, createTestUser } from "../helpers";

/*
 * The steps from the desk: an application is under review; Accept sends it on to the interview list (or straight to accepted when the school
 * asks for no interview); in the interview list it is given a date (or already has one), the result is recorded after the interview, and Accept
 * puts it in the accepted list. Each application is in one list at a time.
 */

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, rehema: AuthContext, teacher: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let zone = "Africa/Dar_es_Salaam";
let n = 74000;
const next = () => ++n;
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(200, 0x20)]);
const POLICY = { requireInterview: "on", requiredDocTypes: ["BIRTH_CERTIFICATE"], admissionFee: "100000", requirePaymentBeforeEnrol: "on", offerValidDays: 14, allowDirectRegistration: "on", interviewMinutes: 30 };
const ymd = (offset: number) => { const t = new Date(`${todayInTimezone(zone)}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + offset); return t.toISOString().slice(0, 10); };
const inList = async (stage: string, id: string) => (await desk.loadDesk(rehema, { stage }, 1)).rows.some((r) => r.id === id);
const lists = async (id: string) => ({ review: await inList("review", id), interview: await inList("interview", id), accepted: await inList("accepted", id) });

/** An application with its birth certificate uploaded but not yet checked. */
async function newApp(withPaper = true) {
  const a = await admissions.createApplication(rehema, { firstName: `Step${next()}`, lastName: `Flow${n}`, dateOfBirth: "2019-05-04", gender: "FEMALE", classAppliedId: setup.cls.id, guardians: [{ fullName: `Parent ${n}`, phone: `0765${String(n).padStart(6, "0")}`, relationship: "MOTHER", isPrimary: "on" }] });
  if (withPaper) await documents.uploadDocument(rehema, { applicationId: a.id }, { docType: "BIRTH_CERTIFICATE", fileName: "bc.pdf", bytes: PDF });
  return a;
}

beforeAll(async () => {
  school = await createTestSchool();
  zone = (await db.school.findUniqueOrThrow({ where: { id: school.id }, select: { timezone: true } })).timezone;
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  rehema = (await createTestUser(school.id, ["registrar"])).ctx;
  teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: [] });
  setStorageForTests(new LocalDiskStorage(await mkdtemp(path.join(tmpdir(), "sam-flow-"))));
  await policy.updateAdmissionPolicy(admin, POLICY);
});
afterAll(() => setStorageForTests(undefined));

describe("the steps an application takes", () => {
  it("is under review first; Accept (papers checked) sends it to the interview list; a date, the result and Accept take it to the accepted list", async () => {
    const a = await newApp();
    expect(await lists(a.id)).toEqual({ review: true, interview: false, accepted: false });

    // the papers waiting to be checked are checked only when the person says they looked at them
    expect(await code(flow.acceptReview(rehema, a.id, {}))).toBe("VALIDATION");
    expect(await code(flow.acceptReview(teacher, a.id, { papersChecked: true }))).toBe("FORBIDDEN");
    expect(await lists(a.id)).toEqual({ review: true, interview: false, accepted: false });
    const r1 = await flow.acceptReview(rehema, a.id, { papersChecked: true });
    expect(r1).toMatchObject({ state: "REVIEWED", already: false });
    expect(await lists(a.id)).toEqual({ review: false, interview: true, accepted: false });
    expect((await db.document.findFirstOrThrow({ where: { applicationId: a.id } })).verification).toBe("VERIFIED");
    expect(await flow.acceptReview(rehema, a.id, { papersChecked: true })).toMatchObject({ already: true }); // pressing it twice changes nothing

    // it cannot be accepted yet: the school asks for an interview first
    expect(await code(offers.acceptApplication(rehema, a.id, {}))).toBe("CONFLICT");

    // a date: the interview day the school set (a place is taken, the venue is used), or any other date
    await days.addInterviewDay(rehema, { on: ymd(9), time: "10:00", venue: "Hall A", capacity: 1 });
    expect(await code(flow.giveInterviewDate(teacher, a.id, `${ymd(9)}T10:00`))).toBe("FORBIDDEN");
    await flow.giveInterviewDate(rehema, a.id, `${ymd(9)}T10:00`);
    const iv = await db.interview.findFirstOrThrow({ where: { applicationId: a.id, status: "SCHEDULED" } });
    expect(iv.location).toBe("Hall A");
    expect((await desk.loadDesk(rehema, { stage: "interview" }, 1)).rows.find((r) => r.id === a.id)?.state).toBe("INTERVIEW_SCHEDULED");
    const b = await newApp();
    await flow.acceptReview(rehema, b.id, { papersChecked: true });
    expect(await code(flow.giveInterviewDate(rehema, b.id, `${ymd(9)}T10:00`))).toBe("CONFLICT"); // the day has one place and it is taken
    await flow.giveInterviewDate(rehema, b.id, `${ymd(12)}T14:00`);
    expect(await db.interview.count({ where: { applicationId: b.id, status: "SCHEDULED" } })).toBe(1);

    // the result needs the interview to have taken place
    expect(await code(flow.recordQuickResult(rehema, a.id, { outcome: "PASSED" }))).toBe("CONFLICT");
    await db.interview.update({ where: { id: iv.id }, data: { scheduledAt: new Date(Date.now() - 3_600_000) } });
    expect(await code(flow.recordQuickResult(rehema, a.id, { outcome: "MAYBE" }))).toBe("VALIDATION");
    await flow.recordQuickResult(rehema, a.id, { outcome: "PASSED", note: "Good" });
    expect((await desk.loadDesk(rehema, { stage: "interview" }, 1)).rows.find((r) => r.id === a.id)?.state).toBe("AWAITING_DECISION");

    // Accept: it leaves the interview list for the accepted list, and is not under review any more
    await offers.acceptApplication(rehema, a.id, {});
    expect(await lists(a.id)).toEqual({ review: false, interview: false, accepted: true });
    // searching by name looks in every list
    expect((await desk.loadDesk(rehema, { q: (await db.application.findUniqueOrThrow({ where: { id: a.id } })).firstName }, 1)).rows.map((r) => r.id)).toContain(a.id);
    expect((await desk.loadDesk(rehema, {}, 1)).counts.stages.accepted).toBeGreaterThanOrEqual(1);
  });

  it("an application that came with an interview date stays under review until it is accepted, then goes to the interview list with its date", async () => {
    const a = await newApp();
    await review.verifyDocument(rehema, (await db.document.findFirstOrThrow({ where: { applicationId: a.id } })).id, { status: "VERIFIED" });
    await db.$transaction(async (tx) => {
      await tx.interview.create({ data: { schoolId: school.id, applicationId: a.id, kind: "INTERVIEW", scheduledAt: new Date(Date.now() + 5 * 86_400_000), arrangement: "DAY", createdById: null } });
    });
    expect(await lists(a.id)).toEqual({ review: true, interview: false, accepted: false });
    expect((await desk.loadDesk(rehema, {}, 1)).rows.find((r) => r.id === a.id)).toMatchObject({ state: "NEW", interview: "SCHEDULED" });
    await flow.acceptReview(rehema, a.id, {}); // papers were already checked: nothing to tick
    expect(await lists(a.id)).toEqual({ review: false, interview: true, accepted: false });
    expect((await desk.loadDesk(rehema, { stage: "interview" }, 1)).rows.find((r) => r.id === a.id)).toMatchObject({ state: "INTERVIEW_SCHEDULED" });
  });

  it("when the school asks for no interview, Accept at the review accepts the application at once", async () => {
    await policy.updateAdmissionPolicy(admin, { ...POLICY, requireInterview: undefined });
    const a = await newApp();
    expect((await desk.loadDesk(rehema, {}, 1)).rows.find((r) => r.id === a.id)?.afterReview).toBe("accepted");
    expect(await flow.acceptReview(rehema, a.id, { papersChecked: true })).toMatchObject({ state: "ACCEPTED" });
    expect(await lists(a.id)).toEqual({ review: false, interview: false, accepted: true });
    await policy.updateAdmissionPolicy(admin, POLICY);
  });

  it("missing papers stop the review; a declined application is in no list; enrolled ones are found under their own status", async () => {
    const a = await newApp(false);
    expect(await code(flow.acceptReview(rehema, a.id, {}))).toBe("CONFLICT"); // the required paper is missing
    expect(await lists(a.id)).toEqual({ review: true, interview: false, accepted: false });
    await admissions.transitionApplication(rehema, a.id, { to: "REJECTED", reason: "Not suitable" });
    expect(await lists(a.id)).toEqual({ review: false, interview: false, accepted: false });
    expect((await desk.loadDesk(rehema, { state: "CLOSED" }, 1)).rows.map((r) => r.id)).toContain(a.id);
  });
});
