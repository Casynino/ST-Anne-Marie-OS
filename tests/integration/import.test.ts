import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import * as imports from "@/server/import";
import * as students from "@/server/students";
import * as academics from "@/server/academics";
import type { AuthContext } from "@/lib/auth/context";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, registrar: AuthContext, headTeacher: AuthContext, teacher: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let streamA: { id: string };
let n = 100;

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const HEAD = "first_name,last_name,date_of_birth,gender,admission_no,class,stream,guardian_name,guardian_phone,guardian_relationship,birth_certificate_no";
const phone = (k: number) => `0713${String(k).padStart(6, "0")}`;
const line = (k: number, extra: Partial<Record<string, string>> = {}) => {
  const f: Record<string, string> = { first: `Imp${k}`, last: `Student${k}`, dob: "05/03/2018", gender: "M", adm: "", cls: "", stream: "", gname: `Guardian ${k}`, gphone: phone(k), rel: "mother", cert: "", ...extra };
  return [f.first, f.last, f.dob, f.gender, f.adm, f.cls, f.stream, f.gname, f.gphone, f.rel, f.cert].join(",");
};
const csv = (...lines: string[]) => [HEAD, ...lines].join("\r\n");
const upload = (c: string, ctx = registrar, fileName = "students.csv") => imports.createImportBatch(ctx, { fileName, text: c });
const rowStatus = async (batchId: string) => Object.fromEntries((await db.importRow.findMany({ where: { batchId }, orderBy: { rowNumber: "asc" } })).map((r) => [r.rowNumber, r.status]));
const next = () => ++n;

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  headTeacher = (await createTestUser(school.id, ["head_teacher"])).ctx;
  teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
  setup = await createCurrentYearAcademics(admin, { className: "Standard I" });
  const level = setup.level;
  const c2 = await academics.createClass(admin, { levelId: level.id, name: "Standard II", sortOrder: 2 });
  streamA = await academics.createStream(admin, c2.id, "A");
});

describe("preview", () => {
  it("validates and stores rows without creating any student", async () => {
    const before = await db.student.count({ where: { schoolId: school.id } });
    const k1 = next(), k2 = next();
    const b = await upload(csv(line(k1, { cls: "Standard I" }), line(k2, { dob: "31/02/2018" })));
    expect(b.status).toBe("PREVIEW");
    expect(b.summary).toMatchObject({ total: 2, valid: 1, error: 1, warning: 0, duplicate: 0 });
    expect(await db.student.count({ where: { schoolId: school.id } })).toBe(before);
    expect(await rowStatus(b.id)).toEqual({ 2: "VALID", 3: "ERROR" });
    const view = await imports.getImportBatch(registrar, b.id);
    expect(view.problems[0]!.messages[0]).toMatchObject({ code: "INVALID_DATE", field: "dateOfBirth" });
    expect(view.columns.find((c) => c.header === "date_of_birth")?.field).toBe("dateOfBirth");
  });

  it("rejects files with missing required columns, no rows, too many rows or bad structure — creating no batch", async () => {
    const batches = await db.importBatch.count({ where: { schoolId: school.id } });
    expect(await code(imports.createImportBatch(registrar, { fileName: "a.csv", text: "first_name,last_name\r\nA,B" }))).toBe("VALIDATION");
    expect(await code(imports.createImportBatch(registrar, { fileName: "a.csv", text: HEAD }))).toBe("VALIDATION");
    expect(await code(imports.createImportBatch(registrar, { fileName: "a.csv", text: "" }))).toBe("VALIDATION");
    expect(await code(imports.createImportBatch(registrar, { fileName: "a.csv", text: csv(...Array.from({ length: imports.MAX_IMPORT_ROWS + 1 }, (_, i) => line(900000 + i))) }))).toBe("VALIDATION");
    expect(await code(imports.createImportBatch(registrar, { fileName: "a.csv", text: "x".repeat(imports.MAX_IMPORT_BYTES + 1) }))).toBe("VALIDATION");
    expect(await db.importBatch.count({ where: { schoolId: school.id } })).toBe(batches);
  });

  it("flags duplicates against existing students and inside the file, taken/repeated admission numbers and certificates", async () => {
    const existing = await students.createStudent(registrar, studentInput(next(), { firstName: "Already", lastName: "Here", dateOfBirth: "2018-03-05", birthCertificateNo: "CERT-1" }));
    const k = next(), k2 = next(), k3 = next(), k4 = next();
    const b = await upload(
      csv(
        line(1000 + k, { first: "already", last: "HERE" }), // 2: duplicate of existing student (case-insensitive)
        line(k, { first: "Twin", last: "One" }), // 3: ok
        line(k2, { first: "twin", last: "one" }), // 4: duplicate inside the file
        line(k3, { adm: existing.admissionNo.toLowerCase() }), // 5: admission number taken
        line(k4, { adm: "LEG-77" }), // 6: ok
        line(next(), { adm: "leg-77" }), // 7: admission number repeated
        line(next(), { cert: "cert-1" }), // 8: certificate belongs to an existing student
      ),
    );
    expect(await rowStatus(b.id)).toEqual({ 2: "DUPLICATE", 3: "VALID", 4: "DUPLICATE", 5: "ERROR", 6: "VALID", 7: "ERROR", 8: "ERROR" });
    const view = await imports.getImportBatch(registrar, b.id);
    expect(view.problems.find((p) => p.rowNumber === 2)!.messages[0]).toMatchObject({ code: "DUPLICATE_STUDENT", params: { admissionNo: existing.admissionNo } });
  });

  it("downloadable report lists every problem row with original values and neutralises formulas", async () => {
    const b = await upload(csv(line(next(), { gender: "unknown", first: "=cmd|' /C calc'!A0" }), line(next())));
    const { csv: report, fileName } = await imports.importErrorReport(registrar, b.id);
    expect(fileName).toMatch(/^import-report-students\.csv$/);
    expect(report.startsWith("﻿")).toBe(true);
    const lines = report.trim().split("\r\n");
    expect(lines).toHaveLength(2); // header + the one problem row
    expect(lines[1]).toContain("Gender: use Male or Female");
    expect(lines[1]).toContain("'=cmd"); // formula neutralised
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "student.import_report_download", entityId: b.id } })).toBe(1);
  });

  it("is limited by permission and school", async () => {
    const good = csv(line(next()));
    for (const who of [teacher, headTeacher]) expect(await code(upload(good, who))).toBe("FORBIDDEN");
    const other = await createTestSchool("Other import");
    const otherAdmin = (await createTestUser(other.id, ["super_admin"])).ctx;
    const b = await upload(good);
    expect(await code(imports.getImportBatch(otherAdmin, b.id))).toBe("NOT_FOUND");
    expect(await code(imports.confirmImport(otherAdmin, b.id))).toBe("NOT_FOUND");
    expect(await code(imports.importErrorReport(otherAdmin, b.id))).toBe("NOT_FOUND");
    expect(await code(imports.confirmImport(teacher, b.id))).toBe("FORBIDDEN");
    expect(imports.importTemplateCsv().trim().split("\r\n")).toHaveLength(1);
  });
});

describe("confirm", () => {
  it("imports only valid rows in one transaction, with admission numbers, shared sibling guardians, class placement and audit", async () => {
    const k = next();
    const siblingPhone = phone(k);
    const b = await upload(
      csv(
        line(k, { cls: "Standard I", gphone: siblingPhone, gname: "Mama Mushi", first: "Ann", last: "Mushi" }),
        line(k + 5000, { cls: "Standard II", stream: "A", gphone: siblingPhone, gname: "mama mushi", first: "Ben", last: "Mushi", dob: "2016-01-02" }), // sibling: same guardian
        line(next(), { adm: "OLD/2019/0042", first: "Legacy", last: "Pupil" }),
        line(next(), { dob: "not a date" }), // error: never imported
      ),
    );
    expect(b.summary).toMatchObject({ valid: 3, error: 1 });
    const before = await db.student.count({ where: { schoolId: school.id } });
    const res = await imports.confirmImport(registrar, b.id);
    expect(res).toMatchObject({ imported: 3, errors: 1 });
    expect(await db.student.count({ where: { schoolId: school.id } })).toBe(before + 3);

    const ann = await db.student.findFirstOrThrow({ where: { schoolId: school.id, firstName: "Ann" }, include: { guardians: true, enrollments: true } });
    const ben = await db.student.findFirstOrThrow({ where: { schoolId: school.id, firstName: "Ben" }, include: { guardians: true, enrollments: true } });
    expect(ann.admissionNo).toMatch(new RegExp(`^${school.code}/${new Date().getUTCFullYear()}/\\d{4}$`));
    expect(ann.guardians).toHaveLength(1);
    expect(ann.guardians[0]).toMatchObject({ isPrimary: true, relationship: "MOTHER" });
    expect(ann.guardians[0]!.guardianId).toBe(ben.guardians[0]!.guardianId); // one shared guardian record
    expect(ann.enrollments).toHaveLength(1);
    expect(ben.enrollments[0]).toMatchObject({ status: "ACTIVE", streamId: streamA.id });
    expect((await db.student.findFirstOrThrow({ where: { schoolId: school.id, firstName: "Legacy" } })).admissionNo).toBe("OLD/2019/0042");
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "student.create", entityId: ann.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "student.import", entityId: b.id } })).toBe(1);
    const view = await imports.getImportBatch(registrar, b.id);
    expect(view.status).toBe("IMPORTED");
    expect(Object.values(await rowStatus(b.id)).sort()).toEqual(["ERROR", "IMPORTED", "IMPORTED", "IMPORTED"]);
    // Imported students are visible through normal registration paths (duplicate detection now sees them).
    expect(await code(students.createStudent(registrar, studentInput(next(), { firstName: "Ann", lastName: "Mushi", dateOfBirth: "2018-03-05" })))).toBe("CONFLICT");
  });

  it("can be confirmed only once, even by simultaneous requests", async () => {
    const b = await upload(csv(line(next()), line(next())));
    const results = await Promise.all(Array.from({ length: 4 }, () => code(imports.confirmImport(registrar, b.id))));
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.filter((r) => r === "CONFLICT")).toHaveLength(3);
    expect(await db.student.count({ where: { schoolId: school.id, firstName: { in: ["Imp" + (n - 1), "Imp" + n] } } })).toBe(2);
    expect(await code(imports.cancelImport(registrar, b.id))).toBe("CONFLICT");
  });

  it("never reuses or collides with admission numbers: provided numbers are respected, generated ones skip them", async () => {
    // The next generated number would be …/NNNN; claim exactly that one with a legacy row in the same file.
    const probe = await students.createStudent(registrar, studentInput(next()));
    const seq = Number(probe.admissionNo.split("/").pop()) + 1;
    const taken = `${school.code}/${new Date().getUTCFullYear()}/${String(seq).padStart(4, "0")}`;
    const b = await upload(csv(line(next(), { adm: taken, first: "Claimer", last: "Legacy" }), line(next(), { first: "Gen1", last: "Auto" }), line(next(), { first: "Gen2", last: "Auto" })));
    await imports.confirmImport(registrar, b.id);
    const rows = await db.student.findMany({ where: { schoolId: school.id, lastName: { in: ["Legacy", "Auto"] } }, select: { admissionNo: true, firstName: true } });
    const numbers = rows.map((r) => r.admissionNo);
    expect(new Set(numbers).size).toBe(3);
    expect(rows.find((r) => r.firstName === "Claimer")!.admissionNo).toBe(taken);
    // Later registrations continue past everything that was used.
    const later = await students.createStudent(registrar, studentInput(next()));
    expect(numbers).not.toContain(later.admissionNo);
  });

  it("re-checks the database at confirm time: rows that became duplicates since the preview are skipped, not imported", async () => {
    const k = next(), k2 = next();
    const b = await upload(csv(line(k, { first: "Late", last: "Dup" }), line(k2, { first: "Fine", last: "Row" })));
    await students.createStudent(registrar, studentInput(next(), { firstName: "Late", lastName: "Dup", dateOfBirth: "2018-03-05" })); // registered after the preview
    const res = await imports.confirmImport(registrar, b.id);
    expect(res.imported).toBe(1);
    expect(await db.student.count({ where: { schoolId: school.id, firstName: "Late", lastName: "Dup" } })).toBe(1);
    expect((await rowStatus(b.id))[2]).toBe("SKIPPED");
  });

  it("holds shared guardian phone numbers for explicit confirmation and never links them to the existing guardian", async () => {
    const existing = await students.createStudent(registrar, studentInput(next()));
    const existingGuardian = (await students.getStudentProfile(registrar, existing.id)).guardians[0]!;
    const b = await upload(csv(line(next(), { gphone: existingGuardian.guardian.phone, gname: "Different Person", first: "Warn", last: "Case" }), line(next(), { first: "Plain", last: "Case" })));
    expect(b.summary).toMatchObject({ valid: 1, warning: 1 });
    const skippedRes = await imports.confirmImport(registrar, b.id); // warnings not confirmed
    expect(skippedRes).toMatchObject({ imported: 1, skipped: 1 });
    expect(await db.student.count({ where: { schoolId: school.id, firstName: "Warn" } })).toBe(0);

    const b2 = await upload(csv(line(next(), { gphone: existingGuardian.guardian.phone, gname: "Different Person", first: "Warn2", last: "Case" })));
    await imports.confirmImport(registrar, b2.id, { includeWarnings: true });
    const warn = await db.student.findFirstOrThrow({ where: { schoolId: school.id, firstName: "Warn2" }, include: { guardians: true } });
    expect(warn.guardians[0]!.guardianId).not.toBe(existingGuardian.guardianId);
  });

  it("is all-or-nothing: a database failure in the middle imports nothing and leaves the batch ready to retry", async () => {
    const b = await upload(csv(line(next(), { first: "Good1", last: "Atomic" }), line(next(), { first: "Boom", last: "Atomic" }), line(next(), { first: "Good2", last: "Atomic" })));
    await db.$executeRawUnsafe(`ALTER TABLE students ADD CONSTRAINT tmp_block_boom CHECK ("firstName" <> 'Boom') NOT VALID`); // NOT VALID: rows from earlier runs are ignored, new rows are checked
    try {
      await expect(imports.confirmImport(registrar, b.id)).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE students DROP CONSTRAINT tmp_block_boom`);
    }
    expect(await db.student.count({ where: { schoolId: school.id, lastName: "Atomic" } })).toBe(0);
    expect(await db.guardian.count({ where: { schoolId: school.id, fullName: { in: (await db.importRow.findMany({ where: { batchId: b.id } })).map((r) => ((r.raw as { cells: string[] }).cells[7]!)) } } })).toBe(0);
    expect((await db.importBatch.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("PREVIEW");
    expect((await imports.confirmImport(registrar, b.id)).imported).toBe(3); // retry works once the cause is gone
  });

  it("cancelling discards the preview without importing", async () => {
    const b = await upload(csv(line(next(), { first: "Cancelled", last: "One" })));
    await imports.cancelImport(registrar, b.id);
    expect(await code(imports.confirmImport(registrar, b.id))).toBe("CONFLICT");
    expect(await db.student.count({ where: { schoolId: school.id, firstName: "Cancelled" } })).toBe(0);
  });

  it("imports a large file in bulk within a reasonable time", async () => {
    const rows = Array.from({ length: 600 }, (_, i) => line(500000 + i, { first: `Bulk${i}`, last: "Load", cls: "Standard I", gphone: phone(500000 + i) }));
    const b = await upload(csv(...rows));
    expect(b.summary).toMatchObject({ valid: 600 });
    const t0 = Date.now();
    const res = await imports.confirmImport(registrar, b.id);
    const ms = Date.now() - t0;
    expect(res.imported).toBe(600);
    expect(ms).toBeLessThan(30000);
    const nums = (await db.student.findMany({ where: { schoolId: school.id, lastName: "Load" }, select: { admissionNo: true } })).map((s) => s.admissionNo);
    expect(new Set(nums).size).toBe(600);
    expect(await db.studentEnrollment.count({ where: { schoolId: school.id, student: { lastName: "Load" }, status: "ACTIVE" } })).toBe(600);
    console.log(`bulk import of 600 rows took ${ms} ms`);
    expect(randomUUID()).toBeTruthy();
  });
});
