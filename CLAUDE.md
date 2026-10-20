# St Anne Marie Schools OS

School management system for St Anne Marie Schools (Tanzania). Real operational system: never add fake students/payments to production. Full requirements digest: `docs/REQUIREMENTS.md`. Build status and next steps: `docs/PROGRESS.md`. Global rules in `~/.claude/CLAUDE.md` apply (notably: **never `git push` or deploy unless Nino says "push"**; commit locally is fine).

## Stack
Next.js 16 (App Router, Turbopack) · TypeScript strict · React 19 · Tailwind 4 · Prisma 7 + `@prisma/adapter-pg` · PostgreSQL (local 16 for dev/test; Neon for production) · Zod 4 · Vitest. No Redis, no separate backend. Node ≥ 22.18.

## Commands
- `npm run dev` — dev server (port 3000). `npm run build` — `prisma generate` + `next build`.
- `npm run typecheck` · `npm test` (all) · `npm run test:unit`.
- `npm run db:migrate` — dev migration (interactive; hangs in non-TTY, so use `prisma migrate dev --create-only` then `migrate deploy`/`migrate dev`). `npm run db:bootstrap` — idempotent: permission catalog, school `SAM`, default roles, first Super Admin from `BOOTSTRAP_ADMIN_*` env (only if the school has no users).
- Drift check (non-interactive): `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script < /dev/null` must print an empty migration.

## Environment (Phase 2 additions, see `.env.example`)
`STORAGE_DRIVER` (`local` dev only | `s3` for R2/S3-compatible; unset in production = uploads refused), `STORAGE_LOCAL_DIR`, `S3_*`, `DOCUMENT_MAX_BYTES` (default 4 MB), `CRON_SECRET` (Bearer secret for `GET /api/jobs/notifications`). `NEXT_DIST_DIR` lets a second Next server (e.g. a smoke copy on a throw-away database) run beside the main dev server.

## Databases
Local only: `stanne_dev` (`DATABASE_URL`) and `stanne_test` (`TEST_DATABASE_URL`) on the Homebrew Postgres 16. Tests refuse to run unless the URL ends in `_test`. `audit_logs` is append-only (DB trigger), so tests isolate by creating a fresh school per file instead of truncating. Credentials/secrets live only in gitignored `.env`.

## Architecture (follow these conventions)
- `src/server/*` = domain services. Every function takes `ctx: AuthContext` and: checks permission (`requirePermission`) → scopes every query by `ctx.schoolId` (other-school records ⇒ `NOT_FOUND`) → validates with zod (`parse`) → writes in a transaction with `writeAudit(tx, …)`. Business rules live here, never in components.
- `src/lib/auth/*`: scrypt password hashing, DB sessions (hashed token cookie `sam_session`), DB-backed login rate limiting, `buildAuthContext` loads permissions per request. `src/lib/auth/next.ts` = Next glue (`requireContext`, `getT`).
- RBAC: permission catalog in `src/lib/rbac/permissions.ts`, default roles in `roles.ts`; synced to DB by `syncPermissionCatalog`/`ensureSchoolRoles` (never re-grants permissions an admin removed). No privilege escalation: you can only grant/assign what you hold. Portal roles `parent`/`student` are not staff-assignable.
- Server actions: `src/app/**/actions.ts` use `run(form, fn)` from `src/lib/action.ts` (auth, parse FormData, map `AppError` to field errors, generic message for unexpected errors). Forms: `ActionForm`/`Field` in `src/components/form.tsx`.
- i18n: `src/lib/i18n/en.ts` + `sw.ts` (same keys; parity test). All UI strings go through `t()`.
- Dates: `@db.Date` for calendar dates, helpers in `src/lib/dates.ts` use UTC to avoid shifts; school timezone for "today".
- Unique rules Prisma can't express (partial/NULLS NOT DISTINCT indexes, CHECKs, audit trigger) are in the init migration SQL; the NULLS NOT DISTINCT indexes are also declared in `schema.prisma` with `map:` so Prisma doesn't drop them.
- Page files must only export `default`/`metadata` (put helpers in separate modules).

## Phase 2 architecture (Admissions & Attendance)
- **Attendance** (`src/server/attendance.ts`, reports in `attendance-reports.ts`): `AttendanceRegister` per class/stream/session/date (DRAFT|FINALISED) owns `StudentAttendance` (unique student+session+date, stricter than student+class+date+session). Finalised registers change only via `correctAttendance` (needs `attendance.correct`, reason, append-only `attendance_corrections` table) or conflict resolution. Sessions: `school_settings.attendance` (`mode` DAILY default | PER_SESSION) + `attendance_sessions` (DAY always exists).
- **One write path** for online form and offline sync: `submitAttendance` (idempotent on client-generated `clientOpId` per user via the `attendance_operations` ledger; advisory lock per register; conflicts are stored, never silently applied). Policy: keep first finalised record; a later divergent submission becomes a CONFLICT reviewed on `/attendance/conflicts` (accept = audited corrections, dismiss = keep server). Students with no record yet (late joiners) can be added to a finalised register; existing records are never altered by a normal submission. Validation failures are NOT recorded in the ledger so the client can fix and retry with the same id.
- **Offline** (client-only, `src/lib/offline/*`, `src/components/attendance/*`): rosters downloaded explicitly into IndexedDB (per user, per date), outbox with states queued/syncing/synced/failed/conflict ("synced" only after the server answers APPLIED), `POST /api/attendance/sync` (same-origin check, cookie auth), `public/sw.js` (production only) caches `/offline-attendance` (a page with no user data) and `/_next/static/*` — nothing else. Sign-out clears downloaded lists but keeps unsynced operations.
- **Notifications** (`src/server/notifications.ts`): `notification_events` outbox, one per (absent record, guardian with `receivesNotifications`), dedupe key; processed with a lease + SKIP LOCKED right after finalise and by the cron route. Channels: in-app (only guardians with a portal user) and SMS through `src/lib/sms/adapter.ts` — no provider chosen, so SMS is recorded SKIPPED. Nothing is ever reported as delivered without a provider confirmation.
- **Admissions** (`src/server/admissions.ts`): Applied → (Interview) → Accepted → Enrolled, Rejected/Withdrawn need a reason. Accepted ≠ enrolled: `enrolApplication` runs `createStudentInTx` (shared with direct registration) in one transaction. Open duplicates blocked by service + partial unique indexes (migration SQL).
- **Documents** (`src/server/documents.ts`, `src/lib/storage/*`): type decided from file bytes (PDF/JPEG/PNG/WebP), size cap, random storage keys, downloads only through `/api/documents/[id]` (permission-checked, audited, `no-store`). Delete = hide + audit.
- **Import** (`src/server/import.ts`, pure logic in `src/lib/import/students.ts`, CSV parser `src/lib/csv.ts`): upload → preview batch (nothing imported) → confirm re-checks the DB and imports in ONE transaction, once per batch. CSV only (Excel: "Save as CSV UTF-8"; no spreadsheet dependency by design). Max 1,000 rows / 2 MB.
- Tests that need attendance use `createCurrentYearAcademics` (the year must contain today; future dates are refused).

## Public website (built after Phase 2)
- Routes in `src/app/(site)`: `/` home, `/about`, `/apply` (admissions information), `/apply/form`, `/apply/received`, `/apply/track`, `/news`, `/news/[id]`, `/calendar`, `/contact`; `robots.ts`/`sitemap.ts`. The staff dashboard is `/dashboard` (staff admissions screens own `/admissions`, so the public section lives under `/apply`).
- **Nothing is invented.** Copy comes from `school_settings.website` (EN + SW fields, edited in the staff area at `/website`, permission `website.manage`), published `announcements`, `school_events`, and the real levels/classes. Empty fields hide their section. Photos come only from files the school supplies: drop them into `public/site/` (`logo.*`, `hero.*`, `about.*`, `gallery/NN-caption.*`); `scripts/scan-site-media.ts` (runs on `predev`/`build`) writes the committed `src/lib/site-media.json`. Website-settings paths override the files. No images were downloaded from social media (photos of children need the school's consent).
- Online applications (`src/server/public-applications.ts`): unauthenticated, so the service enforces everything: `applicationsOpen` setting, honeypot field `website`, DB rate limits (`consumeRateLimit`: 5/hour per IP, 300/day per school), consent, class must be an active class of that school, duplicate answers never reveal other records. They land as `APPLIED` with `source=ONLINE`, `createdById=null`, audit actor "Online applicant", and go through the normal admissions workflow (accepted != enrolled). Status check (`trackApplication`) needs application number AND a guardian phone and returns status only.
- Look and feel: dark "night" hero + light sections, system fonts only, tokens in `globals.css` (`night`, `glow`, `signal`, `accent`, brand ramp is a swappable placeholder). Animation toolkit in `src/components/site/fx/*`: `Reveal` (hides only below-the-fold blocks after hydration, never blanks the page), `WordReveal` (CSS), `HeroField` (canvas; switches itself off for reduced-motion, data-saver and low-end phones), `Parallax` (`motion`, lazy features), `Marquee`, `Spotlight`, `GalleryRail` (+ lightbox). Always honour `prefers-reduced-motion`; no effect may be needed to read content.
- Learning from the owner's earlier sites (Vegas, Reckless, Target Express use `motion`/`lenis`/three): copy techniques, never their photos or content.

## Decided business rules (Phase 1)
- One ACTIVE enrollment per student per academic year (DB-enforced); moves/year changes close the old row (`MOVED`/`COMPLETED`), history is kept. Status changes (transfer/withdraw/graduate) require a reason and close the active enrollment; reinstatement returns to Enrolled (class placement is a separate step).
- Student needs ≥1 guardian at registration; exactly one primary guardian; last/primary guardian can't be unlinked; changing a relationship clears its verification.
- Medical notes: read needs `student.medical.read`; editing needs read + update; note content is never written to the audit log (views are audited).
- Teachers (`student.read_assigned`) only see students in classes/streams they teach in the current year.
- Duplicate student (same name + DOB) and shared guardian phone require explicit confirmation.

## Decided business rules (Phase 2)
- Attendance default: ONE session per day (`DAY`); per-session mode is a setting. **Open decision for the school** (placeholders until confirmed): low-attendance threshold 85%; late counts as present; excused does NOT count as present in the rate; correction rights are `attendance.correct` only (Head Teacher by default; no time window); conflict policy = keep first finalised, flag later (proposal, not yet confirmed).
- Roster for a date = enrolments with `startedOn <= date < endedOn` in that class/stream; attendance can't be recorded for future dates or dates outside an academic year; finalising requires every student on the list to be marked.
- Take attendance: `attendance.take` = classes/streams the staff member teaches (class OR subject teacher assignment); `attendance.take_any` = all. Reports/registers visible with `attendance.read` (all) or `attendance.read_assigned`.
- Absence alerts are created only for ABSENT (not Late/Excused), per guardian with `receivesNotifications`; a correction away from Absent cancels a still-pending alert; one event per record+guardian ever.
- Applicant duplicate rules: an OPEN application for the same child (name+DOB or birth certificate) is refused outright; a matching existing student needs explicit confirmation. Application numbers `APP/<year>/<seq>` come from the shared counter table (scope `APP:<year>`).
- Import: error and duplicate rows are never imported; shared guardian phones need explicit confirmation and never link to the existing guardian; same guardian name+phone inside one file = one guardian (siblings); admission numbers given in the file are kept and must be unique, generated ones skip taken numbers; dates are day-first.
