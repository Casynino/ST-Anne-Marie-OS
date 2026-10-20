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

## (Superseded) Phase 3 plan — see "Phase 3 — Exams & results: BUILT" below
See `docs/REQUIREMENTS.md`. Needs from the school first: approved grading scales, division rules, ranking/tie and missing-mark policy, a report-card sample.

## Decisions needed from the school/owner
- **Attendance (now live with placeholders):** once per day or per period? low-attendance threshold (85% is a placeholder)? does Late/Excused count as present? who may correct finalised attendance and within what time? confirm the conflict policy (keep first finalised, flag later).
- **Storage:** confirm Cloudflare R2 (S3-compatible, free tier, no egress fees) or another bucket; create bucket + API token; decide document retention period.
- **SMS provider** (Selcom/AzamPay/ClickPesa/Beem/…) and sender ID; message wording approval (EN/SW).
- **Admissions:** is the interview/assessment step mandatory? (Currently optional.) Required documents per class?
- **Import:** need the real legacy CSV layout from the school (columns, admission-number format) — the importer accepts common column names and the template, but the first real file will likely need small adjustments.
- Grading policy, real class/subject structure, fee structure, payment methods, brand colours/logo (Phases 3–6).
- Production: Neon project, Vercel env vars (incl. storage + `CRON_SECRET`), staging environment — only when Nino says to push/deploy.

## Public website + staff dashboard transformation: BUILT (verified locally, 2026-10-20)

**Identity.** Brand green `#028051` and the yellow call-out colour were read from the school's own emblem and Instagram posters (emblem text: "ST. ANNE MARIE ACADEMY / SUPERB EDUCATION"); an indigo from the posters is used sparingly. These are the *reference* colours: replace the ramp in `src/app/globals.css` if the school has a style guide. Display typeface: Fraunces (self-hosted by `next/font`, swap); body text uses the system font stack. Public site and staff area share the same tokens.

**Public website** (`src/app/(site)`): announcement bar (a published news post flagged "show in bar"), scroll-aware header with mobile menu, home page (hero with layered photo composition, ticker, introduction, programmes from the real levels/classes, "why choose us", school life gallery with accessible lightbox, admissions panel, news and events, parents section, contact form), About, Academics (real levels, classes and subjects), Admissions (`/apply`, with the working online application, status check and an inquiry form), School Life, News (categories, article pages with stable slugs, share links), Events (list + detail), Contact (working form), Parent Portal entry (`/portal`), Privacy, 404/error/loading screens, `robots.txt`, `sitemap.xml`, canonical + Open Graph + Twitter metadata, JSON-LD (school, news article, event), generated social card. Staff `/academics` moved to `/academic-setup` and staff admissions stay at `/admissions`, so the public section uses `/academics` and `/apply`.

**Content management** (staff area → Website, permission `website.manage`): grouped EN/SW content editor, news (category, summary, cover, publish/unpublish, announcement-bar flag), events, an image library (upload JPEG/PNG/WebP up to 2 MB, alt text required, stored in the database and served from `/media/<id>` with long cache), and an Enquiries inbox (`enquiry.read`/`enquiry.manage`) for the contact forms. Nothing is invented: empty fields hide their section.

**Staff area**: grouped, collapsible sidebar (state remembered), breadcrumbs, student search, notification bell, academic-year/term chip, account menu with language and sign-out, mobile drawer, skip link. The dashboard is permission-driven: KPIs, "needs attention", today's registers (teachers), enrolment by class, admissions pipeline, 14-day attendance trend, recent applications and activity. Every figure uses the same services and rules as the detail screens (attendance rate follows the school's late/excused policy; teachers only see their own classes; parents/students get an honest empty state). Finance and exam widgets do not exist because those modules are not built yet.

**Verification.** `tsc` clean, `next build` OK (46 routes), 170 automated tests (new: images/sniffing, mosaic, charts, media library, enquiries, news slugs and bar, public site data, dashboard numbers per role), browser checks on desktop and 375 px (no horizontal overflow, mobile menu/drawer, contact form saved, image upload round-trip, dashboards for admin, teacher and parent). Throw-away databases used for the synthetic data were dropped.

**Photos (asset inventory).** In `public/site/gallery`: 6 photographs from the school's public Instagram posts (students with teachers, a group in front of a hall, a lawn event, library visits). Only ~640 px previews were available without signing in, so they suit cards and the gallery but **not a full-width hero**. Several show students on a visit to a university hall, so captions make no claims about place or occasion. Not used: posters (text graphics) and candid close-ups. Missing and needed from the school: logo file (emblem exists only as a small poster image), high-resolution originals, campus/building exterior, classroom and laboratory, sports/arts/events photos, and written confirmation that photographs of students may be published (parental consent). Drop files into `public/site/` (see its README) or upload under Website → Images.

**Dev database content (confirm with the school before real use).** The dev site was filled with statements taken from the school's own posters: headline "Quality education, a strong foundation for the future", the four "services" (quality education, experienced teachers, supportive learning environment, character and talent development), phones 0654 995 711 / 0754 309 879, location Mbezi Kimara, Kwa Msuguri, motto "Superb Education", levels Nursery/Primary/O-Level/A-Level (classes only for Form I–VI), and one published notice about the 2026 Pre-Form One course (registration 14 Sep–15 Dec 2026) and Form Five admission (Division I or II). Fee amounts shown on the posters (150,000/= and 250,000/=, meaning not stated) were deliberately not published. Open question: the posters say "St. Anne Marie Academy"; the system and brief say "St Anne Marie Schools". Edit the school name under School settings.

**Not built / still open.** Introduction text, vision/mission/values, history, leadership, programme descriptions, fees and FAQs (admin fields exist; the school must supply the words). Document upload by online applicants. Staff e-mail/SMS alert when an application or enquiry arrives (they appear in the dashboard and inboxes). Real parent and student portal pages (Phase 4), finance (Phase 5), examinations (Phase 3). ESLint is not configured. Charts are dependency-free SVG/HTML; trends compare only real recorded data.


## Phase 3 — Exams, grading & results: BUILT (verified locally, 2026-10-20)

**What exists.** Configurable grading scales (bands, points, divisions, pass mark; per level or school default) and a results policy (absent = excluded or zero, rank by average or total, decimals, "all marks before submit") under `/grading`; examinations per term with weight and deadline (`/exams`), classes/subjects added in one step (one submission unit per stream); mark entry grid (`/marks/[id]`, mobile-friendly, live grade preview, Enter moves to next row, errors per student, nothing saved if any mark is invalid); workflow DRAFT → SUBMITTED → APPROVED → LOCKED with RETURNED for corrections; approval queue and bulk approve/lock; class results sheet (`/results`) with subject results, totals, averages, class/stream positions, divisions, class mean and a "complete / incomplete" banner.

**Rules built in (decided, change only on Nino's word).** A missing mark is "not entered", never zero; Absent/Exempt are explicit. Locking snapshots each mark's percent/grade/points/scale, so later scale edits never change locked results; unlock needs `results.unlock` and a reason (audited), clears the snapshot and sends the unit back as RETURNED; every edit after the first submission is written to the append-only `result_changes` table. Official results count LOCKED units only; "provisional" also counts APPROVED; units not yet counted are left out of totals (never zero) and reported in the coverage line. Teachers enter marks only where they are subject teacher (class, stream, subject) or class teacher (any subject of that class/stream) in the exam's year; `marks.enter_any` lifts that. Class results: `results.read` or the class teacher of that class/stream. Competition ranking (1,2,2,4) after rounding; rounding half away from zero. Division = sum of best N subject points, "INC" with fewer than N graded subjects.

**Nothing official is hard-coded.** The only built-in content is an optional, clearly labelled template (Tanzania O-Level CSEE pattern) that only pre-fills the new-scale form; it is applied only when someone saves it. **The school must confirm its grading bands, divisions, pass mark and weights.**

**Verification.** `tsc` clean; 204 automated tests (19 engine/validator unit tests; 15 integration tests: permissions and scope, validation all-or-nothing, workflow states, concurrent-edit detection, snapshot immutability, audited unlock, post-submission history, class results/positions/divisions, cross-school isolation); browser run on a throw-away database (entry, validation errors, submit blocked until complete, approve, lock, results sheet). Throw-away database dropped.

**Open / not built.** Remarks and report-card output (Phase 4); parent/student result views (Phase 4); exam reminders/notifications (Phase 6); CSV/Excel export of results (Phase 7); entering marks offline. Self-approval is not blocked (the audit log records submitter and approver).
