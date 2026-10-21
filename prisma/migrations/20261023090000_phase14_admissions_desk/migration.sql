-- AlterEnum
ALTER TYPE "ReviewStatus" ADD VALUE 'IN_REVIEW';

-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignedToId" UUID,
ADD COLUMN     "interviewWaivedAt" TIMESTAMP(3),
ADD COLUMN     "interviewWaivedById" UUID,
ADD COLUMN     "interviewWaivedReason" TEXT;

-- AlterTable
ALTER TABLE "interviews" ADD COLUMN     "arrangement" TEXT NOT NULL DEFAULT 'SCHEDULED';

-- CreateTable
CREATE TABLE "application_notices" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "application_notices_applicationId_idx" ON "application_notices"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "application_notices_schoolId_dedupeKey_key" ON "application_notices"("schoolId", "dedupeKey");

-- CreateIndex
CREATE INDEX "applications_schoolId_assignedToId_idx" ON "applications"("schoolId", "assignedToId");

-- AddForeignKey
ALTER TABLE "application_notices" ADD CONSTRAINT "application_notices_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_notices" ADD CONSTRAINT "application_notices_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
