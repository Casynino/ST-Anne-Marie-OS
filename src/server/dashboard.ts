import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { studentCounts } from "@/server/students";
import { getCurrentAcademicContext } from "@/server/academics";

/** Real counts from the database, limited to what the user is allowed to see. No demo figures. */
export async function getDashboardSummary(ctx: AuthContext) {
  const { year, term } = await getCurrentAcademicContext(ctx.schoolId);
  const canStudents = ctx.permissions.has("student.read") || ctx.permissions.has("student.read_assigned");
  const [students, classes, staff, newThisYear] = await Promise.all([
    canStudents ? studentCounts(ctx) : null,
    ctx.permissions.has("academic.read") ? db.schoolClass.count({ where: { schoolId: ctx.schoolId, isActive: true } }) : null,
    ctx.permissions.has("user.read") ? db.user.count({ where: { schoolId: ctx.schoolId, type: "STAFF", status: "ACTIVE" } }) : null,
    ctx.permissions.has("student.read") && year
      ? db.student.count({ where: { schoolId: ctx.schoolId, admissionDate: { gte: year.startsOn, lte: year.endsOn } } })
      : null,
  ]);
  return { year, term, students, classes, staff, newThisYear };
}
