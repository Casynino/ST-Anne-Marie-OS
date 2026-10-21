-- DropForeignKey
ALTER TABLE "application_drafts" DROP CONSTRAINT "application_drafts_userId_fkey";

-- AlterTable
ALTER TABLE "application_drafts" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'ONLINE',
ADD COLUMN     "createdById" UUID,
ADD COLUMN     "paymentMethod" TEXT,
ADD COLUMN     "paymentNote" TEXT,
ADD COLUMN     "paymentRecordedById" UUID,
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "application_drafts_schoolId_channel_status_idx" ON "application_drafts"("schoolId", "channel", "status");

-- AddForeignKey
ALTER TABLE "application_drafts" ADD CONSTRAINT "application_drafts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- An application is either the family's own (it has an account) or was filled in at the office (it says who did it).
ALTER TABLE "application_drafts" ADD CONSTRAINT "application_drafts_owner_chk" CHECK (
  ("channel" = 'ONLINE' AND "userId" IS NOT NULL) OR ("channel" = 'OFFICE' AND "createdById" IS NOT NULL)
);
