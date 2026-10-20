import { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/lib/db";
import { conflict, invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { CsvError, parseCsv, toCsv } from "@/lib/csv";
import { formatDateOnly, parseDateOnly, todayInTimezone } from "@/lib/dates";
import { makeT } from "@/lib/i18n";
import { describeMessage } from "@/lib/import/messages";
import { TEMPLATE_HEADERS, detectHeaders, rowFromCells, validateRow, type ParsedRow, type RowMessage } from "@/lib/import/students";
import { actorOf, writeAudit } from "@/server/audit";
import { formatAdmissionNo } from "@/server/students";
import { getAdmissionSettings } from "@/server/settings";

/*
 * Bulk student import (CSV).
 *   1. upload  → header detection, per-row validation, duplicate detection → stored as a PREVIEW batch (nothing imported)
 *   2. preview → counts, problem rows, downloadable error report
 *   3. confirm → one transaction: re-checks every row against the current database, then creates guardians,
 *                students, links, enrolments and audit entries in bulk. All or nothing; at most once per batch.
 * Rows with errors or duplicates are never imported. Rows with warnings (shared guardian phone) import only
 * when the registrar explicitly confirms.
 */

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_BYTES = 2_000_000;

type Stored = { cells: string[]; parsed: ParsedRow | null };
type Msg = RowMessage;

const keyOf = (p: { firstName: string; lastName: string; dateOfBirth: string }) => `${p.firstName.trim().toLowerCase()}|${p.lastName.trim().toLowerCase()}|${p.dateOfBirth}`;
const guardianKey = (g: { phone: string; fullName: string }) => `${g.phone}|${g.fullName.trim().toLowerCase()}`;

function requireImportPermissions(ctx: AuthContext) {
  requirePermission(ctx, "student.import");
  requirePermission(ctx, "student.create");
  requirePermission(ctx, "guardian.manage");
}

async function schoolToday(client: Tx | typeof db, schoolId: string): Promise<Date> {
  const school = await client.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timezone: true } });
  return parseDateOnly(todayInTimezone(school.timezone)) as Date;
}

// ───────────────────────── 1. Upload → preview ─────────────────────────

export async function createImportBatch(ctx: AuthContext, input: { fileName: string; text: string }) {
  requireImportPermissions(ctx);
  if (input.text.length > MAX_IMPORT_BYTES) throw invalid("The file is too large. Split it into files of at most 1,000 students.", { file: "File too large" });

  let rows: string[][];
  try {
    rows = parseCsv(input.text, { maxRows: MAX_IMPORT_ROWS, maxCols: 60, maxCell: 2000 }).rows;
  } catch (e) {
    if (e instanceof CsvError) throw invalid(e.code === "TOO_MANY_ROWS" ? `The file has more than ${MAX_IMPORT_ROWS} students. Split it into smaller files.` : e.message, { file: e.code });
    throw e;
  }
  if (rows.length < 2) throw invalid("The file has a header row but no students.", { file: "No rows" });
  const headers = rows[0]!.map((h) => h.trim());
  const { map, columns, missing } = detectHeaders(headers);
  if (missing.length) throw invalid(`Required columns not found: ${missing.join(", ")}. Download the template to see the expected columns.`, { file: "MISSING_COLUMNS" });
  if (map.className !== undefined) requirePermission(ctx, "student.enroll");

  const today = await schoolToday(db, ctx.schoolId);
  const [classes, students, guardians] = await Promise.all([
    db.schoolClass.findMany({ where: { schoolId: ctx.schoolId, isActive: true }, select: { id: true, name: true, nameSw: true, streams: { select: { id: true, name: true } } } }),
    db.student.findMany({ where: { schoolId: ctx.schoolId }, select: { firstName: true, lastName: true, dateOfBirth: true, admissionNo: true, birthCertificateNo: true } }),
    db.guardian.findMany({ where: { schoolId: ctx.schoolId }, select: { fullName: true, phone: true, altPhone: true } }),
  ]);
  const existingStudent = new Map(students.map((s) => [keyOf({ firstName: s.firstName, lastName: s.lastName, dateOfBirth: formatDateOnly(s.dateOfBirth) }), s.admissionNo]));
  const takenAdmission = new Map(students.map((s) => [s.admissionNo.toLowerCase(), s.admissionNo]));
  const takenCerts = new Set(students.flatMap((s) => (s.birthCertificateNo ? [s.birthCertificateNo.toLowerCase()] : [])));
  const guardianByPhone = new Map<string, string>();
  for (const g of guardians) {
    guardianByPhone.set(g.phone, g.fullName);
    if (g.altPhone) guardianByPhone.set(g.altPhone, g.fullName);
  }

  const seenKeys = new Map<string, number>();
  const seenAdmission = new Map<string, number>();
  const seenCerts = new Map<string, number>();
  const phoneNames = new Map<string, { name: string; row: number }>();
  const prepared: { rowNumber: number; stored: Stored; status: "VALID" | "WARNING" | "ERROR" | "DUPLICATE"; messages: Msg[] }[] = [];

  for (const [i, cells] of rows.slice(1).entries()) {
    const rowNumber = i + 2;
    if (cells.every((c) => !c.trim())) continue;
    const raw = rowFromCells(cells, map);
    const { parsed, errors } = validateRow(raw, { today, classes });
    const messages: Msg[] = [...errors];
    let status: "VALID" | "WARNING" | "ERROR" | "DUPLICATE" = errors.length ? "ERROR" : "VALID";

    if (parsed) {
      const key = keyOf(parsed);
      const dbHit = existingStudent.get(key);
      const fileHit = seenKeys.get(key);
      if (dbHit) {
        status = "DUPLICATE";
        messages.push({ code: "DUPLICATE_STUDENT", params: { admissionNo: dbHit } });
      } else if (fileHit) {
        status = "DUPLICATE";
        messages.push({ code: "DUPLICATE_IN_FILE", params: { row: fileHit } });
      } else seenKeys.set(key, rowNumber);

      if (parsed.admissionNo) {
        const k = parsed.admissionNo.toLowerCase();
        if (takenAdmission.has(k)) {
          status = "ERROR";
          messages.push({ code: "ADMISSION_NO_TAKEN", field: "admissionNo", params: { value: takenAdmission.get(k)! } });
        } else if (seenAdmission.has(k)) {
          status = "ERROR";
          messages.push({ code: "ADMISSION_NO_REPEATED", field: "admissionNo", params: { row: seenAdmission.get(k)! } });
        } else seenAdmission.set(k, rowNumber);
      }
      if (parsed.birthCertificateNo) {
        const k = parsed.birthCertificateNo.toLowerCase();
        if (takenCerts.has(k) || seenCerts.has(k)) {
          status = status === "DUPLICATE" ? status : "ERROR";
          messages.push({ code: "BIRTH_CERT_TAKEN", field: "birthCertificateNo" });
        } else seenCerts.set(k, rowNumber);
      }
      if (status === "VALID") {
        for (const g of parsed.guardians) {
          const existing = guardianByPhone.get(g.phone);
          const inFile = phoneNames.get(g.phone);
          if (existing) {
            status = "WARNING";
            messages.push({ code: "SHARED_PHONE_DB", field: "guardianPhone", params: { name: existing } });
          } else if (inFile && inFile.name !== g.fullName.trim().toLowerCase()) {
            status = "WARNING";
            messages.push({ code: "SHARED_PHONE_FILE", field: "guardianPhone", params: { row: inFile.row } });
          }
          if (!inFile) phoneNames.set(g.phone, { name: g.fullName.trim().toLowerCase(), row: rowNumber });
        }
      }
    }
    prepared.push({ rowNumber, stored: { cells, parsed }, status, messages });
  }
  if (!prepared.length) throw invalid("The file has no student rows.", { file: "No rows" });

  const count = (s: string) => prepared.filter((p) => p.status === s).length;
  const summary = { total: prepared.length, valid: count("VALID"), warning: count("WARNING"), error: count("ERROR"), duplicate: count("DUPLICATE") };
  return db.$transaction(
    async (tx) => {
      const batch = await tx.importBatch.create({
        data: {
          schoolId: ctx.schoolId,
          createdById: ctx.userId,
          fileName: input.fileName.slice(0, 200),
          headerMap: { headers, columns: columns.map((c) => ({ header: c.header, field: c.field })) },
          summary,
        },
      });
      await tx.importRow.createMany({
        data: prepared.map((p) => ({ schoolId: ctx.schoolId, batchId: batch.id, rowNumber: p.rowNumber, raw: p.stored as unknown as Prisma.InputJsonValue, status: p.status, messages: p.messages as unknown as Prisma.InputJsonValue })),
      });
      await writeAudit(tx, actorOf(ctx), { action: "student.import_preview", entityType: "ImportBatch", entityId: batch.id, summary: batch.fileName, changes: summary });
      return batch;
    },
    { timeout: 60000 },
  );
}

// ───────────────────────── 2. Preview reads ─────────────────────────

export async function listImportBatches(ctx: AuthContext) {
  requirePermission(ctx, "student.import");
  return db.importBatch.findMany({ where: { schoolId: ctx.schoolId }, orderBy: { createdAt: "desc" }, take: 10 });
}

type Summary = { total: number; valid: number; warning: number; error: number; duplicate: number; imported?: number; skipped?: number };

export async function getImportBatch(ctx: AuthContext, batchId: string) {
  requirePermission(ctx, "student.import");
  const batch = await db.importBatch.findFirst({ where: { id: batchId, schoolId: ctx.schoolId } });
  if (!batch) throw notFound("Import");
  const [problems, sample] = await Promise.all([
    db.importRow.findMany({ where: { batchId, schoolId: ctx.schoolId, status: { notIn: ["VALID", "IMPORTED"] } }, orderBy: { rowNumber: "asc" }, take: 200 }),
    db.importRow.findMany({ where: { batchId, schoolId: ctx.schoolId, status: { in: ["VALID", "IMPORTED"] } }, orderBy: { rowNumber: "asc" }, take: 15 }),
  ]);
  const toView = (r: (typeof problems)[number]) => ({ id: r.id, rowNumber: r.rowNumber, status: r.status, messages: r.messages as unknown as Msg[], cells: (r.raw as unknown as Stored).cells, studentId: r.studentId });
  return {
    id: batch.id,
    fileName: batch.fileName,
    status: batch.status,
    createdAt: batch.createdAt,
    confirmedAt: batch.confirmedAt,
    summary: batch.summary as unknown as Summary,
    columns: ((batch.headerMap as unknown as { columns: { header: string; field: string | null }[] }).columns),
    problems: problems.map(toView),
    sample: sample.map(toView),
  };
}

/** CSV of every row that was not importable, with the reason and the original values, in the user's language. */
export async function importErrorReport(ctx: AuthContext, batchId: string): Promise<{ fileName: string; csv: string }> {
  requirePermission(ctx, "student.import");
  const batch = await db.importBatch.findFirst({ where: { id: batchId, schoolId: ctx.schoolId } });
  if (!batch) throw notFound("Import");
  const t = makeT(ctx.locale);
  const headers = (batch.headerMap as unknown as { headers: string[] }).headers;
  const rows = await db.importRow.findMany({ where: { batchId, schoolId: ctx.schoolId, status: { notIn: ["VALID", "IMPORTED"] } }, orderBy: { rowNumber: "asc" } });
  const out: string[][] = [[t("imp.report.row"), t("common.status"), t("imp.report.problem"), ...headers]];
  for (const r of rows) {
    const msgs = (r.messages as unknown as Msg[]).map((m) => describeMessage(t, m)).join("; ");
    out.push([String(r.rowNumber), t(`imp.status.${r.status}`), msgs, ...(r.raw as unknown as Stored).cells]);
  }
  await writeAudit(db, actorOf(ctx), { action: "student.import_report_download", entityType: "ImportBatch", entityId: batchId, summary: batch.fileName });
  return { fileName: `import-report-${batch.fileName.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40)}.csv`, csv: toCsv(out, { bom: true }) };
}

/** Header-only template: no sample or fake student rows, so nothing can be imported by accident. */
export function importTemplateCsv(): string {
  return toCsv([[...TEMPLATE_HEADERS]], { bom: true });
}

export async function cancelImport(ctx: AuthContext, batchId: string) {
  requirePermission(ctx, "student.import");
  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM import_batches WHERE id = ${batchId}::uuid AND "schoolId" = ${ctx.schoolId}::uuid FOR UPDATE`;
    if (!rows.length) throw notFound("Import");
    const batch = await tx.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (batch.status !== "PREVIEW") throw conflict("Only an import that has not been confirmed can be cancelled.");
    await tx.importBatch.update({ where: { id: batchId }, data: { status: "CANCELLED" } });
    await writeAudit(tx, actorOf(ctx), { action: "student.import_cancel", entityType: "ImportBatch", entityId: batchId, summary: batch.fileName });
  });
}

// ───────────────────────── 3. Confirm → import ─────────────────────────

async function reserveNumbers(tx: Tx, schoolId: string, scope: string, count: number): Promise<number[]> {
  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO admission_counters ("schoolId", "scope", "lastValue")
    VALUES (${schoolId}::uuid, ${scope}, ${count})
    ON CONFLICT ("schoolId", "scope") DO UPDATE SET "lastValue" = admission_counters."lastValue" + ${count}
    RETURNING "lastValue"`;
  const last = rows[0]!.lastValue;
  return Array.from({ length: count }, (_, i) => last - count + 1 + i);
}

export async function confirmImport(ctx: AuthContext, batchId: string, opts: { includeWarnings?: boolean } = {}) {
  requireImportPermissions(ctx);
  return db.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM import_batches WHERE id = ${batchId}::uuid AND "schoolId" = ${ctx.schoolId}::uuid FOR UPDATE`;
      if (!locked.length) throw notFound("Import");
      const batch = await tx.importBatch.findUniqueOrThrow({ where: { id: batchId } });
      if (batch.status !== "PREVIEW") throw conflict(batch.status === "IMPORTED" ? "This import has already been completed." : "This import can no longer be confirmed.");

      const rows = await tx.importRow.findMany({ where: { batchId, schoolId: ctx.schoolId }, orderBy: { rowNumber: "asc" } });
      const wanted = rows.filter((r) => r.status === "VALID" || (opts.includeWarnings && r.status === "WARNING"));
      if (!wanted.length) throw invalid("There are no rows to import. Fix the file and upload it again.");

      // Re-check against the database as it is NOW (someone may have registered students since the preview).
      const settings = await getAdmissionSettings(tx, ctx.schoolId);
      const today = await schoolToday(tx, ctx.schoolId);
      const [students, classes, year] = await Promise.all([
        tx.student.findMany({ where: { schoolId: ctx.schoolId }, select: { firstName: true, lastName: true, dateOfBirth: true, admissionNo: true, birthCertificateNo: true } }),
        tx.schoolClass.findMany({ where: { schoolId: ctx.schoolId, isActive: true }, select: { id: true, streams: { select: { id: true } } } }),
        tx.academicYear.findFirst({ where: { schoolId: ctx.schoolId, isCurrent: true } }),
      ]);
      const keys = new Set(students.map((s) => keyOf({ firstName: s.firstName, lastName: s.lastName, dateOfBirth: formatDateOnly(s.dateOfBirth) })));
      const taken = new Set(students.map((s) => s.admissionNo.toLowerCase()));
      const certs = new Set(students.flatMap((s) => (s.birthCertificateNo ? [s.birthCertificateNo.toLowerCase()] : [])));
      const classOk = new Map(classes.map((c) => [c.id, new Set(c.streams.map((s) => s.id))]));

      type Item = { row: (typeof rows)[number]; p: ParsedRow };
      const items: Item[] = [];
      const skipped: { id: string; messages: Msg[] }[] = [];
      for (const row of wanted) {
        const p = (row.raw as unknown as Stored).parsed;
        const prior = row.messages as unknown as Msg[];
        const skip = (code: string) => skipped.push({ id: row.id, messages: [...prior, { code }] });
        if (!p) {
          skip("CHANGED_SINCE_PREVIEW");
          continue;
        }
        const key = keyOf(p);
        if (keys.has(key)) skip("CHANGED_SINCE_PREVIEW");
        else if (p.admissionNo && taken.has(p.admissionNo.toLowerCase())) skip("CHANGED_SINCE_PREVIEW");
        else if (p.birthCertificateNo && certs.has(p.birthCertificateNo.toLowerCase())) skip("CHANGED_SINCE_PREVIEW");
        else if (p.classId && (!classOk.has(p.classId) || (p.streamId && !classOk.get(p.classId)!.has(p.streamId)))) skip("CLASS_UNAVAILABLE");
        else {
          keys.add(key);
          if (p.admissionNo) taken.add(p.admissionNo.toLowerCase());
          if (p.birthCertificateNo) certs.add(p.birthCertificateNo.toLowerCase());
          items.push({ row, p });
        }
      }
      if (items.some((i) => i.p.classId)) {
        requirePermission(ctx, "student.enroll");
        if (!year) throw invalid("Set a current academic year before importing students into classes.");
      }
      if (!items.length) throw invalid("Nothing could be imported: every row changed since the preview. Upload the file again.");

      // Admission numbers: provided ones are kept; the rest come from the counter in blocks (never reused).
      const admissionOf = new Map<string, string>(); // row id → number
      for (const it of items) if (it.p.admissionNo) admissionOf.set(it.row.id, it.p.admissionNo);
      const needing = items.filter((i) => !i.p.admissionNo);
      const byScope = new Map<string, { year: number; items: Item[] }>();
      for (const it of needing) {
        const y = (it.p.admissionDate ? parseDateOnly(it.p.admissionDate)! : today).getUTCFullYear();
        const scope = settings.resetYearly ? String(y) : "ALL";
        const g = byScope.get(scope) ?? { year: y, items: [] };
        g.items.push(it);
        byScope.set(scope, g);
      }
      for (const [scope, group] of byScope) {
        let queue = group.items.slice();
        for (let guard = 0; queue.length && guard < 50; guard++) {
          const seqs = await reserveNumbers(tx, ctx.schoolId, scope, queue.length);
          const retry: Item[] = [];
          for (const [i, it] of queue.entries()) {
            const no = formatAdmissionNo(settings, group.year, seqs[i]!);
            if (taken.has(no.toLowerCase())) retry.push(it); // collides with a legacy/manual number: use the next one
            else {
              taken.add(no.toLowerCase());
              admissionOf.set(it.row.id, no);
            }
          }
          queue = retry;
        }
        if (queue.length) throw conflict("Could not allocate admission numbers. Please check the admission number settings.");
      }

      // Guardians: identical (phone + name) inside this file are ONE guardian (siblings). Existing guardians are never reused.
      const guardianRows = new Map<string, { fullName: string; phone: string; email?: string }>();
      for (const it of items) for (const g of it.p.guardians) if (!guardianRows.has(guardianKey(g))) guardianRows.set(guardianKey(g), { fullName: g.fullName, phone: g.phone, email: g.email });
      const createdGuardians = await tx.guardian.createManyAndReturn({
        data: [...guardianRows.values()].map((g) => ({ schoolId: ctx.schoolId, fullName: g.fullName, phone: g.phone, email: g.email })),
        select: { id: true, fullName: true, phone: true },
      });
      const guardianIdByKey = new Map(createdGuardians.map((g) => [guardianKey(g), g.id]));

      const createdStudents = await tx.student.createManyAndReturn({
        data: items.map(({ row, p }) => ({
          schoolId: ctx.schoolId,
          admissionNo: admissionOf.get(row.id)!,
          firstName: p.firstName,
          middleName: p.middleName,
          lastName: p.lastName,
          dateOfBirth: parseDateOnly(p.dateOfBirth)!,
          gender: p.gender,
          admissionDate: p.admissionDate ? parseDateOnly(p.admissionDate)! : today,
          nationality: p.nationality,
          religion: p.religion,
          birthCertificateNo: p.birthCertificateNo,
          previousSchool: p.previousSchool,
          address: p.address,
          createdById: ctx.userId,
        })),
        select: { id: true, admissionNo: true },
      });
      const studentIdByNo = new Map(createdStudents.map((s) => [s.admissionNo, s.id]));
      const studentIdOf = (it: Item) => studentIdByNo.get(admissionOf.get(it.row.id)!)!;

      await tx.studentGuardian.createMany({
        data: items.flatMap((it) =>
          it.p.guardians.map((g, i) => ({
            studentId: studentIdOf(it),
            guardianId: guardianIdByKey.get(guardianKey(g))!,
            schoolId: ctx.schoolId,
            relationship: g.relationship as "GUARDIAN",
            isPrimary: i === 0,
            receivesNotifications: true,
          })),
        ),
      });
      const placed = items.filter((i) => i.p.classId);
      if (placed.length && year) {
        await tx.studentEnrollment.createMany({
          data: placed.map((it) => {
            const admitted = it.p.admissionDate ? parseDateOnly(it.p.admissionDate)! : today;
            return { schoolId: ctx.schoolId, studentId: studentIdOf(it), academicYearId: year.id, classId: it.p.classId!, streamId: it.p.streamId, startedOn: admitted < year.startsOn ? year.startsOn : admitted, createdById: ctx.userId };
          }),
        });
      }

      const actor = actorOf(ctx);
      await tx.auditLog.createMany({
        data: items.map((it) => ({
          schoolId: ctx.schoolId,
          actorId: actor.actorId,
          actorName: actor.actorName,
          action: "student.create",
          entityType: "Student",
          entityId: studentIdOf(it),
          summary: `${it.p.firstName} ${it.p.lastName} (${admissionOf.get(it.row.id)})`,
          changes: { admissionNo: admissionOf.get(it.row.id), source: "import", batchId, classId: it.p.classId ?? null, guardianCount: it.p.guardians.length } as Prisma.InputJsonValue,
          ip: actor.meta.ip,
          userAgent: actor.meta.userAgent?.slice(0, 300),
        })),
      });

      const importedIds = items.map((i) => i.row.id);
      const importedStudentIds = items.map((i) => studentIdOf(i));
      await tx.$executeRaw`UPDATE import_rows SET status = 'IMPORTED', "studentId" = u.sid FROM unnest(${importedIds}::uuid[], ${importedStudentIds}::uuid[]) AS u(id, sid) WHERE import_rows.id = u.id`;
      for (const s of skipped) await tx.importRow.update({ where: { id: s.id }, data: { status: "SKIPPED", messages: s.messages as unknown as Prisma.InputJsonValue } });
      // Rows left out on purpose (warnings not confirmed) are marked skipped too, so the summary adds up.
      await tx.importRow.updateMany({ where: { batchId, status: "WARNING" }, data: { status: "SKIPPED" } });

      const base = batch.summary as unknown as Summary;
      const summary: Summary = { ...base, imported: items.length, skipped: base.warning - (opts.includeWarnings ? base.warning : 0) + skipped.length };
      await tx.importBatch.update({ where: { id: batchId }, data: { status: "IMPORTED", confirmedAt: new Date(), summary } });
      await writeAudit(tx, actorOf(ctx), { action: "student.import", entityType: "ImportBatch", entityId: batchId, summary: `${batch.fileName}: ${items.length} students`, changes: { ...summary, includeWarnings: Boolean(opts.includeWarnings) } });
      return { imported: items.length, skipped: summary.skipped ?? 0, errors: base.error, duplicates: base.duplicate };
    },
    { timeout: 120000, maxWait: 15000 },
  );
}
