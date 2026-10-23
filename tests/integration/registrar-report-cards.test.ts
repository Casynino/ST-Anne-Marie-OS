import { beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import { generateReportCards, publishReportCards } from "@/server/report-cards";
import { createCurrentYearAcademics, createTestSchool, createTestUser } from "../helpers";

/* The Registrar may generate report cards (Nino, 2026-10-23) but not publish them; a class whose results are not locked still cannot be generated. */

let registrar: AuthContext, teacher: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let termId: string;
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;

beforeAll(async () => {
  const school = await createTestSchool();
  const admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: ["A"] });
  termId = setup.term.id;
});

describe("the registrar and report cards", () => {
  it("is allowed to generate (refused only because the results are not locked), and is not allowed to publish", async () => {
    expect(registrar.permissions.has("reportcard.generate")).toBe(true);
    expect(registrar.permissions.has("reportcard.publish")).toBe(false);
    expect(await code(generateReportCards(registrar, { termId, classId: setup.cls.id }))).not.toBe("FORBIDDEN");
    expect(await code(publishReportCards(registrar, { termId, classId: setup.cls.id }))).toBe("FORBIDDEN");
  });
  it("a teacher still cannot generate", async () => {
    expect(await code(generateReportCards(teacher, { termId, classId: setup.cls.id }))).toBe("FORBIDDEN");
  });
});
