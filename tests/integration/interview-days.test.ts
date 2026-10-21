import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import { todayInTimezone } from "@/lib/dates";
import * as desk from "@/server/admission-desk";
import * as days from "@/server/interview-days";
import * as interviews from "@/server/interviews";
import * as office from "@/server/office-application";
import * as pdf from "@/server/application-pdf";
import * as policy from "@/server/admission-policy";
import * as website from "@/server/website";
import { LocalDiskStorage } from "@/lib/storage/local";
import { setStorageForTests } from "@/lib/storage";
import { createCurrentYearAcademics, createTestSchool, createTestUser } from "../helpers";

/*
 * Interview days: the school sets the dates before families apply. A paid application received while a day is open (and has room) is placed
 * on it at once and the family is told; anything else waits for the office to give a date. Applications here are filled in at the office and
 * paid through Finance, the same path as an online application whose fee the provider confirms.
 */

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, rehema: AuthContext, accountant: AuthContext, teacher: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let zone = "Africa/Dar_es_Salaam";
let n = 61000 + Math.floor(Math.random() * 800000);
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const POLICY = { requireInterview: "on", requiredDocTypes: ["BIRTH_CERTIFICATE"], admissionFee: "100000", requirePaymentBeforeEnrol: "on", offerValidDays: 14, allowDirectRegistration: "on", interviewMinutes: 30 };
const ymd = (offset: number) => { const t = new Date(`${todayInTimezone(zone)}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + offset); return t.toISOString().slice(0, 10); };

function form() {
  const k = n++;
  return { firstName: `Neema${k}`, lastName: `Day${k}`, dateOfBirth: "2019-03-03", gender: "FEMALE", classAppliedId: setup.cls.id, g1_fullName: `Mama ${k}`, g1_phone: `0756${String(k % 1_000_000).padStart(6, "0")}`, g1_relationship: "MOTHER", consent: "on" };
}
/** A paid application: filled in at the office, the fee recorded by Finance. */
async function paid() {
  const r = await office.createOfficeApplication(rehema, form(), []);
  await office.recordApplicationFeeAtOffice(accountant, r.draftId, { method: "CASH" });
  const draft = await db.applicationDraft.findUniqueOrThrow({ where: { id: r.draftId } });
  return { draftId: r.draftId, applicationId: draft.applicationId! };
}
const liveInterview = (applicationId: string) => db.interview.findFirst({ where: { applicationId, status: "SCHEDULED" } });
async function createCurrentYearAcademicsClass() {
  const level = await db.academicLevel.findFirstOrThrow({ where: { schoolId: school.id } });
  const c = await db.schoolClass.create({ data: { schoolId: school.id, levelId: level.id, name: `Other ${n++}`, sortOrder: 99 } });
  return c.id;
}
async function clearDays() { for (const d of await days.listInterviewDays(admin)) await days.removeInterviewDay(admin, d.id); }

beforeAll(async () => {
  school = await createTestSchool();
  zone = (await db.school.findUniqueOrThrow({ where: { id: school.id }, select: { timezone: true } })).timezone;
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  rehema = (await createTestUser(school.id, ["registrar"])).ctx;
  accountant = (await createTestUser(school.id, ["accountant"])).ctx;
  teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: [] });
  setStorageForTests(new LocalDiskStorage(await mkdtemp(path.join(tmpdir(), "sam-days-"))));
  await website.updateWebsiteSettings(admin, { applicationsOpen: "on" });
  await policy.updateAdmissionPolicy(admin, { ...POLICY, applicationFee: "10000" });
});
afterAll(() => setStorageForTests(undefined));

describe("setting interview days", () => {
  it("is for people who manage interviews; a day that has passed, a bad window or the same day twice is refused", async () => {
    expect(await code(days.addInterviewDay(teacher, { name: "Intake", on: ymd(20), time: "09:00" }))).toBe("FORBIDDEN");
    expect(await code(days.addInterviewDay(accountant, { name: "Intake", on: ymd(20), time: "09:00" }))).toBe("FORBIDDEN");
    expect(await code(days.addInterviewDay(rehema, { name: "Intake", on: ymd(-1), time: "09:00" }))).toBe("VALIDATION");
    expect(await code(days.addInterviewDay(rehema, { name: "Intake", on: ymd(10), time: "9am" }))).toBe("VALIDATION");
    expect(await code(days.addInterviewDay(rehema, { name: "Intake", on: ymd(10), time: "09:00", from: ymd(5), until: ymd(3) }))).toBe("VALIDATION");
    expect(await code(days.addInterviewDay(rehema, { name: "Intake", on: ymd(10), time: "09:00", until: ymd(11) }))).toBe("VALIDATION"); // applications must arrive by the day itself
    await days.addInterviewDay(rehema, { name: "Intake", on: ymd(25), time: "09:00", venue: "Main hall" });
    expect(await code(days.addInterviewDay(rehema, { name: "Intake", on: ymd(25), time: "09:00", venue: "Main hall" }))).toBe("CONFLICT");
    expect((await days.listInterviewDays(teacher.permissions.has("admission.read") ? teacher : admin)).length).toBeGreaterThanOrEqual(1);
    await clearDays();
    expect(await days.listInterviewDays(admin)).toHaveLength(0);
  });
});

describe("placing a paid application on an interview day", () => {
  it("places it at once, tells the family (by phone when there is no account), shows it on the desk and on the printed form", async () => {
    await clearDays();
    await days.addInterviewDay(rehema, { name: "Intake", on: ymd(14), time: "10:30", venue: "Main hall" });
    const a = await paid();
    const iv = await liveInterview(a.applicationId);
    expect(iv).toMatchObject({ kind: "INTERVIEW", arrangement: "DAY", createdById: null, location: "Main hall" });
    expect((await db.application.findUniqueOrThrow({ where: { id: a.applicationId } })).status).toBe("INTERVIEW");
    // it comes with its date but, like every application, it is reviewed first: it shows the date in the review list
    const row = (await desk.loadDesk(rehema, {}, 1)).rows.find((r) => r.id === a.applicationId);
    expect(row).toMatchObject({ state: "NEW", interview: "SCHEDULED" });
    expect(row?.interviewAt?.getTime()).toBe(iv!.scheduledAt.getTime());
    expect((await desk.loadDesk(rehema, { stage: "interview" }, 1)).rows.map((r) => r.id)).not.toContain(a.applicationId);
    const notes = await db.applicationNotice.findMany({ where: { applicationId: a.applicationId } });
    expect(notes.map((x) => [x.kind, x.status])).toEqual([["INTERVIEW", "NO_ACCOUNT"]]);
    expect((await pdf.applicationFormDocument(rehema, a.draftId, "EN")).interview).toMatchObject({ venue: "Main hall" });
    // the same interview is not placed twice if the placement is run again
    await db.$transaction((tx) => days.placeOnInterviewDay(tx, school.id, a.applicationId, { ip: null, userAgent: null }));
    expect(await db.interview.count({ where: { applicationId: a.applicationId } })).toBe(1);
  });

  it("when the places are full the next application waits, and the office can still give it a date from the day list", async () => {
    await clearDays();
    await days.addInterviewDay(rehema, { name: "Intake", on: ymd(16), time: "09:00", capacity: 1 });
    const first = await paid();
    const second = await paid();
    expect(await liveInterview(first.applicationId)).not.toBeNull();
    expect(await liveInterview(second.applicationId)).toBeNull();
    expect((await days.listInterviewDays(rehema))[0]).toMatchObject({ placed: 1, capacity: 1 });
    const slots = await interviews.upcomingInterviewSlots(rehema);
    expect(slots.some((s) => s.count === 1)).toBe(true);
  });

  it("an application received outside every window waits; so does one when the school does not ask for an interview", async () => {
    await clearDays();
    await days.addInterviewDay(rehema, { name: "Intake", on: ymd(18), time: "09:00", from: ymd(3), until: ymd(10) });
    expect(await liveInterview((await paid()).applicationId)).toBeNull(); // today is before the window opens
    await clearDays();
    await days.addInterviewDay(rehema, { name: "Intake", on: ymd(18), time: "09:00" });
    await policy.updateAdmissionPolicy(admin, { ...POLICY, requireInterview: undefined, applicationFee: "10000" });
    expect(await liveInterview((await paid()).applicationId)).toBeNull();
    await policy.updateAdmissionPolicy(admin, { ...POLICY, applicationFee: "10000" });
    expect(await liveInterview((await paid()).applicationId)).not.toBeNull();
  });

  it("removing a day keeps the interviews of those already placed on it", async () => {
    await clearDays();
    const d = await days.addInterviewDay(rehema, { name: "Intake", on: ymd(21), time: "09:00" });
    const a = await paid();
    await days.removeInterviewDay(rehema, d.id);
    expect(await liveInterview(a.applicationId)).not.toBeNull();
    expect(await days.listInterviewDays(rehema)).toHaveLength(0);
  });
});

describe("the application window and what families are told before they apply", () => {
  it("the Admissions Office opens and closes online applications without touching any other website setting", async () => {
    await website.updateWebsiteSettings(admin, { applicationsOpen: "on", en_heroTitle: "Learning together" });
    expect(await code(website.setApplicationsOpen(teacher, false))).toBe("FORBIDDEN");
    expect(await code(website.setApplicationsOpen(accountant, false))).toBe("FORBIDDEN");
    await website.setApplicationsOpen(rehema, false);
    const closed = await website.loadWebsiteSettings(school.id);
    expect(closed.applicationsOpen).toBe(false);
    expect(JSON.stringify(closed)).toContain("Learning together");
    await website.setApplicationsOpen(rehema, true);
    expect((await website.loadWebsiteSettings(school.id)).applicationsOpen).toBe(true);
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: { in: ["admission.window_open", "admission.window_close"] } } })).toBe(2);
  });

  it("the site and the forms list the windows that are open now, with the classes, the closing date and the interview, and only when the school asks for an interview", async () => {
    await clearDays();
    expect(await days.openWindows(school.id)).toEqual([]);
    const formI = await db.schoolClass.findFirstOrThrow({ where: { schoolId: school.id, id: setup.cls.id } });
    await days.addInterviewDay(rehema, { name: "Form I intake", classIds: [setup.cls.id], on: ymd(30), time: "08:30", venue: "Hall B", from: ymd(-1), until: ymd(20), capacity: 1 });
    await days.addInterviewDay(rehema, { name: "Later window", on: ymd(40), time: "09:00", from: ymd(10), until: ymd(30) }); // not open yet
    const open = await days.openWindows(school.id);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ name: "Form I intake", classNames: [formI.name], closesOn: ymd(20), on: ymd(30), time: "08:30", venue: "Hall B", full: false });
    await paid(); // the one place is taken: the window still shows, marked full, so a family knows it will wait for a date
    expect((await days.openWindows(school.id))[0]?.full).toBe(true);
    await clearDays();
    await days.addInterviewDay(rehema, { name: "Any class", on: ymd(30), time: "08:30" });
    await policy.updateAdmissionPolicy(admin, { ...POLICY, requireInterview: undefined, applicationFee: "10000" });
    expect(await days.openWindows(school.id)).toEqual([]);
    await policy.updateAdmissionPolicy(admin, { ...POLICY, applicationFee: "10000" });
  });

  it("a window is for its classes: an application for another class is not placed on it and waits for the office", async () => {
    await clearDays();
    const other = await createCurrentYearAcademicsClass();
    await days.addInterviewDay(rehema, { name: "Other class only", classIds: [other], on: ymd(22), time: "10:00" });
    expect(await liveInterview((await paid()).applicationId)).toBeNull(); // the applicant's class is not covered
    await days.addInterviewDay(rehema, { name: "Our class", classIds: [setup.cls.id], on: ymd(23), time: "10:00" });
    const a = await paid();
    expect((await liveInterview(a.applicationId))?.scheduledAt.toISOString()).toContain(ymd(23));
    expect(await code(days.addInterviewDay(rehema, { name: "Foreign class", classIds: ["00000000-0000-4000-8000-000000000000"], on: ymd(24), time: "10:00" }))).toBe("VALIDATION");
    expect(await code(days.addInterviewDay(rehema, { name: "", on: ymd(24), time: "10:00" }))).toBe("VALIDATION");
  });
});
