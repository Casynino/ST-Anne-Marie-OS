import { db } from "@/lib/db";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { getCurrentAcademicContext } from "@/server/academics";
import { loadWebsiteSettings } from "@/server/website";

/*
 * What the administrator needs to see first: how far the school's setup has got (each step is a real fact from the database, never a guess)
 * and who has an account. Read-only, limited to this school.
 */

export type SetupItem = { key: "year" | "classes" | "subjects" | "teachers" | "grading" | "fees" | "students" | "staff" | "website" | "families"; done: boolean; href: string; count: number | null };

export async function adminHome(ctx: AuthContext) {
  requirePermission(ctx, "school.settings.read");
  const schoolId = ctx.schoolId;
  const [{ year, term }, classes, subjects, classTeachers, subjectTeachers, grading, fees, students, staff, parents, studentAccounts, neverSignedIn, website] = await Promise.all([
    getCurrentAcademicContext(schoolId),
    db.schoolClass.count({ where: { schoolId } }),
    db.subject.count({ where: { schoolId } }),
    db.classTeacher.count({ where: { schoolId } }),
    db.subjectTeacher.count({ where: { schoolId } }),
    db.gradingScale.count({ where: { schoolId } }),
    db.feeStructure.count({ where: { schoolId } }),
    db.student.count({ where: { schoolId, status: "ENROLLED" } }),
    db.user.count({ where: { schoolId, type: "STAFF", status: "ACTIVE" } }),
    db.user.count({ where: { schoolId, type: "GUARDIAN", status: "ACTIVE" } }),
    db.user.count({ where: { schoolId, type: "STUDENT", status: "ACTIVE" } }),
    db.user.count({ where: { schoolId, type: "STAFF", status: "ACTIVE", lastLoginAt: null } }),
    loadWebsiteSettings(schoolId),
  ]);
  const hasWebsiteText = Object.values(website.en).some(Boolean) || Object.values(website.sw).some(Boolean);
  const items: SetupItem[] = [
    { key: "year", done: !!year && !!term, href: "/academic-setup", count: null },
    { key: "classes", done: classes > 0, href: "/academic-setup", count: classes },
    { key: "subjects", done: subjects > 0, href: "/academic-setup", count: subjects },
    { key: "teachers", done: classTeachers + subjectTeachers > 0, href: "/academic-setup", count: classTeachers + subjectTeachers },
    { key: "grading", done: grading > 0, href: "/grading", count: grading },
    { key: "fees", done: fees > 0, href: "/finance/fees", count: fees },
    { key: "students", done: students > 0, href: "/students", count: students },
    { key: "staff", done: staff > 1, href: "/users", count: staff },
    { key: "website", done: hasWebsiteText, href: "/website", count: null },
    { key: "families", done: parents > 0, href: "/guardians", count: parents },
  ];
  return { items, doneCount: items.filter((i) => i.done).length, people: { staff, parents, students: studentAccounts, neverSignedIn } };
}
