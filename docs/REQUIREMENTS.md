# St Anne Marie Schools OS — requirements digest

Condensed from the owner's master specification (v1.0, Oct 2026). Real operational system for a Tanzanian school: no demo/fake data in production, no simulated payments, nothing hardcoded that the school must configure (classes, grading, fees, sessions).

## Phases (build in order, verify each before marking complete)
1. **Foundation**: auth, users, RBAC, school settings, academic years/terms, classes/streams/subjects, students, guardians, audit log.
2. **Admissions & attendance**: admission workflow (Applied → Interview/Assessment → Accepted → Enrolled; reject/withdraw with reason), document uploads, bulk CSV/Excel import (preview, validation, duplicates, row errors, transaction-safe), daily attendance (Present/Absent/Late/Excused, configurable sessions), **offline attendance** (client-generated op IDs, idempotent sync, explicit conflict handling, never "synced" until server confirms), absence notification events (no duplicates), staff attendance, attendance reports.
3. **Exams & results**: exam setup, marks grid (numeric, 0..max, missing ≠ zero), configurable grading engine (never invent official boundaries; get school's policy), weighted totals, positions with competition ranking (1,2,2,4), Draft → Submitted → Approved → Locked, audited unlock with reason.
4. **Report cards & parent portal**: print-ready PDFs, bulk by class (50 students < 2 min), publication gating, parents see only linked children, unpublished results never exposed by URL/cache.
5. **Fees & finance**: fee structures, invoices, discounts/scholarships, cash/bank/mobile-money payments behind a provider interface (Selcom/AzamPay/ClickPesa/bank — no credentials assumed), idempotent verified webhooks, reconciliation queue, receipts, reversals/refunds via audited workflows (never edit originals), arrears, expenses, optional configurable financial clearance. TZS, decimal-safe, single authoritative balance service, transactions for posting/allocation.
6. **Communication**: SMS adapter (queued/submitted/delivered/failed/unknown; submitted ≠ delivered), EN/SW templates, announcements, parent–teacher messaging, preferences, calendar, fee reminders, results-ready.
7. **Dashboards & admin**: role dashboards from real data, PDF/Excel exports respecting permissions, audit UI, backup status.
8. **Hardening & launch**: integration/regression/security/perf/offline/backup-restore tests, docs (EN + SW manuals), staging + production.

## Roles
Super Admin/Owner, Head Teacher/Academic Master, Class Teacher, Subject Teacher (no edits outside own subjects/classes), Accountant/Bursar, Registrar/Secretary, Parent/Guardian (linked children only), Student (optional). Extensible for transport/boarding/library/nurse/driver. Permissions enforced on the **server** per operation: authenticate → role/permission → school/branch → record scope → validate → execute → audit.

## Non-negotiables
- Multi-school ready: every school-owned row has `schoolId`; never trust client-supplied school/student/payment IDs; cross-school access impossible.
- Audit log for: user/permission changes, student registration/enrolment/transfer/withdrawal, attendance corrections, marks changes, approve/lock/unlock, fee/invoice/payment/refund/receipt-void, document access, settings changes. Append-only.
- Admission numbers: configurable pattern (e.g. `SAM/2026/0001`), concurrency-safe, never reused.
- Guardian links are explicit (never inferred from matching phone numbers); multiple guardians per student and children per guardian.
- Historical enrolments/results/financials are never overwritten; promotion creates new records.
- Dates: Africa/Dar_es_Salaam display, explicit date handling (no timezone shifts for attendance/finance dates). TZS default currency.
- English + Kiswahili UI via one central translation system; EN/SW SMS templates.
- Mobile-first for teachers/parents (low-end Android, slow 3G): large touch targets, minimal typing, no horizontal overflow.
- Privacy (Tanzania PDPA): purpose-limited data, restricted medical/financial/academic access, consent records, retention policy, secure documents.
- Targets: ~5,000 students / 1,500 users; pages < 3 s on 3G; daily backups with tested restore.

## Out of scope for MVP (keep architecture ready)
Timetable, lesson plans, homework, ID cards, payroll, library, transport, boarding, health room, inventory, discipline, alumni, e-learning, AI comments.

## MVP acceptance (summary)
Registrar admits → admission no. → class → guardians; enrolled students flow into attendance/fees; offline attendance syncs without duplicates; parents get absence alerts; teachers enter marks → approval → lock; PDF report cards (single + class); parents see only own children; accountant configures fees/invoices/payments/reconciliation/receipts; mobile-money updates records only after verified confirmation; balances stay correct after partial payments/reversals; SMS/announcements; accurate dashboards; PDF/Excel exports; sensitive actions audited; backups restorable; critical logic + security covered by automated tests; works on phones/tablets/desktops.
