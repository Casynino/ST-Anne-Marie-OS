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
  "admission.documents.verify": { module: "admissions", description: "Verify applicants' documents and return incomplete applications for correction" },
  "admission.interview.manage": { module: "admissions", description: "Schedule, move and cancel interviews and record their results" },
  "admission.window.manage": { module: "admissions", description: "Open and close online applications (the application window)" },
  "admission.exam.assign": { module: "admissions", description: "Assign teachers to the subjects of an applicant's examination, and change or withdraw an assignment" },
  "admission.exam.mark": { module: "admissions", description: "Mark the applicant examinations assigned to you and submit the results" },
  "admission.exam.review": { module: "admissions", description: "Review applicant examination results: approve them, or return them to the teacher for correction" },
  "admission.interview.notes": { module: "admissions", description: "Read interview notes (the assigned interviewer can always read their own)" },
  "admission.offer.approve": { module: "admissions", description: "Approve admission offers when the school requires approval" },
  "admission.payment.record": { module: "admissions", description: "Record admission payments received from applicants (Finance)" },
  "admission.payment.verify": { module: "admissions", description: "Verify, reject or reverse admission payments (Finance)" },
  "admission.override": { module: "admissions", description: "Authorise exceptions: continue without complete papers, or enrol without the verified admission payment (reason recorded)" },
  "academic.office": { module: "academic", description: "Use the Academic Office desk: dashboard, class placement, transfers, promotions and academic concerns" },
  "staff.recruit": { module: "staff", description: "Record job candidates, arrange their interviews and record the results" },
  "staff.recruit.decide": { module: "staff", description: "Decide on a job candidate and approve employment (never your own)" },
  "staff.onboard": { module: "staff", description: "Complete a new employee's onboarding: documents, account and the hand-off to Finance" },
  "concern.flag": { module: "academic", description: "Flag a student you teach for academic follow-up" },
  "concern.manage": { module: "academic", description: "See every academic concern and follow it up to resolution" },
  "concern.notes": { module: "academic", description: "Read the restricted notes on academic concerns" },
  "transfer.request": { module: "academic", description: "Request a class transfer or promotion" },
  "transfer.approve": { module: "academic", description: "Approve and apply class transfers and promotions" },
  "fees.status.read": { module: "finance", description: "See only whether a student's fees need review (no amounts), for academic decisions" },
  "tasks.academic": { module: "tasks", description: "See and work the Academic Office hand-off tasks" },
  "tasks.finance": { module: "tasks", description: "See and work the Finance hand-off tasks" },
  "tasks.hr": { module: "tasks", description: "See and work the staff recruitment and onboarding tasks" },
  "tasks.admin": { module: "tasks", description: "See every department's tasks, including overdue ones, to oversee the whole school" },
  // Digital library and school IDs
  "library.read": { module: "library", description: "Open the Library Management area" },
  "library.upload": { module: "library", description: "Upload and edit your own library resources" },
  "library.review": { module: "library", description: "Approve or return library resources (never your own)" },
  "library.publish": { module: "library", description: "Publish, archive and restore library resources" },
  "library.manage": { module: "library", description: "Manage every library resource, the categories and the library settings" },
  "library.access_staff": { module: "library", description: "Open staff-only library resources such as teacher guides" },
  "library.analytics": { module: "library", description: "See library statistics" },
  "library.audit": { module: "library", description: "See detailed library activity, including who opened what" },
  "library.pin": { module: "library", description: "Set students' library PINs" },
  "schoolid.manage": { module: "library", description: "Assign missing school IDs and set the school ID format" },
  "class.capacity_override": { module: "students", description: "Place a student in a class that is already full (reason recorded)" },
  "progression.read": { module: "academic", description: "View the end-of-year progression decisions of students" },
  "progression.prepare": { module: "academic", description: "Prepare end-of-year progression decisions: promoted, repeat, pending review, completed, left" },
  "progression.approve": { module: "academic", description: "Approve (finalize) progression decisions" },
  "progression.head_approve": { module: "academic", description: "Give the Head Teacher's approval of progression decisions when the school asks for it" },
  "progression.exception": { module: "academic", description: "Decide without finalized results or outside the school's grade order, or revise an approved decision (reason recorded)" },
  "registration.read": { module: "students", description: "View returning students: their placement, annual registration and fee-clearance status" },
  "registration.manage": { module: "students", description: "Place returning students in a class and stream, confirm annual registration and put them in the class roster" },
  "fees.clearance.exception": { module: "finance", description: "Approve a payment arrangement that treats the fee condition for annual registration as met (reason recorded)" },
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

  // Fees & finance
  "fees.read": { module: "finance", description: "View fee structures, invoices, payments, balances and student statements" },
  "fees.manage": { module: "finance", description: "Set up fee items, fee structures, fee settings and payment instructions" },
  "fees.discount": { module: "finance", description: "Grant or end scholarships and discounts for students" },
  "invoice.generate": { module: "finance", description: "Generate term invoices, create one-off invoices and set instalments" },
  "invoice.adjust": { module: "finance", description: "Add charge or discount adjustment lines to an issued invoice" },
  "invoice.void": { module: "finance", description: "Void an invoice (with a reason)" },
  "payment.record": { module: "finance", description: "Record payments received and issue receipts" },
  "payment.reverse": { module: "finance", description: "Reverse a payment recorded in error (with a reason)" },
  "refund.request": { module: "finance", description: "Request a refund of unapplied credit and record the payout once approved" },
  "refund.approve": { module: "finance", description: "Approve or reject refund requests (never your own)" },
  "expense.read": { module: "finance", description: "View school expenses" },
  "expense.manage": { module: "finance", description: "Record and void expenses, manage expense categories" },
  "expense.approve": { module: "finance", description: "Approve or reject expenses that need approval (never your own)" },
  "finance.reports": { module: "finance", description: "View finance dashboards and reports (arrears, collections, expenses) and export them" },
  "finance.reconcile": { module: "finance", description: "Match or reject mobile-money and bank notifications that could not be matched automatically" },

  // Communication
  "comms.read": { module: "communication", description: "View sent announcements and fee reminders and their delivery results" },
  "comms.send": { module: "communication", description: "Send announcements to parents (SMS and in-app)" },
  "comms.fee_reminder": { module: "communication", description: "Send fee reminders to parents of students who owe fees" },
  "comms.manage": { module: "communication", description: "Edit the wording of system messages (absence, fees, results)" },
  "messages.read": { module: "communication", description: "Read parent-teacher conversations you take part in" },
  "messages.send": { module: "communication", description: "Write to parents of students you teach and reply to their messages" },
  "messages.moderate": { module: "communication", description: "See all conversations, handle the school office inbox, hide messages and close conversations" },

  // Learning hub
  "timetable.read": { module: "learning", description: "View timetables (classes, teachers)" },
  "timetable.manage": { module: "learning", description: "Set up lesson periods and build or change the timetable" },
  "plans.write": { module: "learning", description: "Write schemes of work and lesson plans for the classes and subjects you teach" },
  "plans.review": { module: "learning", description: "Read, approve or return teachers' schemes of work and lesson plans" },
  "assignments.manage": { module: "learning", description: "Set homework for the classes and subjects you teach, mark it and give feedback" },
  "assignments.oversee": { module: "learning", description: "Read all homework and submissions (oversight, no marking)" },
  "portfolio.manage": { module: "learning", description: "Add and approve portfolio items for students you teach" },
  "behaviour.record": { module: "learning", description: "Record behaviour for students you teach and read those records" },
  "behaviour.read_all": { module: "learning", description: "Read behaviour records of every student" },
  "backup.read": { module: "school", description: "View backup and restore-test records and whether backups are current" },
  "student.import": { module: "students", description: "Bulk import students from a CSV file" },
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(key: string): key is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, key);
}
