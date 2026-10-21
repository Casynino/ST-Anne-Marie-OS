-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "entryType" TEXT NOT NULL DEFAULT 'NEW',
ADD COLUMN     "previousAdmissionNo" TEXT,
ADD COLUMN     "transferReason" TEXT;

ALTER TABLE "applications" ADD CONSTRAINT "applications_entry_type_check" CHECK ("entryType" IN ('NEW', 'TRANSFER'));
