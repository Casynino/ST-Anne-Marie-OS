import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildAuthContext, type AuthContext } from "@/lib/auth/context";
import * as academics from "@/server/academics";
import * as students from "@/server/students";
import * as portal from "@/server/portal";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

let admin: AuthContext, registrar: AuthContext, parent: AuthContext, otherParent: AuthContext, staffer: AuthContext;
let childId: string;
let n = 700000 + Math.floor(Math.random() * 5_000_000);

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;

/** A minimal report-card snapshot: only the fields the family progress view reads. */
const snapshot = (termName: string, average: number, subjects: { id: string; name: string; percent: number }[]) => ({
  term: { name: termName, year: "2026" },
  summary: { average, grade: "B", position: 3, classSize: 30 },
  subjects: subjects.map((s) => ({ subjectId: s.id, name: s.name, percent: s.percent, grade: "B", classMean: 60 })),
});

beforeAll(async () => {
  const school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  const setup = await createCurrentYearAcademics(admin, { streams: ["A"] });
  const math = await academics.createSubject(admin, { code: "MATH", name: "Mathematics" });
  const kid = await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: setup.streams[0]!.id }));
  childId = kid.id;
  const g = (await db.studentGuardian.findFirstOrThrow({ where: { studentId: kid.id }, select: { guardianId: true } })).guardianId;
  await portal.createGuardianAccount(registrar, g);
  parent = await buildAuthContext((await db.guardian.findUniqueOrThrow({ where: { id: g } })).userId!);

  const term2 = await academics.createTerm(admin, { academicYearId: setup.year.id, name: "Term 2", sequence: 2, startsOn: `${setup.yearNo}-12-21`, endsOn: `${setup.yearNo}-12-30` }).catch(() => null);
  const base = { schoolId: school.id, studentId: kid.id, classId: setup.cls.id, streamId: setup.streams[0]!.id, status: "PUBLISHED" as const, generatedById: admin.userId, publishedById: admin.userId };
  await db.reportCard.create({ data: { ...base, termId: setup.term.id, snapshot: snapshot("Term 1", 60, [{ id: math.id, name: "Mathematics", percent: 55 }]), publishedAt: new Date("2026-04-01") } });
  if (term2) await db.reportCard.create({ data: { ...base, termId: term2.id, snapshot: snapshot("Term 2", 66.5, [{ id: math.id, name: "Mathematics", percent: 63.5 }]), publishedAt: new Date("2026-08-01") } });
  // A card that is only generated (not released to the family) must never show.
  const hidden = await academics.createTerm(admin, { academicYearId: setup.year.id, name: "Term 3", sequence: 3, startsOn: `${setup.yearNo}-12-31`, endsOn: `${setup.yearNo}-12-31` }).catch(() => null);
  if (hidden) await db.reportCard.create({ data: { ...base, status: "GENERATED", termId: hidden.id, snapshot: snapshot("Term 3", 99, [{ id: math.id, name: "Mathematics", percent: 99 }]), publishedAt: null } });
  staffer = (await createTestUser(school.id, ["registrar"])).ctx;
  const kid2 = await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: setup.streams[0]!.id }));
  const g2 = (await db.studentGuardian.findFirstOrThrow({ where: { studentId: kid2.id }, select: { guardianId: true } })).guardianId;
  await portal.createGuardianAccount(registrar, g2);
  otherParent = await buildAuthContext((await db.guardian.findUniqueOrThrow({ where: { id: g2 } })).userId!);
});

describe("child progress", () => {
  it("shows the average by term and the change in each subject, from published cards only", async () => {
    const p = await portal.childProgress(parent, childId);
    expect(p.trend.map((t) => t.average)).toEqual([60, 66.5]);
    expect(p.latest!.term).toBe("Term 2 · 2026");
    expect(p.latest!.subjects[0]).toMatchObject({ name: "Mathematics", percent: 63.5, change: 8.5 });
    expect(p.averageChange).toBe(6.5);
    expect(JSON.stringify(p)).not.toContain("99");
  });

  it("is refused for anyone who is not the child's family", async () => {
    expect(await code(portal.childProgress(otherParent, childId))).toBe("NOT_FOUND"); // another family's parent
    expect(await code(portal.childProgress(staffer, childId))).toBe("FORBIDDEN"); // staff use the staff screens, not the family portal
  });
});
