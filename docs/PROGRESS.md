# Progress

_Last updated: 2026-10-20. Local commits only; nothing pushed or deployed._

## Phase 1 — Foundation: DONE (verified locally)
Built and tested: sign-in (email or phone) with forced first-password change and DB-backed rate limiting; staff user management (temp passwords shown once); roles & permissions (server-enforced, escalation-proof); school profile + admission-number settings; academic years/terms/levels/classes/streams/subjects/class-subjects; teacher assignments; student registration (auto admission no., duplicate warnings, guardians, emergency contacts, medical notes); enrolment, moves, status changes with history; guardian directory/linking/verification; append-only audit log + viewer; EN/SW interface; responsive layout.

Verification: `tsc` clean, `next build` OK, 53 automated tests (unit + DB integration: auth/rate-limit, RBAC/escalation, tenant isolation, concurrent admission numbers, enrolment history, teacher scoping, medical access, audit immutability, calendar rules) and a browser smoke test (login, password change, academics form, student registration, SW switch, audit trail, mobile layout).

## Known gaps / follow-ups (not blocking Phase 2)
- Tenant isolation is enforced in the service layer and tested; DB-level backstop (composite FKs or Postgres RLS) is a Phase 8 hardening item.
- Service error messages are English-only (UI labels are translated).
- Mobile tables scroll horizontally inside their own container; consider card layouts for the longest lists.
- Year-end bulk promotion tool not built (enrolment model supports it).
- No logo/brand colours yet (tokens in `globals.css`; waiting for the school's assets).
- Consent records, retention policy, backups/restore runbook: Phase 8 (backup restore must be tested).
- Sensitive-document access auditing arrives with document uploads (Phase 2).

## Next: Phase 2 — Admissions & attendance
Admission workflow + document uploads (needs S3-compatible storage decision, e.g. Cloudflare R2/Neon-adjacent), CSV/Excel import, daily attendance, offline sync (IndexedDB + idempotent op IDs + conflict policy), absence notification events, attendance reports.

## Decisions needed from the school/owner (only as each phase starts)
- Attendance: once per day, or per period/session? Low-attendance threshold? Conflict policy preference (default proposal: server keeps the first finalised record, flags the later one for review).
- Grading: the school's approved grading scales, division rules, ranking/tie and missing-mark policies, report-card sample (Phase 3/4).
- Real class structure and subject list (enter via Academics; none was invented).
- Fees: fee structure, discount policy, payment methods; mobile-money aggregator and SMS provider accounts/credentials (Phase 5/6). Integrations will be built behind interfaces and left unconfigured until credentials exist.
- Brand colours/logo for report cards and the UI.
- Production: Neon project, Vercel env vars, and a staging environment — only when Nino says to push/deploy.
