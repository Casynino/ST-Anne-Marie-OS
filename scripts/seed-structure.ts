/**
 * THE SCHOOL'S STRUCTURE, for a school that has none yet (Nino's instruction, 2026-11-16: "make sure the data are live and we have some classes").
 * Loads ONLY structure and the public text the school already has on its own posters:
 *   - the current academic year and its two terms (Term 1: Jan-Jun, Term 2: Jul-Dec),
 *   - the four levels (Nursery, Primary, O-Level, A-Level) and their 16 classes, in the school's order,
 *   - the 11 subjects and which subjects each class studies,
 *   - the national O-Level grading scale (A 75-100, B 65-74, C 45-64, D 30-44, F 0-29) as the default,
 *   - the public website text (headline, "about" story, strengths, phones, address, motto) and the two admission notices from the posters.
 * NO students, parents, staff, fees, payments, invoices, applications or demo data. Every record goes through the same services the screens use
 * (permissions, validation, audit trail). Safe to run again: anything already there is skipped.
 *
 * Guard: runs against a local database named stanne_empty|stanne_smoke, or against the live Neon database only when STRUCTURE_FOR_LIVE=yes.
 * Run (live):  DATABASE_URL="$NEON_DIRECT_URL" STRUCTURE_FOR_LIVE=yes npx tsx scripts/seed-structure.ts
 */
import fs from "node:fs";
import { db } from "../src/lib/db";
import { buildAuthContext } from "../src/lib/auth/context";
import { todayInTimezone } from "../src/lib/dates";
import * as academics from "../src/server/academics";
import * as grading from "../src/server/grading";
import * as website from "../src/server/website";

function guard() {
  const raw = process.env.DATABASE_URL ?? "";
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("DATABASE_URL is not set."); }
  const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname);
  const name = u.pathname.replace(/^\//, "");
  if (local && /^stanne_(empty|smoke)$/.test(name)) return "local";
  if (/\.neon\.tech$/.test(u.hostname) && process.env.STRUCTURE_FOR_LIVE === "yes") return "live";
  throw new Error("Refusing to run: use a local stanne_empty/stanne_smoke database, or set STRUCTURE_FOR_LIVE=yes for the live database.");
}
const log = (...a: unknown[]) => console.log("•", ...a);

async function main() {
  const where = guard();
  const school = await db.school.findUniqueOrThrow({ where: { code: "SAM" } });
  const schoolId = school.id;
  const adminUser = await db.user.findFirstOrThrow({ where: { schoolId, roles: { some: { role: { key: "super_admin" } } } }, orderBy: { createdAt: "asc" } });
  const admin = await buildAuthContext(adminUser.id);
  const today = todayInTimezone(school.timezone);
  const yearNo = Number(today.slice(0, 4));
  log("target:", where, "| school:", school.name, "| first user is the Super Admin");

  // 1. academic year and terms
  let year = await db.academicYear.findFirst({ where: { schoolId, name: String(yearNo) } });
  if (!year) { year = await academics.createAcademicYear(admin, { name: String(yearNo), startsOn: `${yearNo}-01-01`, endsOn: `${yearNo}-12-31` }); log("academic year", yearNo); }
  await academics.setCurrentAcademicYear(admin, year.id);
  let term1 = await db.term.findFirst({ where: { schoolId, academicYearId: year.id, sequence: 1 } });
  let term2 = await db.term.findFirst({ where: { schoolId, academicYearId: year.id, sequence: 2 } });
  term1 ??= await academics.createTerm(admin, { academicYearId: year.id, name: "Term 1", sequence: 1, startsOn: `${yearNo}-01-05`, endsOn: `${yearNo}-06-26` });
  term2 ??= await academics.createTerm(admin, { academicYearId: year.id, name: "Term 2", sequence: 2, startsOn: `${yearNo}-07-13`, endsOn: `${yearNo}-12-18` });
  await academics.setCurrentTerm(admin, today <= `${yearNo}-06-26` ? term1.id : term2.id);

  // 2. levels and classes, in the school's order
  const LEVELS: [string, number, string[]][] = [
    ["Nursery", 1, ["Baby Class", "Middle Class", "Pre-Unit"]],
    ["Primary", 2, ["Standard I", "Standard II", "Standard III", "Standard IV", "Standard V", "Standard VI", "Standard VII"]],
    ["O-Level", 3, ["Form I", "Form II", "Form III", "Form IV"]],
    ["A-Level", 4, ["Form V", "Form VI"]],
  ];
  for (const [name, sortOrder, classes] of LEVELS) {
    const level = (await db.academicLevel.findFirst({ where: { schoolId, name } })) ?? (await academics.createLevel(admin, { name, sortOrder }));
    const have = new Set((await db.schoolClass.findMany({ where: { schoolId, name: { in: classes } }, select: { name: true } })).map((c) => c.name));
    const missing = classes.filter((c) => !have.has(c));
    if (missing.length) { await academics.createClassesBulk(admin, level.id, missing); log(name, "classes", missing.join(", ")); }
  }

  // 3. subjects and what each class studies
  const SUBJECTS: Record<string, string> = { MATH: "Mathematics", ENG: "English", KISW: "Kiswahili", SCI: "Science", SST: "Social Studies", CIV: "Civics", PHY: "Physics", CHEM: "Chemistry", BIO: "Biology", GEO: "Geography", HIST: "History" };
  for (const [code, name] of Object.entries(SUBJECTS)) if (!(await db.subject.findFirst({ where: { schoolId, code } }))) { await academics.createSubject(admin, { code, name }); log("subject", name); }
  const subjectId = async (code: string) => (await db.subject.findFirstOrThrow({ where: { schoolId, code } })).id;
  const SET: Record<string, string[]> = {
    "Baby Class": ["ENG", "KISW", "MATH"], "Middle Class": ["ENG", "KISW", "MATH"], "Pre-Unit": ["ENG", "KISW", "MATH"],
    ...Object.fromEntries(["Standard I", "Standard II", "Standard III", "Standard IV", "Standard V", "Standard VI", "Standard VII"].map((n) => [n, ["MATH", "ENG", "KISW", "SCI", "SST", "CIV"]])),
    ...Object.fromEntries(["Form I", "Form II", "Form III", "Form IV"].map((n) => [n, ["MATH", "ENG", "KISW", "PHY", "CHEM", "BIO", "GEO", "HIST", "CIV"]])),
  };
  for (const [name, codes] of Object.entries(SET)) {
    const c = await db.schoolClass.findFirstOrThrow({ where: { schoolId, name } });
    if ((await academics.getClassSubjectIds(admin, c.id)).length) continue;
    await academics.setClassSubjects(admin, c.id, await Promise.all(codes.map(subjectId)));
  }

  // 4. grading scale (the national O-Level bands)
  if (!(await grading.listScales(admin)).length) {
    await grading.createScale(admin, { name: "Standard scale", bands: "A | 75 | 100 | 1\nB | 65 | 74 | 2\nC | 45 | 64 | 3\nD | 30 | 44 | 4\nF | 0 | 29 | 5", isDefault: "on" });
    log("grading scale");
  }

  // 5. public website text, from the school's own posters (the school can edit all of it under Website settings)
  const content = JSON.parse(fs.readFileSync(new URL("./data/website-setting.json", import.meta.url), "utf8")) as { en: Record<string, string>; sw: Record<string, string>; phone: string; phone2: string; address: string; instagram: string; applicationsOpen: boolean };
  const cur = await website.getWebsiteSettings(admin);
  if (!cur.en.heroTitle && !cur.en.about) {
    const flat: Record<string, unknown> = { applicationsOpen: content.applicationsOpen ? "on" : "", phone: content.phone, phone2: content.phone2, address: content.address, instagram: content.instagram };
    for (const lang of ["en", "sw"] as const) for (const [k, v] of Object.entries(content[lang] ?? {})) flat[`${lang}_${k}`] = v;
    await website.updateWebsiteSettings(admin, flat);
    log("website text");
  }

  // 6. the two admission notices from the school's posters (the fee amounts printed on the poster are left out on purpose)
  const notices = fs.readFileSync(new URL("./data/poster-notices.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  for (const n of notices) {
    if (await db.announcement.findFirst({ where: { schoolId, title: String(n.title) } })) continue;
    const body = String(n.body).split("\n\n").filter((p) => !/^Fees listed on the school's poster/i.test(p)).join("\n\n");
    const row = await website.createNews(admin, { title: n.title, body, category: n.category, excerpt: n.excerpt, coverImage: n.coverImage, isPublic: "on", showInBar: n.showInBar ? "on" : "", barLink: n.barLink ?? "" });
    await website.setNewsPublished(admin, row.id, true);
    log("notice", n.title);
  }

  const counts = { years: await db.academicYear.count({ where: { schoolId } }), terms: await db.term.count({ where: { schoolId } }), levels: await db.academicLevel.count({ where: { schoolId } }), classes: await db.schoolClass.count({ where: { schoolId } }), subjects: await db.subject.count({ where: { schoolId } }), students: await db.student.count({ where: { schoolId } }), notices: await db.announcement.count({ where: { schoolId } }) };
  console.log("DONE", JSON.stringify(counts));
}
main().then(() => db.$disconnect()).catch(async (e) => { console.error("FAILED:", e instanceof Error ? e.message : e); await db.$disconnect(); process.exit(1); });
