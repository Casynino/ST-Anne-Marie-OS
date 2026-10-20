import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import * as web from "@/server/website";
import * as media from "@/server/media";
import * as enq from "@/server/enquiries";
import * as ac from "@/server/academics";
import type { AuthContext } from "@/lib/auth/context";
import { createTestAcademics, createTestSchool, createTestUser } from "../helpers";

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext;
let registrar: AuthContext;
let teacher: AuthContext;
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const meta = () => ({ ip: `198.51.100.${Math.floor(Math.random() * 250)}-${randomUUID().slice(0, 6)}`, userAgent: "vitest" });

function pngBytes(w: number, h: number, size = 600) {
  const b = new Uint8Array(size);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  teacher = (await createTestUser(school.id, ["subject_teacher"])).ctx;
});

describe("media library", () => {
  it("stores valid images, decides the type from the bytes, and requires alt text", async () => {
    const ok = await media.uploadMedia(admin, { name: "front gate.png", bytes: pngBytes(800, 600) }, { alt: "The school gate" });
    expect(ok.width).toBe(800);
    const row = await media.getMediaBytes(ok.id);
    expect(row?.mimeType).toBe("image/png");
    expect(row?.bytes.length).toBe(600);

    const notImage = new TextEncoder().encode("<script>alert(1)</script>" + " ".repeat(60));
    expect(await code(media.uploadMedia(admin, { name: "evil.png", bytes: notImage }, { alt: "x" }))).toBe("VALIDATION");
    expect(await code(media.uploadMedia(admin, { name: "a.png", bytes: pngBytes(800, 600) }, { alt: "" }))).toBe("VALIDATION");
    expect(await code(media.uploadMedia(admin, { name: "tiny.png", bytes: pngBytes(50, 50) }, { alt: "tiny" }))).toBe("VALIDATION");
    expect(await code(media.uploadMedia(admin, { name: "big.png", bytes: pngBytes(800, 600, media.MAX_MEDIA_BYTES + 1) }, { alt: "big" }))).toBe("VALIDATION");
    expect(await code(media.uploadMedia(admin, { name: "empty.png", bytes: new Uint8Array(0) }, { alt: "e" }))).toBe("VALIDATION");
  });

  it("needs website.manage, is school-scoped, and refuses to delete an image that is in use", async () => {
    expect(await code(media.uploadMedia(registrar, { name: "a.png", bytes: pngBytes(800, 600) }, { alt: "a" }))).toBe("FORBIDDEN");
    const m = await media.uploadMedia(admin, { name: "hero.png", bytes: pngBytes(1200, 800) }, { alt: "Hero" });
    await web.updateWebsiteSettings(admin, { heroImagePath: `/media/${m.id}` });
    expect(await code(media.deleteMedia(admin, m.id))).toBe("CONFLICT");

    const other = await createTestSchool("Other media");
    const otherAdmin = (await createTestUser(other.id, ["super_admin"])).ctx;
    expect(await code(media.deleteMedia(otherAdmin, m.id))).toBe("NOT_FOUND");
    expect((await media.listMedia(otherAdmin)).length).toBe(0);

    await web.updateWebsiteSettings(admin, {});
    await media.deleteMedia(admin, m.id);
    expect(await media.getMediaBytes(m.id)).toBeNull();
    expect(await media.getMediaBytes("not-a-uuid")).toBeNull();
  });
});

describe("enquiries (public contact form)", () => {
  const form = (extra: Record<string, unknown> = {}) => ({ name: "Parent One", phone: "0713 222 333", message: "Please tell me about admissions for next year.", consent: "on", website: "", ...extra });

  it("is saved before success is reported, audited, and visible to authorised staff only", async () => {
    await enq.submitEnquiry(school.id, form({ topic: "Admissions" }), meta());
    const list = await enq.listEnquiries(registrar);
    expect(list.items[0]).toMatchObject({ name: "Parent One", phone: "+255713222333", topic: "Admissions", status: "NEW" });
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "enquiry.create", actorId: null } })).toBeGreaterThan(0);
    expect(await code(enq.listEnquiries(teacher))).toBe("FORBIDDEN");
    expect(await enq.countNewEnquiries(registrar)).toBeGreaterThan(0);
    expect(await enq.countNewEnquiries(teacher)).toBeNull();
  });

  it("ignores bots, validates input and rate-limits each connection", async () => {
    const before = await db.enquiry.count({ where: { schoolId: school.id } });
    expect((await enq.submitEnquiry(school.id, form({ website: "http://spam.example" }), meta())).saved).toBe(true);
    expect(await db.enquiry.count({ where: { schoolId: school.id } })).toBe(before); // honeypot: nothing stored
    expect(await code(enq.submitEnquiry(school.id, form({ phone: "", email: "" }), meta()))).toBe("VALIDATION"); // no way to reply
    expect(await code(enq.submitEnquiry(school.id, form({ consent: "" }), meta()))).toBe("VALIDATION");
    expect(await code(enq.submitEnquiry(school.id, form({ message: "hi" }), meta()))).toBe("VALIDATION");
    const m = meta();
    for (let i = 0; i < 5; i++) await enq.submitEnquiry(school.id, form(), m);
    expect(await code(enq.submitEnquiry(school.id, form(), m))).toBe("RATE_LIMITED");
  });

  it("can be handled by staff and never crosses schools", async () => {
    await enq.submitEnquiry(school.id, form({ name: "Handle Me" }), meta());
    const target = (await enq.listEnquiries(admin)).items.find((e) => e.name === "Handle Me")!;
    expect(await code(enq.updateEnquiry(teacher, target.id, { status: "RESOLVED" }))).toBe("FORBIDDEN");
    await enq.updateEnquiry(registrar, target.id, { status: "RESOLVED", internalNote: "Called back" });
    expect((await db.enquiry.findUniqueOrThrow({ where: { id: target.id } })).handledById).toBe(registrar.userId);
    const other = await createTestSchool("Other enquiries");
    const otherAdmin = (await createTestUser(other.id, ["super_admin"])).ctx;
    expect(await code(enq.updateEnquiry(otherAdmin, target.id, { status: "NEW" }))).toBe("NOT_FOUND");
    expect((await enq.listEnquiries(otherAdmin)).total).toBe(0);
  });
});

describe("news, slugs and the announcement bar", () => {
  it("gives stable slugs, resolves by slug or id, and filters by category", async () => {
    const post = await web.createNews(admin, { title: "Open Day Announced!", body: "Details", category: "Events", isPublic: "on" });
    expect(post.slug).toMatch(/^open-day-announced-[0-9a-f]{6}$/);
    await web.updateNews(admin, post.id, { title: "Open Day Moved", body: "New details", category: "Events", isPublic: "on" });
    expect((await db.announcement.findUniqueOrThrow({ where: { id: post.id } })).slug).toBe(post.slug); // links never break
    expect(await web.getPublicNews(school.id, post.slug!)).toBeNull(); // still a draft
    await web.setNewsPublished(admin, post.id, true);
    expect((await web.getPublicNews(school.id, post.slug!))?.id).toBe(post.id);
    expect((await web.getPublicNews(school.id, post.id))?.id).toBe(post.id);
    expect(await web.getPublicNews(school.id, "../../etc")).toBeNull();
    expect((await web.listPublicNews(school.id, { category: "Events" })).items.map((n) => n.id)).toContain(post.id);
    expect((await web.listPublicNews(school.id, { category: "Nothing" })).items).toHaveLength(0);
    expect(await web.listNewsCategories(school.id)).toContain("Events");
  });

  it("shows only the newest published, public, flagged post in the bar", async () => {
    expect(await web.getBarAnnouncement(school.id)).toBeNull();
    const draft = await web.createNews(admin, { title: "Draft notice", body: "x", isPublic: "on", showInBar: "on" });
    const internal = await web.createNews(admin, { title: "Internal notice", body: "x", isPublic: "", showInBar: "on" });
    await web.setNewsPublished(admin, internal.id, true);
    expect(await web.getBarAnnouncement(school.id)).toBeNull(); // draft and non-public posts never appear
    const live = await web.createNews(admin, { title: "Real notice", body: "x", isPublic: "on", showInBar: "on", barLink: "/apply" });
    await web.setNewsPublished(admin, live.id, true);
    expect(await web.getBarAnnouncement(school.id)).toMatchObject({ title: "Real notice", barLink: "/apply" });
    expect(draft.id).not.toBe(live.id);
    expect(await code(web.createNews(admin, { title: "Bad link", body: "x", showInBar: "on", barLink: "javascript:alert(1)" }))).toBe("VALIDATION");
    expect(await code(web.createNews(admin, { title: "Bad cover", body: "x", coverImage: "https://evil.example/a.png" }))).toBe("VALIDATION");
  });

  it("builds an excerpt from the article when none is written", () => {
    expect(web.excerptOf({ excerpt: "Short.", body: "Long body", bodySw: null }, "EN")).toBe("Short.");
    expect(web.excerptOf({ excerpt: null, body: "word ".repeat(100), bodySw: null }, "EN", 40).length).toBeLessThanOrEqual(40);
    expect(web.excerptOf({ excerpt: null, body: "English", bodySw: "Kiswahili" }, "SW")).toBe("Kiswahili");
  });
});

describe("public site data", () => {
  it("shows the real levels, classes and subjects with programme text merged in, and resolves uploaded images", async () => {
    process.env.PUBLIC_SCHOOL_CODE = school.code;
    const setup = await createTestAcademics(admin, { className: "Standard I" });
    const maths = await ac.createSubject(admin, { code: "mth", name: "Mathematics", nameSw: "Hisabati" });
    await ac.setClassSubjects(admin, setup.cls.id, [maths.id]);
    const img = await media.uploadMedia(admin, { name: "logo.png", bytes: pngBytes(512, 512) }, { alt: "School logo" });
    await web.updateWebsiteSettings(admin, {
      applicationsOpen: "on", logoPath: `/media/${img.id}`,
      en_programs: "Primary | Foundations in reading and number | Literacy and numeracy",
      en_strengths: "Experienced teachers | Teachers who know every child\nSupportive environment | A safe place to learn",
      sw_heroTitle: "Karibu shuleni",
    });
    const en = (await web.getPublicSite("EN"))!;
    expect(en.school.id).toBe(school.id);
    expect(en.levels[0]).toMatchObject({ name: "Primary", classes: ["Standard I"], subjects: ["Mathematics"], summary: "Foundations in reading and number", focus: "Literacy and numeracy" });
    expect(en.text.strengths).toEqual([{ title: "Experienced teachers", text: "Teachers who know every child" }, { title: "Supportive environment", text: "A safe place to learn" }]);
    expect(en.text.heroTitle).toBe("Karibu shuleni"); // no English text yet: falls back to the other language, never to invented copy
    expect(en.text.about).toBeUndefined();
    expect(en.images.logo).toMatchObject({ src: `/media/${img.id}`, width: 512, height: 512, alt: "School logo" });
    const sw = (await web.getPublicSite("SW"))!;
    expect(sw.text.heroTitle).toBe("Karibu shuleni");
    expect(sw.levels[0]!.subjects).toEqual(["Hisabati"]);
    // a school with no content at all shows its real name, nothing invented
    const blank = await createTestSchool("Blank School");
    process.env.PUBLIC_SCHOOL_CODE = blank.code;
    const empty = (await web.getPublicSite("EN"))!;
    expect(empty.text.heroTitle).toBe("Blank School");
    expect(empty.levels).toEqual([]);
    expect(empty.settings.gallery).toBeUndefined(); // nothing chosen by the school...
    expect(empty.images.gallery.every((g) => g.src.startsWith("/site/"))).toBe(true); // ...so only the bundled school photos (never uploads or stock) are used
    process.env.PUBLIC_SCHOOL_CODE = school.code;
    // a deleted/unknown upload must not render a broken image
    await web.updateWebsiteSettings(admin, { logoPath: `/media/${randomUUID()}` });
    expect((await web.getPublicSite("EN"))!.images.logo).toBeUndefined();
  });
});
