import { db } from "@/lib/db";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { listInterviews } from "@/server/interviews";

/*
 * The registrar's home needs two things the school-wide overview does not have: the interviews that are coming up and how many open
 * applications ask for each class. Both are read-only counts of real records; nothing is estimated.
 */

export type RegistrarHome = {
  interviews: { total: number; rows: { id: string; applicationId: string; name: string; className: string | null; at: Date; location: string | null }[] };
  byClass: { name: string; count: number }[];
  recentStudents: { id: string; name: string; admissionNo: string; className: string | null; at: Date }[];
};

export async function registrarHome(ctx: AuthContext): Promise<RegistrarHome> {
  requirePermission(ctx, "admission.read");
  const [upcoming, grouped, recent, year] = await Promise.all([
    listInterviews(ctx, { from: new Date(), status: "SCHEDULED" }),
    db.application.groupBy({ by: ["classAppliedId"], where: { schoolId: ctx.schoolId, status: { in: ["APPLIED", "INTERVIEW", "ACCEPTED"] } }, _count: { _all: true } }),
    db.student.findMany({ where: { schoolId: ctx.schoolId }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, admissionNo: true, firstName: true, middleName: true, lastName: true, createdAt: true } }),
    db.academicYear.findFirst({ where: { schoolId: ctx.schoolId, isCurrent: true }, select: { id: true } }),
  ]);
  const placed = year && recent.length ? await db.studentEnrollment.findMany({ where: { schoolId: ctx.schoolId, academicYearId: year.id, status: "ACTIVE", studentId: { in: recent.map((s) => s.id) } }, select: { studentId: true, class: { select: { name: true } }, stream: { select: { name: true } } } }) : [];
  const classes = await db.schoolClass.findMany({
    where: { schoolId: ctx.schoolId, id: { in: grouped.flatMap((g) => (g.classAppliedId ? [g.classAppliedId] : [])) } },
    select: { id: true, name: true, sortOrder: true, level: { select: { sortOrder: true } } },
  });
  const byClass = classes
    .sort((a, b) => a.level.sortOrder - b.level.sortOrder || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((c) => ({ name: c.name, count: grouped.find((g) => g.classAppliedId === c.id)?._count._all ?? 0 }));
  return {
    interviews: { total: upcoming.length, rows: upcoming.slice(0, 6).map((i) => ({ id: i.id, applicationId: i.applicationId, name: i.applicantName, className: i.className, at: i.scheduledAt, location: i.location })) },
    byClass,
    recentStudents: recent.map((s) => {
      const e = placed.find((p) => p.studentId === s.id);
      return { id: s.id, name: [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" "), admissionNo: s.admissionNo, className: e ? `${e.class.name}${e.stream ? ` ${e.stream.name}` : ""}` : null, at: s.createdAt };
    }),
  };
}
