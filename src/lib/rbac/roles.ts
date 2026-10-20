import { ALL_PERMISSION_KEYS, type PermissionKey } from "./permissions";

export type SystemRoleDef = {
  key: string;
  name: string;
  description: string;
  permissions: readonly PermissionKey[];
};

/**
 * Default roles created for every school. Schools may edit permissions of any role
 * except `super_admin`, which always holds every permission.
 * Parent and student accounts get access through explicit relationships
 * (guardian→child links), not staff permissions, so their roles start empty.
 */
export const SYSTEM_ROLES: readonly SystemRoleDef[] = [
  {
    key: "super_admin",
    name: "Super Admin / Owner",
    description: "Full access to school configuration, users and records.",
    permissions: ALL_PERMISSION_KEYS,
  },
  {
    key: "head_teacher",
    name: "Head Teacher / Academic Master",
    description: "Oversees academics, students, staff activity.",
    permissions: [
      "exam.read",
      "exam.manage",
      "results.read",
      "results.approve",
      "results.lock",
      "results.unlock",
      "remarks.head",
      "enquiry.read",
      "enquiry.manage",
      "website.manage",
      "school.settings.read",
      "user.read",
      "role.read",
      "audit.read",
      "academic.read",
      "academic.assign",
      "student.read",
      "student.guardians.read",
      "student.medical.read",
      "guardian.read",
      "attendance.read",
      "attendance.take_any",
      "attendance.correct",
      "attendance.configure",
      "attendance.staff.read",
      "attendance.staff.record",
      "notification.read",
      "admission.read",
      "admission.review",
      "document.read",
      "document.delete",
    ],
  },
  {
    key: "class_teacher",
    name: "Class Teacher",
    description: "Works with students and parents of assigned classes.",
    permissions: [
      "exam.read",
      "marks.enter",
      "results.read_assigned",
      "remarks.class","academic.read", "student.read_assigned", "student.guardians.read", "attendance.take", "attendance.read_assigned"],
  },
  {
    key: "subject_teacher",
    name: "Subject Teacher",
    description: "Teaches assigned subjects and classes.",
    // Add attendance.take for subject teachers if the school records attendance per period.
    permissions: [
      "exam.read",
      "marks.enter",
      "results.read_assigned","academic.read", "student.read_assigned", "attendance.read_assigned"],
  },
  {
    key: "accountant",
    name: "Accountant / Bursar",
    description: "Fees, payments and financial reporting.",
    permissions: ["academic.read", "student.read", "student.guardians.read", "guardian.read"],
  },
  {
    key: "registrar",
    name: "Registrar / Secretary",
    description: "Admissions, student records and guardians.",
    permissions: [
      "enquiry.read",
      "enquiry.manage",
      "academic.read",
      "student.read",
      "student.create",
      "student.update",
      "student.enroll",
      "student.status_change",
      "student.guardians.read",
      "student.medical.read",
      "student.medical.update",
      "guardian.read",
      "guardian.manage",
      "guardian.verify",
      "student.import",
      "attendance.read",
      "attendance.take_any",
      "attendance.staff.read",
      "attendance.staff.record",
      "notification.read",
      "admission.read",
      "admission.create",
      "admission.review",
      "admission.enrol",
      "document.read",
      "document.upload",
    ],
  },
  {
    key: "parent",
    name: "Parent / Guardian",
    description: "Portal access to linked children only (via explicit relationships).",
    permissions: [],
  },
  {
    key: "student",
    name: "Student",
    description: "Portal access to the student's own published information.",
    permissions: [],
  },
];

export const SUPER_ADMIN_ROLE_KEY = "super_admin";

/** Portal roles are for parent/student accounts (Phase 4), never for staff accounts. */
export const PORTAL_ROLE_KEYS: readonly string[] = ["parent", "student"];
