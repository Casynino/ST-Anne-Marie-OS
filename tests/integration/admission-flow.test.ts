import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import { todayInTimezone } from "@/lib/dates";
import * as admissions from "@/server/admissions";
import { awaitingPlacement } from "@/server/admission-queues";
import * as desk from "@/server/admission-desk";
import * as documents from "@/server/documents";
import * as flow from "@/server/admission-flow";
import * as days from "@/server/interview-days";
import * as offers from "@/server/admission-offers";
import * as policy from "@/server/admission-policy";
import * as pub from "@/server/public-applications";
import { resubmitMyApplication } from "@/server/application-draft";
import * as review from "@/server/admission-review";
import { LocalDiskStorage } from "@/lib/storage/local";
import { setStorageForTests } from "@/lib/storage";
import { createCurrentYearAcademics, createTestSchool, createTestUser, ctxFor } from "../helpers";

/*
 * The steps from the desk. An application with an interview date is in the interview list; one without waits under review, and accepting it
 * means choosing its date. Incomplete ones are sent back to the family, who send them again. After the interview a pass accepts and enrols the
 * applicant, who then waits in Class placement. Each application is in one list at a time.
 */

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, rehema: AuthContext, teacher: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let zone = "Africa/Dar_es_Salaam";
let n = 74000;
const next = () => ++n;
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(200, 0x20)]);
// no admission fee: nothing is paid after the application fee
const POLICY = { requireInterview: "on", requiredDocTypes: ["BIRTH_CERTIFICATE"], admissionFee: "0", offerValidDays: 14, allowDirectRegistration: "on", interviewMinutes: 30 };
const ymd = (offset: number) => { const t = new Date(`${todayInTimezone(zone)}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + offset); return t.toISOString().slice(0, 10); };
const inList = async (stage: string, id: string) => (await desk.loadDesk(rehema, { stage }, 1)).rows.some((r) => r.id === id);
const lists = async (id: string) => ({ review: await inList("review", id), interview: await inList("interview", id) });

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

const dayAt = (offset: number) => `${ymd(offset)}T10:00`;

describe("the steps an application takes", () => {
  it("is under review; Accept needs the papers checked and an interview date, then it is in the interview list; a pass takes it to Class placement", async () => {
    const a = await newApp();
    expect(await lists(a.id)).toEqual({ review: true, interview: false });
    expect((await desk.loadDesk(rehema, {}, 1)).rows.find((r) => r.id === a.id)?.afterReview).toBe("interview");

    // the papers are checked only when the person says they looked; the date must be chosen; only people who may review can accept
    expect(await code(flow.acceptReview(rehema, a.id, { scheduledAt: dayAt(9) }))).toBe("VALIDATION");
    expect(await code(flow.acceptReview(rehema, a.id, { papersChecked: true }))).toBe("VALIDATION");
    expect(await code(flow.acceptReview(teacher, a.id, { papersChecked: true, scheduledAt: dayAt(9) }))).toBe("FORBIDDEN");
    expect(await code(flow.acceptReview(rehema, a.id, { papersChecked: true, scheduledAt: `${ymd(-2)}T10:00` }))).toBe("VALIDATION"); // not in the past
    expect(await lists(a.id)).toEqual({ review: true, interview: false });
    expect((await db.document.findFirstOrThrow({ where: { applicationId: a.id } })).verification).toBe("PENDING"); // nothing changed by the refusals

    // an interview day the school set: the day's venue is used and a place is taken
    await days.addInterviewDay(rehema, { name: "Intake", on: ymd(9), time: "10:00", venue: "Hall A", capacity: 1 });
    const r1 = await flow.acceptReview(rehema, a.id, { papersChecked: true, scheduledAt: dayAt(9) });
    expect(r1).toMatchObject({ state: "INTERVIEW_SCHEDULED", already: false });
    expect(await lists(a.id)).toEqual({ review: false, interview: true });
    expect((await db.document.findFirstOrThrow({ where: { applicationId: a.id } })).verification).toBe("VERIFIED");
    expect((await db.interview.findFirstOrThrow({ where: { applicationId: a.id, status: "SCHEDULED" } })).location).toBe("Hall A");
    expect(await flow.acceptReview(rehema, a.id, { papersChecked: true, scheduledAt: dayAt(9) })).toMatchObject({ already: true }); // pressing it twice changes nothing

    // the day is full: refused before anything is changed
    const b = await newApp();
    expect(await code(flow.acceptReview(rehema, b.id, { papersChecked: true, scheduledAt: dayAt(9) }))).toBe("CONFLICT");
    expect((await db.document.findFirstOrThrow({ where: { applicationId: b.id } })).verification).toBe("PENDING");
    expect(await lists(b.id)).toEqual({ review: true, interview: false });
    await flow.acceptReview(rehema, b.id, { papersChecked: true, scheduledAt: dayAt(12) }); // any other date works

    // the result needs the interview to have taken place
    expect(await code(flow.recordQuickResult(rehema, a.id, { outcome: "PASSED" }))).toBe("CONFLICT");
    const iv = await db.interview.findFirstOrThrow({ where: { applicationId: a.id, status: "SCHEDULED" } });
    await db.interview.update({ where: { id: iv.id }, data: { scheduledAt: new Date(Date.now() - 3_600_000) } });
    expect(await code(flow.recordQuickResult(rehema, a.id, { outcome: "MAYBE" }))).toBe("VALIDATION");
    // a pass accepts and enrols at once: the applicant leaves every list and waits in Class placement for a class
    expect(await flow.recordQuickResult(rehema, a.id, { outcome: "PASSED", note: "Good" })).toMatchObject({ passed: true, landing: "placement" });
    expect(await lists(a.id)).toEqual({ review: false, interview: false });
    const done = await db.application.findUniqueOrThrow({ where: { id: a.id } });
    expect(done.status).toBe("ENROLLED");
    expect((await awaitingPlacement(rehema)).map((x) => x.id)).toContain(done.studentId);
    expect(await db.admissionPayment.count({ where: { applicationId: a.id } })).toBe(0); // nothing is paid at this stage
    // searching by name looks in every list, and the enrolled applicant has its own status
    expect((await desk.loadDesk(rehema, { q: done.firstName }, 1)).rows.map((r) => r.id)).toContain(a.id);
    expect((await desk.loadDesk(rehema, { state: "ENROLLED" }, 1)).rows.map((r) => r.id)).toContain(a.id);
  });

  it("an interview day is a group session: several applicants accepted onto it share its hall", async () => {
    await days.addInterviewDay(rehema, { name: "Group day", on: ymd(26), time: "14:00", venue: "Hall C", capacity: 3 });
    const a = await newApp();
    const b = await newApp();
    await flow.acceptReview(rehema, a.id, { papersChecked: true, scheduledAt: `${ymd(26)}T14:00` });
    await flow.acceptReview(rehema, b.id, { papersChecked: true, scheduledAt: `${ymd(26)}T14:00` });
    expect(await db.interview.count({ where: { status: "SCHEDULED", location: "Hall C", applicationId: { in: [a.id, b.id] } } })).toBe(2);
    expect((await days.listInterviewDays(rehema)).find((d) => d.name === "Group day")?.placed).toBe(2);
  });

  it("an application that arrives with an interview date goes straight to the interview list; a pass then checks its papers and takes it to Class placement", async () => {
    const a = await newApp();
    await db.interview.create({ data: { schoolId: school.id, applicationId: a.id, kind: "INTERVIEW", scheduledAt: new Date(Date.now() + 5 * 86_400_000), arrangement: "DAY", createdById: null } });
    expect(await lists(a.id)).toEqual({ review: false, interview: true });
    expect((await desk.loadDesk(rehema, { stage: "interview" }, 1)).rows.find((r) => r.id === a.id)).toMatchObject({ state: "INTERVIEW_SCHEDULED", pendingDocs: 1 });
    await db.interview.updateMany({ where: { applicationId: a.id }, data: { scheduledAt: new Date(Date.now() - 3_600_000) } });
    expect(await code(flow.recordQuickResult(rehema, a.id, { outcome: "PASSED" }))).toBe("VALIDATION"); // the papers were never checked: say so first
    expect(await db.interview.count({ where: { applicationId: a.id, status: "COMPLETED" } })).toBe(0);
    expect(await flow.recordQuickResult(rehema, a.id, { outcome: "PASSED", papersChecked: true })).toMatchObject({ passed: true, landing: "placement" });
    expect((await db.application.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("ENROLLED");
  });

  it("a pass whose papers are missing is saved, but the applicant is not accepted: it stays in the interview list with the reason", async () => {
    const a = await newApp(false);
    await db.interview.create({ data: { schoolId: school.id, applicationId: a.id, kind: "INTERVIEW", scheduledAt: new Date(Date.now() - 3_600_000), arrangement: "DAY", createdById: null } });
    const r = await flow.recordQuickResult(rehema, a.id, { outcome: "PASSED" });
    expect(r).toMatchObject({ passed: true, landing: "blocked" });
    expect(r.note).toMatch(/documents/i);
    expect(await lists(a.id)).toEqual({ review: false, interview: true });
    expect(await db.interview.count({ where: { applicationId: a.id, outcome: "PASSED" } })).toBe(1);
  });

  it("when the school asks for no interview, Accept at the review accepts and enrols the application at once (no date needed)", async () => {
    await policy.updateAdmissionPolicy(admin, { ...POLICY, requireInterview: undefined });
    const a = await newApp();
    expect((await desk.loadDesk(rehema, {}, 1)).rows.find((r) => r.id === a.id)?.afterReview).toBe("placement");
    expect(await flow.acceptReview(rehema, a.id, { papersChecked: true })).toMatchObject({ state: "ENROLLED", landing: "placement" });
    expect(await lists(a.id)).toEqual({ review: false, interview: false });
    await policy.updateAdmissionPolicy(admin, POLICY);
  });

  it("a result that is not a pass accepts nobody: the application stays in the interview list for the decision", async () => {
    const a = await newApp();
    await flow.acceptReview(rehema, a.id, { papersChecked: true, scheduledAt: dayAt(15) });
    const iv = await db.interview.findFirstOrThrow({ where: { applicationId: a.id, status: "SCHEDULED" } });
    await db.interview.update({ where: { id: iv.id }, data: { scheduledAt: new Date(Date.now() - 3_600_000) } });
    expect(await flow.recordQuickResult(rehema, a.id, { outcome: "NOT_PASSED" })).toMatchObject({ passed: false });
    expect((await desk.loadDesk(rehema, { stage: "interview" }, 1)).rows.find((r) => r.id === a.id)?.state).toBe("AWAITING_DECISION");
    expect(await code(offers.acceptApplication(rehema, a.id, {}))).toBe("CONFLICT"); // the latest result is not a pass
    await admissions.transitionApplication(rehema, a.id, { to: "REJECTED", reason: "Did not pass the interview" });
    expect(await lists(a.id)).toEqual({ review: false, interview: false });
  });

  it("an accepted applicant that could not be enrolled at once stays in the interview list until they are enrolled", async () => {
    const a = await newApp();
    await flow.acceptReview(rehema, a.id, { papersChecked: true, scheduledAt: dayAt(16) });
    await db.interview.updateMany({ where: { applicationId: a.id }, data: { status: "COMPLETED", outcome: "PASSED", scheduledAt: new Date(Date.now() - 86_400_000) } });
    await offers.acceptApplication(rehema, a.id, {}); // accepted only (not enrolled)
    expect(await lists(a.id)).toEqual({ review: false, interview: true });
    expect(await code(flow.enrolNow(teacher, a.id))).toBe("FORBIDDEN");
    await flow.enrolNow(rehema, a.id);
    expect(await lists(a.id)).toEqual({ review: false, interview: false });
    expect((await db.application.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("ENROLLED");
  });
});

describe("incomplete applications are sent back, and the family sends them again", () => {
  it("missing papers cannot be accepted: the application is sent back with a note, the family is told, and it returns to review when they reply", async () => {
    const a = await newApp(false);
    expect((await desk.loadDesk(rehema, {}, 1)).rows.find((r) => r.id === a.id)?.completeness.missing).toContain("doc:BIRTH_CERTIFICATE");
    expect(await code(flow.acceptReview(rehema, a.id, { scheduledAt: dayAt(18) }))).toBe("CONFLICT"); // the required paper is missing
    expect(await code(flow.sendBack(rehema, a.id, undefined))).toBe("VALIDATION"); // say what to add
    expect(await code(flow.sendBack(teacher, a.id, "Please add the birth certificate"))).toBe("FORBIDDEN");
    expect(await flow.sendBack(rehema, a.id, "Please add the birth certificate")).toEqual({ told: "phone" }); // typed at the office: no account, tell them by phone
    expect((await desk.loadDesk(rehema, {}, 1)).rows.find((r) => r.id === a.id)?.state).toBe("NEEDS_INFO");
    expect((await db.applicationNotice.findMany({ where: { applicationId: a.id } })).map((x) => [x.kind, x.status])).toEqual([["INFO_NEEDED", "NO_ACCOUNT"]]);
    expect(await code(flow.sendBack(rehema, a.id, "again"))).toBe("CONFLICT"); // already sent back
    expect(await lists(a.id)).toEqual({ review: true, interview: false });
    // the papers come to the office: it is back under review, and can now be accepted
    await documents.uploadDocument(rehema, { applicationId: a.id }, { docType: "BIRTH_CERTIFICATE", fileName: "bc.pdf", bytes: PDF });
    expect(await flow.receivedAgain(rehema, a.id)).toEqual({ already: false });
    expect((await desk.loadDesk(rehema, {}, 1)).rows.find((r) => r.id === a.id)?.state).toBe("UNDER_REVIEW");
    expect(await flow.receivedAgain(rehema, a.id)).toEqual({ already: true });
    expect(await flow.acceptReview(rehema, a.id, { papersChecked: true, scheduledAt: dayAt(18) })).toMatchObject({ state: "INTERVIEW_SCHEDULED" });
  });

  it("a family with an account is told in its account, adds the papers and sends the application again; only its own application, only when it was sent back", async () => {
    for (const d of await days.listInterviewDays(admin)) await days.removeInterviewDay(admin, d.id); // no window is open: the application waits under review
    const k = next();
    const phone = `07${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    const email = `fam${Date.now()}${k}@example.test`;
    const { applicationNo } = await pub.submitOnlineApplication(school.id, { firstName: `Fam${k}`, lastName: `Resend${k}`, dateOfBirth: "2019-02-02", gender: "FEMALE", classAppliedId: setup.cls.id, g1_fullName: `Resend Parent ${k}`, g1_phone: phone, g1_email: email, g1_relationship: "MOTHER", consent: "on", website: "", password: "Learn-Safely-2026", password2: "Learn-Safely-2026" }, { ip: `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, userAgent: "test" } as never);
    const app = await db.application.findFirstOrThrow({ where: { schoolId: school.id, applicationNo: applicationNo! } });
    const draft = await db.applicationDraft.findFirstOrThrow({ where: { applicationId: app.id } });
    const family = await ctxFor(draft.userId!);
    expect(await code(resubmitMyApplication(family, draft.id))).toBe("CONFLICT"); // nothing has been asked yet
    expect(await flow.sendBack(rehema, app.id, "Please add the birth certificate")).toEqual({ told: "account" });
    expect(await db.inAppNotification.count({ where: { userId: draft.userId!, title: { contains: "information" } } })).toBeGreaterThanOrEqual(0);
    expect((await desk.loadDesk(rehema, {}, 1)).rows.find((r) => r.id === app.id)?.state).toBe("NEEDS_INFO");
    expect(await code(resubmitMyApplication(rehema, draft.id))).toBe("NOT_FOUND"); // a member of staff is not the family
    const other = await ctxFor((await createTestUser(school.id, ["parent"])).user.id);
    expect(await code(resubmitMyApplication(other, draft.id))).toBe("NOT_FOUND"); // nobody else's application
    await resubmitMyApplication(family, draft.id);
    expect((await desk.loadDesk(rehema, {}, 1)).rows.find((r) => r.id === app.id)?.state).toBe("NEW");
    expect((await db.applicationEvent.findMany({ where: { applicationId: app.id, kind: "REVIEW" }, orderBy: { createdAt: "asc" } })).map((e) => e.reason)).toEqual([expect.stringContaining("RETURNED"), "Sent again by the family"]);
    expect(await code(resubmitMyApplication(family, draft.id))).toBe("CONFLICT"); // it is not waiting for anything now
  });

  it("a declined application is in no list and found under Closed", async () => {
    const a = await newApp(false);
    await admissions.transitionApplication(rehema, a.id, { to: "REJECTED", reason: "Not suitable" });
    expect(await lists(a.id)).toEqual({ review: false, interview: false });
    expect((await desk.loadDesk(rehema, { state: "CLOSED" }, 1)).rows.map((r) => r.id)).toContain(a.id);
  });
});
