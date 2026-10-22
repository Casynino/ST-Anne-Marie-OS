import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, conflict, invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { enrolApplication } from "@/server/admissions";
import { classPlaces } from "@/server/annual-registration";
import { checkbox, optText, parse, uuid } from "@/lib/validation";

/*
 * Registering new students: one or many at once. Registering makes the student record, the permanent Student ID and the class together (the
 * class is never left for later). Several applicants can be put in the same class in one go; the stream can be chosen or left to "any stream",
 * which gives each student the stream with the most room at that moment. Nothing is skipped silently: when the class cannot take everybody the
 * whole request is refused with the classes that do have room, and any single refusal (duplicate, papers, class full) is reported by name.
 */

export type RegisterResult = { id: string; name: string; ok: boolean; message: string; admissionNo?: string; placedIn?: string };

const schema = z.object({
  ids: z.array(uuid()).min(1).max(100),
  classId: uuid(),
  /** A stream id, "*" for any stream (the emptiest each time), or empty for a class without streams. */
  streamId: z.string().max(40).optional(),
  overrideCapacity: checkbox().default(false),
  overrideReason: optText(300),
});

export async function registerMany(ctx: AuthContext, input: unknown): Promise<RegisterResult[]> {
  requirePermission(ctx, "admission.enrol");
  requirePermission(ctx, "student.enroll");
  const d = parse(schema, input);
  const ids = [...new Set(d.ids)];
  const year = await db.academicYear.findFirst({ where: { schoolId: ctx.schoolId, isCurrent: true }, select: { id: true } });
  if (!year) throw invalid("Set a current academic year before registering students.", { classId: "No academic year available" });
  const cls = await db.schoolClass.findFirst({ where: { id: d.classId, schoolId: ctx.schoolId, isActive: true }, include: { streams: { orderBy: { name: "asc" } } } });
  if (!cls) throw notFound("Class");
  const streamChoice = d.streamId && d.streamId !== "*" ? d.streamId : null;
  if (cls.streams.length > 0 && !d.streamId) throw invalid("Choose a stream, or \"any stream\".", { placement: "Choose a stream" });
  if (streamChoice && !cls.streams.some((s) => s.id === streamChoice)) throw invalid("That stream does not belong to the selected class.", { placement: "Invalid stream" });

  const places = await classPlaces(db, ctx.schoolId, year.id);
  const mine = places.get(cls.id)!;
  if (mine.left !== null && mine.left < ids.length && !d.overrideCapacity) {
    const rooms = [...places.values()].filter((p) => p.classId !== cls.id && (p.left === null || p.left >= ids.length)).slice(0, 5).map((p) => (p.left === null ? p.name : `${p.name} (${p.left} left)`));
    throw conflict(`${cls.name} has ${mine.left} place${mine.left === 1 ? "" : "s"} left but ${ids.length} were chosen. Choose another class or tick fewer. ${rooms.length ? `Classes with room: ${rooms.join(", ")}.` : "No other class has room for them all."}`);
  }

  const apps = await db.application.findMany({ where: { id: { in: ids }, schoolId: ctx.schoolId }, select: { id: true, firstName: true, middleName: true, lastName: true } });
  const nameOf = (id: string) => { const a = apps.find((x) => x.id === id); return a ? [a.firstName, a.middleName, a.lastName].filter(Boolean).join(" ") : ""; };
  const counts = new Map(mine.streams.map((s) => [s.id, s.count]));
  const out: RegisterResult[] = [];
  for (const id of ids) {
    let streamId: string | undefined = streamChoice ?? undefined;
    if (d.streamId === "*") streamId = [...counts.entries()].sort((a, b) => a[1] - b[1])[0]?.[0];
    try {
      const student = await enrolApplication(ctx, id, { classId: cls.id, streamId, overrideCapacity: d.overrideCapacity ? "on" : "", overrideReason: d.overrideReason });
      if (streamId) counts.set(streamId, (counts.get(streamId) ?? 0) + 1);
      const streamName = streamId ? cls.streams.find((s) => s.id === streamId)?.name : null;
      out.push({ id, name: nameOf(id), ok: true, message: "Registered.", admissionNo: student.admissionNo, placedIn: `${cls.name}${streamName ? ` – ${streamName}` : ""}` });
    } catch (e) {
      if (e instanceof AppError) out.push({ id, name: nameOf(id), ok: false, message: e.message });
      else throw e;
    }
  }
  return out;
}

export type ClassRoom = { classId: string; name: string; capacity: number | null; taken: number; left: number | null; full: boolean; streams: { name: string; count: number }[]; waiting: number };

/** Every active class with how many students it has this year, how many places are left, and how many cleared applicants asked for it. */
export async function classRoom(ctx: AuthContext, askedFor: readonly (string | null)[]): Promise<ClassRoom[]> {
  requirePermission(ctx, "admission.read");
  const year = await db.academicYear.findFirst({ where: { schoolId: ctx.schoolId, isCurrent: true }, select: { id: true } });
  if (!year) return [];
  const [places, classes] = await Promise.all([classPlaces(db, ctx.schoolId, year.id), db.schoolClass.findMany({ where: { schoolId: ctx.schoolId, isActive: true }, orderBy: [{ level: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }], select: { id: true } })]);
  const rows: ClassRoom[] = [];
  for (const c of classes) {
    const p = places.get(c.id);
    if (!p) continue;
    rows.push({ classId: c.id, name: p.name, capacity: p.capacity, taken: p.inClass + p.reserved, left: p.left, full: p.left === 0, streams: p.streams.map((s) => ({ name: s.name, count: s.count })), waiting: askedFor.filter((x) => x === c.id).length });
  }
  // The classes people asked for come first; then classes that still have room; the rest in school order.
  return rows.sort((a, b) => Number(b.waiting > 0) - Number(a.waiting > 0) || Number(a.full) - Number(b.full));
}
