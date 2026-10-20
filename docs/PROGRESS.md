# Progress

_Last updated: 2026-10-20. Local commits only; nothing pushed or deployed._

## Phase 1 — Foundation: DONE (verified locally)
Sign-in, staff/user management, roles & permissions, school profile + admission-number settings, academic years/terms/levels/classes/streams/subjects, teacher assignments, student registration + guardians + enrolment history + status changes, append-only audit log + viewer, EN/SW interface, responsive layout. 53 tests at the time.

## Phase 2 — Admissions & Attendance: DONE (verified locally; see "Not verified / open" below)
Built, with tests: **133 automated tests pass** (unit + DB integration), `tsc` clean, `next build` OK, migration drift check empty.

| Area | What exists |
|---|---|
| Attendance | Registers per class/stream/session/date (draft → finalised), mobile-first marking UI (Present/Absent/Late/Excused, notes, mark-all, save draft vs finalise), completion status per class, corrections with reason + who (append-only table), staff attendance, class/student/term/school reports with configurable threshold, settings page (daily vs per-session, sessions, threshold, late/excused policy) |
| Offline | Explicit roster download (IndexedDB), outbox with client UUIDs, idempotent `POST /api/attendance/sync`, conflict inbox (`/attendance/conflicts`), UI states online/offline/queued/syncing/synced/failed/conflict, service worker (production) so `/offline-attendance` opens without a connection |
| Notifications | Durable absence events (one per notifying guardian, no duplicates on edits/re-sync/corrections), lease-based processor + cron route, in-app notifications (for guardians with a portal account), SMS adapter interface (no provider, no credentials; recorded as not sent), staff view `/attendance/alerts` |
| Admissions | Applications, duplicate prevention, workflow Applied → Interview → Accepted → Enrolled (+ Reject/Withdraw with reason), enrol creates the student through the same rules as registration, document uploads (type/size validation, storage abstraction, audited downloads), documents shown on the student profile |
| Import | CSV upload → header detection → preview → row validation → duplicate detection → downloadable error report → confirm → single transaction → summary; header-only template download |

### How it was verified
- Integration tests on `stanne_test`: idempotent replay (incl. 6 concurrent identical operations), concurrent finalisation (exactly one wins), conflicts + resolution, unauthorised corrections (class teacher, registrar, other-school users), duplicate-notification prevention, SMS never reported delivered without an adapter, applicant/student duplicate prevention (incl. 6 simultaneous submissions and the DB index), enrol atomicity + single student under concurrent enrol, admission-number uniqueness across direct/admission/import paths, import validation and all-or-nothing rollback, document type/size/permission/audit checks, AWS SigV4 test vector for the S3 adapter, client outbox logic with fake IndexedDB.
- Browser smoke test on a throw-away database (`stanne_smoke`, since dropped) at a 375 px mobile viewport: teacher marking + finalise → server-confirmed "Synced"; simulated offline marking → "Waiting to sync" (never "synced") → synced after reconnect; registrar admission → accept → upload → download (headers + audit) → enrol → student record; CSV import preview/confirm/report; head-teacher conflict review, reports, alerts. **Real offline test in a production build**: with the server stopped, the service worker served `/offline-attendance`, the class lists loaded from IndexedDB, marking queued, and the queued operation synced by itself when the server returned (one applied operation, no duplicates).
- `stanne_dev` was only migrated and had its permission catalog synced (`npm run db:bootstrap`); no demo data was added.

### Not verified / open
- S3-compatible storage adapter is signature-verified but **not exercised against a live bucket** — test with real R2/S3 credentials before launch. Local-disk adapter is development only.
- Offline caching was verified in Chromium (the in-app browser) only; test on the school's real low-end Android phones. The service worker does not run in `next dev`.
- Kiswahili strings were written without a native review — have a Swahili speaker check them.
- No SMS provider: absence alerts are recorded SKIPPED. Phase 6 plugs an adapter into `src/lib/sms/adapter.ts` and re-queues skipped deliveries.
- No cron is scheduled: events are processed right after finalisation and by `GET /api/jobs/notifications` (needs `CRON_SECRET` + a scheduler; Vercel Hobby only allows daily cron).
- Document upload size is capped at 4 MB because Vercel functions accept ≈4.5 MB bodies; larger files need direct-to-bucket uploads (not built).
- Student documents can be uploaded through the service layer but the only upload UI is on applications (they follow the applicant to the student record on enrolment).

## Known gaps / follow-ups
- Offline: class lists are downloaded per day (today); a teacher who is offline for days must download again when online. Rosters changing between download and finalise are rejected as "class list changed" (explicit, fixed by reloading online).
- Shared phones: downloaded class lists stay on the device until sign-out or "Remove offline data"; consider auto-expiry and device PIN guidance (PDPA).
- The operations ledger (`attendance_operations`) and import rows keep growing; add a retention/purge policy (Phase 8). Document objects are kept after "delete" until a retention policy exists.
- Attendance dashboard widgets, parent-facing attendance views and per-period timetables are not built (parent portal is Phase 4).
- Tenant isolation: service-layer + tests; DB-level backstop (composite FKs / RLS) still a Phase 8 item. Service error messages are English-only. Year-end promotion tool, consent records, backup/restore runbook: unchanged from Phase 1 list.
- Pre-existing: no logo/brand colours yet.

## Next: Phase 3 — Exams & results
See `docs/REQUIREMENTS.md`. Needs from the school first: approved grading scales, division rules, ranking/tie and missing-mark policy, a report-card sample.

## Decisions needed from the school/owner
- **Attendance (now live with placeholders):** once per day or per period? low-attendance threshold (85% is a placeholder)? does Late/Excused count as present? who may correct finalised attendance and within what time? confirm the conflict policy (keep first finalised, flag later).
- **Storage:** confirm Cloudflare R2 (S3-compatible, free tier, no egress fees) or another bucket; create bucket + API token; decide document retention period.
- **SMS provider** (Selcom/AzamPay/ClickPesa/Beem/…) and sender ID; message wording approval (EN/SW).
- **Admissions:** is the interview/assessment step mandatory? (Currently optional.) Required documents per class?
- **Import:** need the real legacy CSV layout from the school (columns, admission-number format) — the importer accepts common column names and the template, but the first real file will likely need small adjustments.
- Grading policy, real class/subject structure, fee structure, payment methods, brand colours/logo (Phases 3–6).
- Production: Neon project, Vercel env vars (incl. storage + `CRON_SECRET`), staging environment — only when Nino says to push/deploy.

## Public website + online application: BUILT (verified locally, 2026-10-20)
Futuristic public site (home, about, admissions info, online application form, status check, news, calendar, contact), staff-side content manager (`/website`: content EN/SW, news with draft/publish, events), "Online" badge in the admissions queue, dashboard moved to `/dashboard`. Verified: 144 tests (11 new for the public flow: closed/open gate, honeypot, rate limit, duplicate answers without leaks, cross-school class refusal, tracking needs number + phone, news/event visibility, unsafe image paths), `tsc` clean, production build OK, browser check of desktop + 375px mobile (no horizontal overflow), end-to-end online application → staff queue → audit entry on a throw-away database (dropped afterwards).

Still needed for it to sell the school (nothing is fabricated, so these show as empty until supplied): the school's logo and approved photos (`public/site/`), about text, levels confirmation, requirements, FAQs, fee information, contacts, which name is official ("St Anne Marie Schools" vs "St Anne Marie Academy" on Instagram). Instagram details seen publicly are UNCONFIRMED and not entered anywhere.
Not built yet: contact/enquiry form + staff inbox, document upload by online applicants, staff notification when an online application arrives, image upload UI (files are dropped into `public/site/`), structured data (JSON-LD), real parent/student portal pages (Phase 4: the portal cards currently go to sign-in).
