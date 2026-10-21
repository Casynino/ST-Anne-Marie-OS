import { describe, expect, it } from "vitest";
import { canAccess, canDiscover, type Audience, type ResourceRule, type Viewer } from "@/lib/library/access";
import { sniffLibraryFile } from "@/lib/library/files";
import { normaliseSchoolId } from "@/server/school-ids";

const now = new Date("2026-10-21T10:00:00Z");
const rule = (audience: Audience, extra: Partial<ResourceRule> = {}): ResourceRule => ({ status: "PUBLISHED", audience, availableFrom: null, idOnly: false, classIds: [], subjectIds: [], staffIds: [], ...extra });
const o = { now, allowIdOnly: false };

const visitor: Viewer = { kind: "VISITOR" };
const parent: Viewer = { kind: "GUARDIAN" };
const student = (extra: Partial<Extract<Viewer, { kind: "STUDENT" }>> = {}): Viewer => ({ kind: "STUDENT", studentId: "s1", classId: "c4", subjectIds: ["math"], level: "FULL", ...extra });
const teacher = (extra: Partial<Extract<Viewer, { kind: "STAFF" }>> = {}): Viewer => ({ kind: "STAFF", staffId: "t1", classIds: ["c4"], subjectIds: ["math"], canReadStaffMaterial: true, manager: false, level: "FULL", ...extra });

describe("who may open a resource", () => {
  it("public material is open to everyone, even without verifying", () => {
    for (const v of [visitor, parent, student(), teacher()]) expect(canAccess(v, rule("PUBLIC"), o)).toEqual({ ok: true });
  });

  it("an unpublished, archived or not-yet-released resource is open to nobody, not even as public", () => {
    for (const status of ["DRAFT", "PENDING_REVIEW", "APPROVED", "ARCHIVED"]) expect(canAccess(student(), rule("STUDENTS", { status }), o)).toEqual({ ok: false, reason: "UNAVAILABLE" });
    expect(canAccess(visitor, rule("PUBLIC", { availableFrom: new Date("2026-11-01T00:00:00Z") }), o)).toEqual({ ok: false, reason: "UNAVAILABLE" });
    expect(canAccess(visitor, rule("PUBLIC", { availableFrom: new Date("2026-10-01T00:00:00Z") }), o)).toEqual({ ok: true });
  });

  it("a visitor is asked to verify for student material and learns nothing of staff-only material", () => {
    expect(canAccess(visitor, rule("STUDENTS"), o)).toEqual({ ok: false, reason: "VERIFY" });
    expect(canAccess(visitor, rule("CLASSES", { classIds: ["c4"] }), o)).toEqual({ ok: false, reason: "VERIFY" });
    expect(canAccess(visitor, rule("STAFF"), o)).toEqual({ ok: false, reason: "UNAVAILABLE" });
    expect(canAccess(visitor, rule("RESTRICTED"), o)).toEqual({ ok: false, reason: "UNAVAILABLE" });
    expect(canAccess(parent, rule("STUDENTS"), o)).toEqual({ ok: false, reason: "NOT_FOR_YOU" });
  });

  it("a student gets student material, their own class and the subjects of their class, never staff or restricted material", () => {
    expect(canAccess(student(), rule("STUDENTS"), o).ok).toBe(true);
    expect(canAccess(student(), rule("CLASSES", { classIds: ["c4", "c5"] }), o).ok).toBe(true);
    expect(canAccess(student(), rule("CLASSES", { classIds: ["c5"] }), o)).toEqual({ ok: false, reason: "NOT_FOR_YOU" });
    expect(canAccess(student({ classId: null }), rule("CLASSES", { classIds: ["c4"] }), o).ok).toBe(false); // not placed in a class yet
    expect(canAccess(student(), rule("SUBJECTS", { subjectIds: ["math"] }), o).ok).toBe(true);
    expect(canAccess(student(), rule("SUBJECTS", { subjectIds: ["physics"] }), o).ok).toBe(false);
    expect(canAccess(student(), rule("STAFF"), o)).toEqual({ ok: false, reason: "UNAVAILABLE" }); // a teacher-only guide is not downloadable by a student
    expect(canAccess(student(), rule("RESTRICTED", { staffIds: ["t1"] }), o)).toEqual({ ok: false, reason: "UNAVAILABLE" });
  });

  it("a teacher gets staff material and the classes and subjects they teach; restricted needs their name on it", () => {
    expect(canAccess(teacher(), rule("STAFF"), o).ok).toBe(true);
    expect(canAccess(teacher(), rule("CLASSES", { classIds: ["c4"] }), o).ok).toBe(true);
    expect(canAccess(teacher(), rule("CLASSES", { classIds: ["c9"] }), o).ok).toBe(false);
    expect(canAccess(teacher(), rule("SUBJECTS", { subjectIds: ["math"] }), o).ok).toBe(true);
    expect(canAccess(teacher(), rule("SUBJECTS", { subjectIds: ["art"] }), o).ok).toBe(false);
    expect(canAccess(teacher(), rule("RESTRICTED", { staffIds: ["t2"] }), o).ok).toBe(false);
    expect(canAccess(teacher(), rule("RESTRICTED", { staffIds: ["t1"] }), o).ok).toBe(true);
  });

  it("other staff do not get teacher material just because they work at the school; managers see everything", () => {
    const clerk = teacher({ canReadStaffMaterial: false, classIds: [], subjectIds: [] });
    expect(canAccess(clerk, rule("PUBLIC"), o).ok).toBe(true);
    expect(canAccess(clerk, rule("STAFF"), o).ok).toBe(false);
    expect(canAccess(clerk, rule("STUDENTS"), o).ok).toBe(false);
    expect(canAccess(teacher({ manager: true, canReadStaffMaterial: false }), rule("RESTRICTED"), o).ok).toBe(true);
  });

  it("the school ID alone opens only what the school marked for it, and only while the school allows it", () => {
    const idOnly = student({ level: "ID_ONLY" });
    expect(canAccess(idOnly, rule("STUDENTS", { idOnly: true }), o)).toEqual({ ok: false, reason: "PIN_NEEDED" }); // switched off
    expect(canAccess(idOnly, rule("STUDENTS", { idOnly: true }), { ...o, allowIdOnly: true }).ok).toBe(true);
    expect(canAccess(idOnly, rule("STUDENTS", { idOnly: false }), { ...o, allowIdOnly: true })).toEqual({ ok: false, reason: "PIN_NEEDED" }); // not marked
    expect(canAccess(idOnly, rule("CLASSES", { idOnly: true, classIds: ["c5"] }), { ...o, allowIdOnly: true }).ok).toBe(false); // still not their class
    expect(canAccess(teacher({ level: "ID_ONLY" }), rule("STUDENTS", { idOnly: true }), { ...o, allowIdOnly: true }).ok).toBe(false);
  });

  it("lists show a visitor student material but never staff-only or restricted material, and a verified student only their own", () => {
    expect(canDiscover(visitor, rule("STUDENTS"), now)).toBe(true);
    expect(canDiscover(visitor, rule("CLASSES", { classIds: ["c9"] }), now)).toBe(true);
    expect(canDiscover(visitor, rule("STAFF"), now)).toBe(false);
    expect(canDiscover(visitor, rule("RESTRICTED"), now)).toBe(false);
    expect(canDiscover(student(), rule("CLASSES", { classIds: ["c9"] }), now)).toBe(false);
    expect(canDiscover(student(), rule("STAFF"), now)).toBe(false);
    expect(canDiscover(teacher(), rule("STAFF"), now)).toBe(true);
    expect(canDiscover(visitor, rule("PUBLIC", { status: "DRAFT" }), now)).toBe(false);
  });
});

describe("what may be uploaded, and how school IDs are tidied", () => {
  const zip = (marker: string, extra = "") => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`${marker}document.xml${extra}`)]);
  it("accepts PDF, pictures and Office files that really are what their name says", () => {
    expect(sniffLibraryFile(Buffer.from("%PDF-1.7 ..."), "a.pdf")?.kind).toBe("PDF");
    expect(sniffLibraryFile(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), "a.png")?.kind).toBe("IMAGE");
    expect(sniffLibraryFile(zip("word/"), "notes.docx")?.kind).toBe("DOCUMENT");
    expect(sniffLibraryFile(zip("ppt/"), "slides.pptx")?.kind).toBe("SLIDES");
    expect(sniffLibraryFile(zip("xl/"), "marks.xlsx")?.kind).toBe("SHEET");
  });
  it("refuses everything else: other zips, macro files, renamed programs, text", () => {
    expect(sniffLibraryFile(zip("word/"), "notes.zip")).toBeNull();
    expect(sniffLibraryFile(zip("word/"), "notes.xlsx")).toBeNull(); // a Word package named as Excel
    expect(sniffLibraryFile(zip("word/", "vbaProject.bin"), "notes.docx")).toBeNull();
    expect(sniffLibraryFile(Buffer.from("MZ\x90\x00 program"), "book.pdf")).toBeNull();
    expect(sniffLibraryFile(Buffer.from("just text"), "a.txt")).toBeNull();
  });
  it("tidies typed school IDs and refuses nonsense", () => {
    expect(normaliseSchoolId("  sam/2026/0029 ")).toBe("SAM/2026/0029");
    expect(normaliseSchoolId("sam / stf / 2026 / 0001")).toBe("SAM/STF/2026/0001");
    for (const bad of ["", "ab", "<script>", "a;b", "x".repeat(60), 42, null]) expect(normaliseSchoolId(bad)).toBeNull();
  });
});
