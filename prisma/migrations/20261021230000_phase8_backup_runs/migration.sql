-- CreateEnum
CREATE TYPE "BackupKind" AS ENUM ('BACKUP', 'RESTORE_TEST');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" UUID NOT NULL,
    "kind" "BackupKind" NOT NULL DEFAULT 'BACKUP',
    "status" "BackupStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fileName" TEXT,
    "sizeBytes" BIGINT,
    "sha256" TEXT,
    "location" TEXT,
    "rowCounts" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_runs_kind_status_finishedAt_idx" ON "backup_runs"("kind", "status", "finishedAt");


-- A backup record is history: it can be added by the backup scripts but never changed or removed.
CREATE FUNCTION backup_runs_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'backup records are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER backup_runs_append_only BEFORE UPDATE OR DELETE ON "backup_runs" FOR EACH ROW EXECUTE FUNCTION backup_runs_guard();
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_success_has_file" CHECK ("status" <> 'SUCCESS' OR ("sha256" IS NOT NULL AND "sizeBytes" IS NOT NULL AND "sizeBytes" > 0));
