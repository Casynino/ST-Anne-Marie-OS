# Who does what at St Anne Marie Schools OS

Written 2026-11-16 from the real permission catalog (`src/lib/rbac/roles.ts`) and services. A guard test (`tests/unit/responsibilities.test.ts`) fails if a default role ever gains a permission that belongs to another department.

## The rule
Each department does its own work and is accountable for it. The owner (Super Admin) watches, decides what is reserved for the owner, and can step in, but is never the person who does the daily work of another department. Permissions are enforced in `src/server/*` (every function calls `requirePermission`); hiding a button is never the only protection.

## Departments
| Department | Owns | May view but not change | Must not |
|---|---|---|---|
| **Admissions Office** (`registrar`) | Applications, papers, interviews, accept or decline, registration, returning-student registration, parents, enquiries, student records | Whether an admission payment is verified, attendance, timetables, report cards (may generate, not publish) | Verify or record money, enter marks, decide promotion or transfers |
| **Finance** (`accountant`) | Fee set-up, invoices, recording and verifying payments, receipts, refunds (request), expenses (record), reconciliation, arrears, finance reports, who is cleared to register | Student name, class, fee structure, registration state | Accept or decline applicants, enter or approve marks, promotion, change academic records |
| **Academic Office** (`academic_office`) | Years, classes, streams, subjects, teacher assignment, timetable, exams, approving and locking results, report cards, promote or repeat, transfers, concerns, class placement | Fee-review flag (no amounts), admissions queue | Verify payments, record money, approve expenses, process applications |
| **Teachers** (`class_teacher`, `subject_teacher`) | Own classes: attendance, marks, homework, lesson plans, behaviour, concerns, parent messages, applicant exam marking | Own students only | Money, admissions, registration status, promotion, approve or lock results, other teachers' work |
| **Head Teacher** (`head_teacher`) | Oversight and second approval: marks, plans, year-end decisions, routine expenses and refunds (never one they recorded) | Teachers' work, finance reports | Record or verify payments, set fees, hold owner-only powers |
| **Owner** (`super_admin`) | Everything below, plus: users and roles, school settings, website, backups, audit, approval limits, anything above the approval limits | All departments through the executive home | Should not do daily departmental work (the home gives him no such queues) |

## What is reserved for the owner
- Permissions `executive.read`, `expense.approve_high`, `refund.approve_high` (only Super Admin holds them by default).
- Approval limits (Settings, Approval limits; `approval_limits` setting, owner-level `school.settings.update`): an expense or refund at or above the limit can be decided only by the owner; below it, by the head teacher. 0 = no limit, so nothing changes until the owner sets one.
- Also owner-level already: exceptional admission overrides (`admission.override`), class capacity override, fee discounts (`fees.discount`), settings, users and roles.

## How work moves between departments
Hand-off tasks (`workflow_tasks`, `src/server/workflow.ts`) carry the work: department, record, assigned person, due date, status, who completed it and when. A task is completed only by the step that does the work (`closeTasks`), never by opening a page. Examples already built: application paid → Admissions; accepted with a fee → Finance; payment verified → Admissions; progression approved → registration; fee unpaid → Finance (`RETURNING_FEE`); placement → Academic Office; recruitment decision → Owner (`ADMIN`).

## The owner's home (`/dashboard`, needs `executive.read`)
Alerts first (only what is the owner's: items above his limits, hiring decisions, payments Finance has not matched, reversals, each department's overdue work with who holds it, a stale backup), then income (by how it was paid), money for the chosen period (term, month, year), the school (students, new, applications, returning, staff), and a department table (open, overdue, nobody assigned, done in 30 days, on-time rate, days to finish, longest overdue and who holds it). Service: `src/server/executive.ts`. Fee balances come from the one finance calculation.

## Known gaps (not done)
- Expenses are not tagged with a department, so "departmental expenses" is by category only.
- The Head Teacher still holds some Finance and Admissions powers (second approvals, reviewing); trimming them is a decision for the school.
- Admissions keeps `student.status_change` (transfer, withdraw, graduate on the student screen); progression decisions themselves are the Academic Office's.
- Existing schools need `npm run db:bootstrap` after deploy so the new permissions are registered and given to Super Admin.
