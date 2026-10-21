-- AlterTable
ALTER TABLE "application_drafts" ADD COLUMN     "confirmedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "emergencyContact" JSONB,
ADD COLUMN     "healthNotes" TEXT,
ADD COLUMN     "previousClass" TEXT;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "draftId" UUID;

-- CreateIndex
CREATE INDEX "documents_schoolId_draftId_idx" ON "documents"("schoolId", "draftId");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "application_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A document may now belong to a family's application draft (before the application exists); it keeps that link after submission.
ALTER TABLE "documents" DROP CONSTRAINT "documents_owner_check";
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_check" CHECK ("applicationId" IS NOT NULL OR "studentId" IS NOT NULL OR "draftId" IS NOT NULL);
