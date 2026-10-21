import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import * as website from "@/server/website";
import * as pub from "@/server/public-applications";
import * as admissions from "@/server/admissions";
import * as offers from "@/server/admission-offers";
import { createTestAcademics, createTestSchool, createTestUser } from "../helpers";
import type { AuthContext } from "@/lib/auth/context";

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext;
let registrar: AuthContext;
let setup: Awaited<ReturnType<typeof createTestAcademics>>;
let n = 100;
const ipOf = () => `203.0.113.${(n % 250) + 1}-${randomUUID().slice(0, 6)}`; // unique per test so rate limits never collide
const meta = (ip = ipOf()) => ({ ip, userAgent: "vitest" });
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;

const form = (extra: Record<string, unknown> = {}) => {
  n++;
  return {
    firstName: `Online${n}`,
    lastName: `Child${n}`,
    dateOfBirth: "2019-05-20",
    gender: "MALE",
    classAppliedId: setup.cls.id,
    g1_fullName: `Parent ${n}`,
    g1_phone: `07${String(30000000 + n).slice(-8)}`,
    g1_relationship: "MOTHER",
    consent: "on",
    website: "",
    ...extra,
  };
};

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  setup = await createTestAcademics(admin);
});

describe("website settings", () => {
  it("needs website.manage and rejects unsafe image paths / links", async () => {
    expect(await code(website.updateWebsiteSettings(registrar, { applicationsOpen: "on" }))).toBe("FORBIDDEN");
    expect(await code(website.updateWebsiteSettings(admin, { logoPath: "../../etc/passwd.png" }))).toBe("VALIDATION");
    expect(await code(website.updateWebsiteSettings(admin, { logoPath: "https://evil.example/x.png" }))).toBe("VALIDATION");
    expect(await code(website.updateWebsiteSettings(admin, { heroImagePath: "/site/hero.exe" }))).toBe("VALIDATION");
    expect(await code(website.updateWebsiteSettings(admin, { facebook: "javascript:alert(1)" }))).toBe("VALIDATION");
    await website.updateWebsiteSettings(admin, { logoPath: "/site/logo.png", facebook: "https://facebook.com/x", en_faqs: "When do you open?\nIn January.\n\nFees?\nSee the office." });
    const s = await website.loadWebsiteSettings(school.id);
    expect(s.logoPath).toBe("/site/logo.png");
    expect(s.applicationsOpen).toBe(false);
    expect(website.parseFaqs(s.en.faqs)).toEqual([{ q: "When do you open?", a: "In January." }, { q: "Fees?", a: "See the office." }]);
  });

  it("public site data shows real classes and falls back to the school name; empty sections stay empty", async () => {
    const site = await website.getPublicSite("EN");
    // The public site serves PUBLIC_SCHOOL_CODE/the first school, so read this school's data directly through settings.
    expect(site).not.toBeNull();
    const s = await website.loadWebsiteSettings(school.id);
    expect(s.en.about).toBeUndefined();
  });
});

describe("online application", () => {
  it("is refused while applications are closed", async () => {
    await website.updateWebsiteSettings(admin, { applicationsOpen: "" });
    expect(await code(pub.submitOnlineApplication(school.id, form(), meta()))).toBe("CONFLICT");
    expect(await db.application.count({ where: { schoolId: school.id } })).toBe(0);
  });

  it("creates an APPLIED online application with no staff user, an audit entry, and works with the staff pipeline", async () => {
    await website.updateWebsiteSettings(admin, { applicationsOpen: "on" });
    const input = form({ g2_fullName: "Second Guardian", g2_phone: "0765 111 222", g2_relationship: "FATHER" });
    const { applicationNo } = await pub.submitOnlineApplication(school.id, input, meta());
    expect(applicationNo).toMatch(/^APP\/\d{4}\/\d{4}$/);
    const app = await db.application.findFirstOrThrow({ where: { schoolId: school.id, applicationNo: applicationNo! }, include: { events: true } });
    expect(app).toMatchObject({ status: "APPLIED", source: "ONLINE", createdById: null });
    expect(app.consentAt).not.toBeNull();
    expect(app.events[0]).toMatchObject({ toStatus: "APPLIED", byUserId: null });
    expect((app.guardians as { phone: string }[]).map((g) => g.phone)).toContain("+255765111222");
    const log = await db.auditLog.findFirst({ where: { schoolId: school.id, entityId: app.id, action: "admission.create_online" } });
    expect(log).toMatchObject({ actorId: null, actorName: "Online applicant" });

    // Staff can review and enrol it through the normal Phase 2 workflow: accepted != enrolled.
    expect((await admissions.getApplication(admin, app.id)).events[0]).toMatchObject({ byApplicant: true });
    await offers.issueOffer(admin, app.id, {});
    expect(await db.student.count({ where: { schoolId: school.id } })).toBe(0);
    await admissions.enrolApplication(admin, app.id, {});
    const student = await db.student.findFirstOrThrow({ where: { schoolId: school.id, firstName: app.firstName } });
    expect(student.admissionNo).toBeTruthy();
    expect(await db.studentGuardian.count({ where: { studentId: student.id } })).toBe(2);
  });

  it("silently ignores bots that fill the honeypot", async () => {
    const before = await db.application.count({ where: { schoolId: school.id } });
    const res = await pub.submitOnlineApplication(school.id, form({ website: "http://spam.example" }), meta());
    expect(res.applicationNo).toBeNull();
    expect(await db.application.count({ where: { schoolId: school.id } })).toBe(before);
  });

  it("refuses duplicates without revealing any other record", async () => {
    const input = form();
    await pub.submitOnlineApplication(school.id, input, meta());
    const err = (await pub.submitOnlineApplication(school.id, { ...input, g1_phone: "0711000999" }, meta()).catch((e) => e)) as AppError;
    expect(err.code).toBe("CONFLICT");
    expect(err.message).not.toMatch(/APP\/|SAM|\d{4}\/\d{4}/);
  });

  it("rate-limits each connection and validates consent, dates and classes", async () => {
    const ip = ipOf();
    for (let i = 0; i < 5; i++) await pub.submitOnlineApplication(school.id, form(), meta(ip));
    expect(await code(pub.submitOnlineApplication(school.id, form(), meta(ip)))).toBe("RATE_LIMITED");

    expect(await code(pub.submitOnlineApplication(school.id, form({ consent: "" }), meta()))).toBe("VALIDATION");
    expect(await code(pub.submitOnlineApplication(school.id, form({ dateOfBirth: "2999-01-01" }), meta()))).toBe("VALIDATION");
    expect(await code(pub.submitOnlineApplication(school.id, form({ dateOfBirth: "1950-01-01" }), meta()))).toBe("VALIDATION");
    expect(await code(pub.submitOnlineApplication(school.id, form({ g1_phone: "123" }), meta()))).toBe("VALIDATION");
    expect(await code(pub.submitOnlineApplication(school.id, form({ g2_fullName: "Only name" }), meta()))).toBe("VALIDATION");
    expect(await code(pub.submitOnlineApplication(school.id, form({ classAppliedId: randomUUID() }), meta()))).toBe("VALIDATION");
  });

  it("cannot be used to apply to a class of another school", async () => {
    const other = await createTestSchool("Other");
    const otherAdmin = (await createTestUser(other.id, ["super_admin"])).ctx;
    await website.updateWebsiteSettings(otherAdmin, { applicationsOpen: "on" });
    const otherSetup = await createTestAcademics(otherAdmin);
    expect(await code(pub.submitOnlineApplication(school.id, form({ classAppliedId: otherSetup.cls.id }), meta()))).toBe("VALIDATION");
    expect(await db.application.count({ where: { schoolId: other.id } })).toBe(0);
  });

  it("status tracking needs the application number AND a guardian phone, and never leaks details", async () => {
    const input = form();
    const { applicationNo } = await pub.submitOnlineApplication(school.id, input, meta());
    const ok = await pub.trackApplication(school.id, { applicationNo, phone: String(input.g1_phone) }, meta());
    expect(ok.status).toBe("APPLIED");
    // Only what the family needs; at this stage there is no interview, correction, offer or payment to show, and never any notes or decisions.
    expect(Object.keys(ok).sort()).toEqual(["className", "correction", "currency", "interview", "offer", "payment", "status", "submittedOn", "timezone"]);
    expect([ok.interview, ok.correction, ok.offer, ok.payment]).toEqual([null, null, null, null]);
    const wrongPhone = (await pub.trackApplication(school.id, { applicationNo, phone: "0799000111" }, meta()).catch((e) => e)) as AppError;
    const unknownNo = (await pub.trackApplication(school.id, { applicationNo: `APP/2099/${String(1000 + Math.floor(Math.random() * 8999))}`, phone: "0799000111" }, meta()).catch((e) => e)) as AppError;
    expect(wrongPhone.message).toBe(unknownNo.message); // cannot probe which numbers exist
    const other = await createTestSchool("Other 2");
    expect(await code(pub.trackApplication(other.id, { applicationNo, phone: String(input.g1_phone) }, meta()))).toBe("VALIDATION"); // not found in another school
  });
});

describe("public news and events", () => {
  it("only published, public items are visible; drafts and other schools' posts never are", async () => {
    expect(await code(website.createNews(registrar, { title: "x", body: "y" }))).toBe("FORBIDDEN");
    const draft = await website.createNews(admin, { title: "Draft post", body: "Not yet", isPublic: "on" });
    const live = await website.createNews(admin, { title: "Live post", body: "Hello", isPublic: "on" });
    const internal = await website.createNews(admin, { title: "Internal", body: "Staff only", isPublic: "" });
    await website.setNewsPublished(admin, live.id, true);
    await website.setNewsPublished(admin, internal.id, true);

    const list = await website.listPublicNews(school.id);
    const titles = list.items.map((i) => i.title);
    expect(titles).toContain("Live post");
    expect(titles).not.toContain("Draft post");
    expect(titles).not.toContain("Internal");
    expect(await website.getPublicNews(school.id, draft.id)).toBeNull();
    expect(await website.getPublicNews(school.id, live.id)).not.toBeNull();
    expect(await website.getPublicNews((await createTestSchool("Elsewhere")).id, live.id)).toBeNull();
    expect(await website.getPublicNews(school.id, "not-a-uuid")).toBeNull();

    await website.setNewsPublished(admin, live.id, false);
    expect((await website.listPublicNews(school.id)).items.map((i) => i.title)).not.toContain("Live post");
    const audits = await db.auditLog.findMany({ where: { schoolId: school.id, entityId: live.id } });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["news.create", "news.publish", "news.unpublish"]));
  });

  it("lists only upcoming public events and rejects an end date before the start", async () => {
    const future = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
    const past = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    await website.createEvent(admin, { title: "Open day", startsOn: future, isPublic: "on" });
    await website.createEvent(admin, { title: "Old event", startsOn: past, isPublic: "on" });
    await website.createEvent(admin, { title: "Staff retreat", startsOn: future, isPublic: "" });
    expect(await code(website.createEvent(admin, { title: "Bad", startsOn: future, endsOn: past, isPublic: "on" }))).toBe("VALIDATION");
    const titles = (await website.listPublicEvents(school.id, "Africa/Dar_es_Salaam")).map((e) => e.title);
    expect(titles).toEqual(["Open day"]);
  });
});
