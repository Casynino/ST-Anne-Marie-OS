import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import * as academics from "@/server/academics";
import * as students from "@/server/students";
import * as att from "@/server/attendance";
import type { AuthContext } from "@/lib/auth/context";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

let current: AuthContext | null = null;
vi.mock("@/lib/auth/next", () => ({ getContext: async () => current }));

const { POST } = await import("@/app/api/attendance/sync/route");
const { GET: GET_ROSTER } = await import("@/app/api/attendance/roster/route");

let teacher: AuthContext, outsider: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let sessionId: string;
let kids: string[] = [];

const call = (body: unknown, headers: Record<string, string> = { origin: "http://localhost:3000", host: "localhost:3000" }) =>
  POST(new Request("http://localhost:3000/api/attendance/sync", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
const op = (extra: Record<string, unknown> = {}) => ({
  clientOpId: randomUUID(),
  kind: "SAVE_DRAFT",
  classId: setup.cls.id,
  sessionId,
  date: setup.today,
  entries: kids.map((studentId) => ({ studentId, status: "PRESENT" })),
  ...extra,
});

beforeAll(async () => {
  const school = await createTestSchool();
  const admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  const registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
  outsider = (await createTestUser(school.id, ["class_teacher"])).ctx;
  setup = await createCurrentYearAcademics(admin);
  await academics.setClassTeacher(admin, { academicYearId: setup.year.id, classId: setup.cls.id, staffId: teacher.staffId });
  sessionId = (await att.getUsableSessions(db, school.id))[0]!.id;
  for (let i = 0; i < 3; i++) kids.push((await students.createStudent(registrar, studentInput(9100 + i, { classId: setup.cls.id }))).id);
});

beforeEach(() => {
  current = teacher;
});

describe("POST /api/attendance/sync", () => {
  it("rejects cross-site requests and unauthenticated callers", async () => {
    expect((await call({ ops: [op()] }, { host: "localhost:3000" })).status).toBe(403); // no Origin
    expect((await call({ ops: [op()] }, { origin: "https://evil.example", host: "localhost:3000" })).status).toBe(403);
    current = null;
    expect((await call({ ops: [op()] })).status).toBe(401);
    current = teacher;
    expect((await call({ nonsense: true })).status).toBe(400);
  });

  it("applies each operation once, answers replays, reports conflicts and rejections per operation", async () => {
    const first = op({ kind: "SAVE_DRAFT" });
    const body = await (await call({ deviceId: "dev-1", ops: [first, first] })).json();
    expect(body.results.map((r: { outcome: string; replay: boolean }) => [r.outcome, r.replay])).toEqual([["APPLIED", false], ["APPLIED", true]]);
    // The same operation re-sent later (lost response) is a harmless replay.
    const again = await (await call({ ops: [first] })).json();
    expect(again.results[0]).toMatchObject({ opId: first.clientOpId, outcome: "APPLIED", replay: true });
    expect(await db.studentAttendance.count({ where: { schoolId: teacher.schoolId } })).toBe(3);

    const fin = op({ kind: "FINALISE" });
    const mixed = await (
      await call({
        ops: [
          fin,
          op({ kind: "FINALISE", entries: [{ studentId: kids[0], status: "ABSENT" }] }), // conflicts with the now-finalised register
          op({ entries: [{ studentId: randomUUID(), status: "PRESENT" }] }), // not on the class list
          { garbage: true }, // malformed, must not break the others
        ],
      })
    ).json();
    expect(mixed.results.map((r: { outcome: string }) => r.outcome)).toEqual(["APPLIED", "CONFLICT", "REJECTED", "REJECTED"]);
    expect(mixed.results[1].code).toBe("ALREADY_FINALISED");
    expect(mixed.results[2].reason).toBe("ROSTER_CHANGED");
    expect((await db.studentAttendance.findMany({ where: { schoolId: teacher.schoolId, studentId: kids[0] } }))[0]!.status).toBe("PRESENT");
  });

  it("does not let a teacher sync attendance for a class they are not assigned to", async () => {
    current = outsider;
    const body = await (await call({ ops: [op({ clientOpId: randomUUID() })] })).json();
    expect(body.results[0]).toMatchObject({ outcome: "REJECTED", code: "FORBIDDEN" });
  });
});

describe("GET /api/attendance/roster", () => {
  it("returns only the class lists the signed-in user may take, and refuses future dates", async () => {
    const res = await GET_ROSTER(new Request("http://localhost:3000/api/attendance/roster"));
    const data = await res.json();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(data.sheets).toHaveLength(1);
    expect(data.sheets[0].students).toHaveLength(3);
    expect(data.userId).toBe(teacher.userId);
    current = outsider;
    expect((await (await GET_ROSTER(new Request("http://localhost:3000/api/attendance/roster"))).json()).sheets).toHaveLength(0);
    current = teacher;
    expect((await GET_ROSTER(new Request("http://localhost:3000/api/attendance/roster?date=2999-01-01"))).status).toBe(422);
    current = null;
    expect((await GET_ROSTER(new Request("http://localhost:3000/api/attendance/roster"))).status).toBe(401);
  });
});
