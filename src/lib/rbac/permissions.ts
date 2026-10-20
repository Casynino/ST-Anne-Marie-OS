/**
 * Single source of truth for permissions. Keys are stored in the `permissions` table
 * (synced by `syncPermissionCatalog`) and checked on the server for every operation.
 * New modules add keys here; existing roles only receive new keys that are listed in
 * their defaults (see roles.ts) — never silently re-granted if an admin removed them.
 */
export const PERMISSIONS = {
  // School & settings
  "school.settings.read": { module: "school", description: "View school profile and settings" },
  "school.settings.update": { module: "school", description: "Change school profile and settings" },

  // Users, roles, audit
  "user.read": { module: "users", description: "View staff users" },
  "user.create": { module: "users", description: "Create staff users" },
  "user.update": { module: "users", description: "Edit staff users and their roles" },
  "user.suspend": { module: "users", description: "Suspend or reactivate users" },
  "user.reset_password": { module: "users", description: "Reset another user's password" },
  "role.read": { module: "users", description: "View roles and permissions" },
  "role.manage": { module: "users", description: "Create roles and change role permissions" },
  "audit.read": { module: "audit", description: "View the audit log" },

  // Academic structure
  "academic.read": { module: "academics", description: "View years, terms, classes, subjects" },
  "academic.manage": { module: "academics", description: "Manage years, terms, levels, classes, streams, subjects" },
  "academic.assign": { module: "academics", description: "Assign teachers to classes and subjects" },

  // Students
  "student.read": { module: "students", description: "View all students" },
  "student.read_assigned": { module: "students", description: "View students in assigned classes only" },
  "student.create": { module: "students", description: "Register students" },
  "student.update": { module: "students", description: "Edit student details" },
  "student.enroll": { module: "students", description: "Enroll students and move them between classes" },
  "student.status_change": { module: "students", description: "Record transfers, withdrawals, graduation" },
  "student.guardians.read": { module: "students", description: "See guardian contact details on a student profile" },
  "student.medical.read": { module: "students", description: "View student medical notes" },
  "student.medical.update": { module: "students", description: "Edit student medical notes" },

  // Guardians
  "guardian.read": { module: "guardians", description: "View the guardian directory" },
  "guardian.manage": { module: "guardians", description: "Create, edit, link and unlink guardians" },
  "guardian.verify": { module: "guardians", description: "Verify guardian-student relationships" },

  // Attendance (Phase 2)
  "attendance.read": { module: "attendance", description: "View attendance registers and reports for all classes" },
  "attendance.read_assigned": { module: "attendance", description: "View attendance for assigned classes only" },
  "attendance.take": { module: "attendance", description: "Take and finalise attendance for assigned classes" },
  "attendance.take_any": { module: "attendance", description: "Take and finalise attendance for any class" },
  "attendance.correct": { module: "attendance", description: "Correct finalised attendance and resolve sync conflicts" },
  "attendance.configure": { module: "attendance", description: "Configure attendance sessions and thresholds" },
  "attendance.staff.read": { module: "attendance", description: "View staff attendance" },
  "attendance.staff.record": { module: "attendance", description: "Record staff attendance" },
  "notification.read": { module: "attendance", description: "View absence notification events and their delivery status" },

  // Admissions, documents, import (Phase 2)
  "admission.read": { module: "admissions", description: "View admission applications" },
  "admission.create": { module: "admissions", description: "Record and edit admission applications" },
  "admission.review": { module: "admissions", description: "Move applications through interview, acceptance or rejection" },
  "admission.enrol": { module: "admissions", description: "Enrol accepted applicants as students" },
  "document.read": { module: "admissions", description: "View and download uploaded documents" },
  "document.upload": { module: "admissions", description: "Upload documents to applications and students" },
  "document.delete": { module: "admissions", description: "Remove uploaded documents" },

  // Public website
  "website.manage": { module: "website", description: "Edit the public website content, news and events" },
  "enquiry.read": { module: "website", description: "View enquiries sent through the public contact form" },
  "enquiry.manage": { module: "website", description: "Update enquiry status and notes" },

  // Examinations and results
  "exam.read": { module: "exams", description: "View examinations and the marks overview" },
  "exam.manage": { module: "exams", description: "Create examinations and choose the subjects examined per class" },
  "grading.manage": { module: "exams", description: "Configure grading scales, grade bands and division rules" },
  "marks.enter": { module: "exams", description: "Enter marks for subjects and classes you are assigned to" },
  "marks.enter_any": { module: "exams", description: "Enter marks for any subject and class" },
  "results.read": { module: "exams", description: "View results of all classes" },
  "results.read_assigned": { module: "exams", description: "View results of classes you teach" },
  "results.approve": { module: "exams", description: "Approve or return submitted marks" },
  "results.lock": { module: "exams", description: "Lock approved results" },
  "results.unlock": { module: "exams", description: "Unlock locked results (reason required, audited)" },
  "remarks.class": { module: "exams", description: "Write class teacher remarks for report cards" },
  "remarks.head": { module: "exams", description: "Write head teacher comments for report cards" },
  "reportcard.read": { module: "exams", description: "View and download report cards of any class" },
  "reportcard.generate": { module: "exams", description: "Generate report cards from locked results" },
  "reportcard.publish": { module: "exams", description: "Publish report cards to parents and students, or withdraw them" },
  "portal.manage": { module: "guardians", description: "Create, reset and disable parent and student portal accounts" },
  "student.import": { module: "students", description: "Bulk import students from a CSV file" },
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(key: string): key is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, key);
}
