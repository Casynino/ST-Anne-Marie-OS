# Deployment, release and recovery runbook

Audience: whoever hosts the system (Nino). Everything here is checked against the code; steps marked **YOU** need your accounts.

## 1. What runs where
| Part | Where | Notes |
|---|---|---|
| Web app (Next.js 16) | Vercel | One project. Every push to the connected branch starts a paid build, so push only when a result is ready. |
| Database | Neon (PostgreSQL) | Production data. Local development uses Homebrew PostgreSQL (`stanne_dev`, `stanne_test`). |
| Uploaded files (documents, homework, portfolio) | S3-compatible bucket (Cloudflare R2 recommended) | **Not configured yet.** Until it is, file uploads are refused with a clear message; text hand-ins still work. |
| Backups | A computer or scheduled job you control | See section 5. Not done by Vercel. |

## 2. Environment variables (Vercel → Project → Settings → Environment Variables, Production)
| Name | Required | Value / purpose |
|---|---|---|
| `DATABASE_URL` | yes | Neon connection string (the **pooled** host is fine for the app). Never commit it. |
| `APP_URL` | yes | The public address, for example `https://your-domain`. Used in links and metadata. |
| `CRON_SECRET` | yes | A long random string. Vercel sends it as `Authorization: Bearer …` to the notification worker (`vercel.json` calls it once a day at 05:00 UTC = 08:00 Dar es Salaam). Hourly runs need Vercel Pro or an outside scheduler that calls `GET /api/jobs/notifications` with the same header. |
| `STORAGE_DRIVER` | for files | `s3`, with `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION` (`auto` for R2), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. The S3 adapter was tested against the signature test vectors but **not against a live bucket**: upload and download one test file as the first thing you do after configuring. |
| `DOCUMENT_MAX_BYTES` | no | Default 4 MB (Vercel accepts about 4.5 MB request bodies). |
| `PAYMENTS_<PROVIDER>_WEBHOOK_SECRET`, `PAYMENTS_SCHOOL_CODE` | later | Only when the school chooses a payment provider. Empty = the endpoint refuses everything. |
| `SMS_<PROVIDER>_WEBHOOK_SECRET` | later | Only when an SMS provider is connected. Until then SMS is recorded as "skipped", never "sent". |
`BOOTSTRAP_ADMIN_*` are used once, from a terminal, never stored on Vercel.

## 3. First production setup (once)
1. Create the Neon project. Use the **direct** (non-pooler) connection string for the steps below.
2. From your computer, in the project folder, with the production string in a variable (not in `.env`):
   ```bash
   DATABASE_URL="<direct neon url>" npx prisma migrate deploy
   DATABASE_URL="<direct neon url>" BOOTSTRAP_ADMIN_NAME="…" BOOTSTRAP_ADMIN_EMAIL="…" BOOTSTRAP_ADMIN_PASSWORD="<one-off password>" npm run db:bootstrap
   ```
   This creates the tables, the permission catalogue, the school, the default roles and the first Super Admin (who must change the password at the first sign-in). **Never run any seed or demo script, and never `prisma migrate reset`, against production.**
3. In Vercel set the variables in section 2, connect the repository, deploy.
4. Open the site, sign in as the Super Admin, change the password, then follow `docs/manuals/ADMIN.md` (academic year, classes, subjects, teachers, users, fees, grading scale, website content).
5. Set up backups (section 5) **before** real data is entered.

## 4. Releasing a change
1. Test on your computer first: `npm run typecheck`, `npm test`, and `NEXT_DIST_DIR=.next-build npx next build`.
2. Run migrations on production **before** the new code starts using them: `DATABASE_URL="<direct url>" npx prisma migrate deploy`. Then `npm run db:bootstrap` with the same variable so any new permissions are registered (it never re-grants permissions an administrator removed). New permissions are given only to the roles that should have them; check **Roles** afterwards.
3. Push. Vercel builds and deploys. Look at the site and at **Settings → Backups** once.
4. Rolling back code: redeploy the previous Vercel deployment. Migrations are written to be additive; if one must be undone, restore from backup rather than editing the database by hand.

## 5. Backups and restore
Neon keeps a short history for point-in-time restore (length depends on your plan) and that is a convenience, not a backup you control. Make your own:
- **Nightly backup:** `npm run db:backup` on any computer with PostgreSQL client tools of the **same or newer major version** than the Neon server (`pg_dump --version`). It takes a consistent snapshot, writes `backups/stanne-YYYYMMDD-HHMMSSZ.dump`, records its SHA-256 and the row count of every table in `backup_runs`, and (with `BACKUP_UPLOAD=s3`) also copies it to the bucket under `backups/`. It keeps the newest 14 local copies. Use the **direct** Neon string as `DATABASE_URL`. A ready-to-copy GitHub Actions workflow is in `docs/backup-workflow.example.yml` (not installed, because pushing workflow files needs extra GitHub permission).
- **Monthly restore test:** create an empty scratch database whose name ends in `_restore`, set `RESTORE_TEST_DATABASE_URL`, run `npm run db:backup -- --verify`. It refuses any other target, checks the file against its recorded checksum, restores it and compares every table's row count. A passing test is recorded and shown on **Settings → Backups**; so is a failing one.
- **If something goes wrong in production:** (1) stop writes (put the Vercel project on a maintenance deployment or pause it); (2) create a new Neon branch or database; (3) `pg_restore --no-owner --no-privileges --dbname=<new database> <file>`; (4) point `DATABASE_URL` at it; (5) check **Settings → Backups** and a few students, invoices and payments; (6) note what happened in the audit trail (add a note to the school's records) and tell the staff what was lost between the backup time and the incident.
- The dashboard shows the Super Admin an attention item when the newest backup is older than 26 hours (or none exists). If you see it, backups are not running.

## 6. Security checklist (done in code; verify after deploy)
- Responses carry `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and (production) a Content-Security-Policy that allows only the site's own origin (inline scripts and styles are allowed because Next.js streams page data inline).
- Sessions: random token in an HttpOnly, SameSite=Lax cookie (Secure in production), stored hashed; passwords are scrypt hashes; sign-in attempts are rate-limited in the database.
- Every API route needs a session, the cron secret or a valid HMAC signature; every form action goes through the permission-checked wrapper (an automated test reads the source and fails if a new route or action skips this).
- Documents, receipts, invoices, report cards, exports and homework files are served only by routes that re-check permission on every request and are never cached.
- Rotate any secret that was ever pasted into a chat, an e-mail or a ticket. **The Neon password you shared in the conversation should be rotated** (Neon console → Roles → Reset password) and then updated in Vercel.
- `npm audit --omit=dev` should be run before big releases.

## 7. Known limits (honest list)
- 5,000 students were tested on a laptop database: student lists and searches under 10 ms, dashboard about 1.1 s, finance reports 0.5–0.7 s, a 60-card report PDF 0.3 s, a 5,000-row export under 0.2 s. Beyond about 20,000 invoices per term the balance calculations (done in application memory) should be moved into the database.
- SMS and mobile-money collection need the school's chosen provider and credentials; the system never shows a message as delivered or a payment as received without the provider's signed confirmation.
- Swahili text was written by the assistant; have a Kiswahili speaker at the school read the screens and the parent manual before launch.
- No official Tanzanian grading bands are built in: the school enters its own scale (**Grading**), and the first report cards should be checked against its official policy.
