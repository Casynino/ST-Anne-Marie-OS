# St Anne Marie Schools OS

School management system for St Anne Marie Schools (Tanzania). Real operational system: never add fake students/payments to production. Full requirements digest: `docs/REQUIREMENTS.md`. Build status and next steps: `docs/PROGRESS.md`. Global rules in `~/.claude/CLAUDE.md` apply (notably: **never `git push` or deploy unless Nino says "push"**; commit locally is fine).

## Stack
Next.js 16 (App Router, Turbopack) · TypeScript strict · React 19 · Tailwind 4 · Prisma 7 + `@prisma/adapter-pg` · PostgreSQL (local 16 for dev/test; Neon for production) · Zod 4 · Vitest. No Redis, no separate backend. Node ≥ 22.18.

## Commands
- `npm run dev` — dev server (port 3000). `npm run build` — `prisma generate` + `next build`.
- `npm run typecheck` · `npm test` (all) · `npm run test:unit`.
- `npm run db:migrate` — dev migration (interactive; hangs in non-TTY, so use `prisma migrate dev --create-only` then `migrate deploy`/`migrate dev`). `npm run db:bootstrap` — idempotent: permission catalog, school `SAM`, default roles, first Super Admin from `BOOTSTRAP_ADMIN_*` env (only if the school has no users).
- Drift check (non-interactive): `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script < /dev/null` must print an empty migration.

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

## Decided business rules (Phase 1)
- One ACTIVE enrollment per student per academic year (DB-enforced); moves/year changes close the old row (`MOVED`/`COMPLETED`), history is kept. Status changes (transfer/withdraw/graduate) require a reason and close the active enrollment; reinstatement returns to Enrolled (class placement is a separate step).
- Student needs ≥1 guardian at registration; exactly one primary guardian; last/primary guardian can't be unlinked; changing a relationship clears its verification.
- Medical notes: read needs `student.medical.read`; editing needs read + update; note content is never written to the audit log (views are audited).
- Teachers (`student.read_assigned`) only see students in classes/streams they teach in the current year.
- Duplicate student (same name + DOB) and shared guardian phone require explicit confirmation.
