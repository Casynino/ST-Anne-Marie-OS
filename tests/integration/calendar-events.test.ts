import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import { createEvent, deleteEvent, updateEvent } from "@/server/website";
import { schoolCalendar } from "@/server/calendar";
import { createTestSchool, createTestUser } from "../helpers";

/* The Admissions Office, Academic Office and Head Teacher add events to the school calendar (calendar.manage); a teacher cannot; staff-only events stay off the public calendar. */

let registrar: AuthContext, academic: AuthContext, teacher: AuthContext, schoolId: string;
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;

beforeAll(async () => {
  const school = await createTestSchool();
  schoolId = school.id;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  academic = (await createTestUser(school.id, ["academic_office"])).ctx;
  teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
});

describe("calendar events", () => {
  it("the registrar adds, changes and removes an event; a teacher cannot", async () => {
    expect(await code(createEvent(teacher, { title: "Teachers' attempt", startsOn: "2031-03-05" }))).toBe("FORBIDDEN");
    const e = await createEvent(registrar, { title: "Open day", startsOn: "2031-03-05", location: "Main hall" });
    expect(e).toMatchObject({ title: "Open day", isPublic: false, createdById: registrar.userId });
    await updateEvent(academic, e.id, { title: "Open day for new parents", startsOn: "2031-03-06", endsOn: "2031-03-07", location: "Main hall", isPublic: "on" });
    const after = await db.schoolEvent.findUniqueOrThrow({ where: { id: e.id } });
    expect(after).toMatchObject({ title: "Open day for new parents", isPublic: true });
    expect(await db.auditLog.count({ where: { entityId: e.id, action: { in: ["event.create", "event.update"] } } })).toBeGreaterThanOrEqual(2);
    await deleteEvent(registrar, e.id);
    expect(await db.schoolEvent.count({ where: { id: e.id } })).toBe(0);
  });

  it("a staff-only event is on the staff calendar but not on the public one", async () => {
    const e = await createEvent(registrar, { title: "Staff briefing", startsOn: "2031-04-01" });
    const from = new Date("2031-04-01T00:00:00Z"), to = new Date("2031-04-30T00:00:00Z");
    expect((await schoolCalendar(schoolId, from, to, { includeInternal: true })).some((i) => i.id === e.id)).toBe(true);
    expect((await schoolCalendar(schoolId, from, to, { includeInternal: false })).some((i) => i.id === e.id)).toBe(false);
  });
});
