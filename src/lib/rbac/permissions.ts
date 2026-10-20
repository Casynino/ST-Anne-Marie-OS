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
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(key: string): key is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, key);
}
