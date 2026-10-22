import { db } from "@/lib/db";
import { requireAnyPermission, type AuthContext } from "@/lib/auth/context";
import { studentScope } from "@/server/students";

/*
 * Students arranged by class: one card per class of the current academic year with how many students it has, how full it is, its streams and who
 * teaches it. Everything is counted from the real enrolments inside the person's own scope (a teacher only sees the classes they teach), so a card
 * and the roster it opens always agree.
 */

export type ClassCard = {
  id: string; name: string; level: string; capacity: number | null; count: number; girls: number; boys: number;
  streams: { id: string; name: string; count: number; teachers: string[] }[]; teachers: string[];
};

export async function classOverview(ctx: AuthContext) {
  requireAnyPermission(ctx, ["student.read", "student.read_assigned"]);
  const scope = await studentScope(ctx);
  const year = await db.academicYear.findFirst({ where: { schoolId: ctx.schoolId, isCurrent: true }, select: { id: true, name: true } });
  if (!year) return { year: null, cards: [] as ClassCard[], noClass: 0, enrolled: 0, former: { TRANSFERRED: 0, WITHDRAWN: 0, GRADUATED: 0 } };

  const [classes, enrols, teachers, noClass, enrolled, formerRows] = await Promise.all([
    db.schoolClass.findMany({ where: { schoolId: ctx.schoolId, isActive: true }, orderBy: [{ level: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }], include: { level: { select: { name: true } }, streams: { orderBy: { name: "asc" }, select: { id: true, name: true } } } }),
    db.studentEnrollment.findMany({ where: { schoolId: ctx.schoolId, academicYearId: year.id, status: "ACTIVE", student: { AND: [scope, { status: "ENROLLED" }] } }, select: { classId: true, streamId: true, student: { select: { gender: true } } } }),
    db.classTeacher.findMany({ where: { schoolId: ctx.schoolId, academicYearId: year.id }, select: { classId: true, streamId: true, staff: { select: { user: { select: { fullName: true } } } } } }),
    db.student.count({ where: { AND: [scope, { status: "ENROLLED" }, { enrollments: { none: { status: "ACTIVE", academicYearId: year.id } } }] } }),
    db.student.count({ where: { AND: [scope, { status: "ENROLLED" }] } }),
    db.student.groupBy({ by: ["status"], where: { AND: [scope, { status: { not: "ENROLLED" } }] }, _count: { _all: true } }),
  ]);
  const seesAll = ctx.permissions.has("student.read");
  const cards: ClassCard[] = [];
  for (const c of classes) {
    const mine = enrols.filter((e) => e.classId === c.id);
    if (!seesAll && mine.length === 0) continue; // a teacher sees only the classes they teach
    const names = (streamId: string | null) => [...new Set(teachers.filter((x) => x.classId === c.id && (streamId === null ? true : x.streamId === streamId)).map((x) => x.staff.user.fullName))];
    cards.push({
      id: c.id, name: c.name, level: c.level.name, capacity: c.capacity, count: mine.length,
      girls: mine.filter((e) => e.student.gender === "FEMALE").length, boys: mine.filter((e) => e.student.gender === "MALE").length,
      streams: c.streams.map((s) => ({ id: s.id, name: s.name, count: mine.filter((e) => e.streamId === s.id).length, teachers: names(s.id).filter((n) => teachers.some((x) => x.classId === c.id && x.streamId === s.id && x.staff.user.fullName === n)) })),
      teachers: names(null),
    });
  }
  const former = { TRANSFERRED: 0, WITHDRAWN: 0, GRADUATED: 0 };
  for (const r of formerRows) former[r.status as keyof typeof former] = r._count._all;
  return { year, cards, noClass, enrolled, former };
}
