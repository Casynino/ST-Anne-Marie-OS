-- CreateEnum
CREATE TYPE "BroadcastKind" AS ENUM ('ANNOUNCEMENT', 'FEE_REMINDER');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('ABSENCE', 'FEES', 'RESULTS', 'ANNOUNCEMENTS');

-- CreateEnum
CREATE TYPE "ThreadStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageVisibility" AS ENUM ('VISIBLE', 'HIDDEN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationEventType" ADD VALUE 'ANNOUNCEMENT';
ALTER TYPE "NotificationEventType" ADD VALUE 'FEE_REMINDER';
ALTER TYPE "NotificationEventType" ADD VALUE 'RESULTS_READY';

-- DropForeignKey
ALTER TABLE "in_app_notifications" DROP CONSTRAINT "in_app_notifications_eventId_fkey";

-- AlterTable
ALTER TABLE "in_app_notifications" ADD COLUMN     "link" TEXT,
ALTER COLUMN "eventId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "notification_events" ADD COLUMN     "broadcastId" UUID;

-- CreateTable
CREATE TABLE "broadcasts" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "kind" "BroadcastKind" NOT NULL,
    "title" TEXT NOT NULL,
    "bodyEn" TEXT NOT NULL,
    "bodySw" TEXT,
    "audience" JSONB NOT NULL,
    "sendSms" BOOLEAN NOT NULL DEFAULT true,
    "sendInApp" BOOLEAN NOT NULL DEFAULT true,
    "sendAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "locale" "Locale" NOT NULL,
    "body" TEXT NOT NULL,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_threads" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "guardianUserId" UUID NOT NULL,
    "staffUserId" UUID,
    "subject" TEXT NOT NULL,
    "status" "ThreadStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guardianReadAt" TIMESTAMP(3),
    "staffReadAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" UUID,

    CONSTRAINT "message_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread_messages" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "senderUserId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "MessageVisibility" NOT NULL DEFAULT 'VISIBLE',
    "hiddenById" UUID,
    "hiddenReason" TEXT,
    "hiddenAt" TIMESTAMP(3),
    "flaggedById" UUID,
    "flaggedAt" TIMESTAMP(3),
    "flagReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thread_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "broadcasts_schoolId_createdAt_idx" ON "broadcasts"("schoolId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_category_key" ON "notification_preferences"("userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_schoolId_key_locale_key" ON "message_templates"("schoolId", "key", "locale");

-- CreateIndex
CREATE INDEX "message_threads_schoolId_lastMessageAt_idx" ON "message_threads"("schoolId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "message_threads_guardianUserId_idx" ON "message_threads"("guardianUserId");

-- CreateIndex
CREATE INDEX "message_threads_staffUserId_idx" ON "message_threads"("staffUserId");

-- CreateIndex
CREATE INDEX "thread_messages_threadId_createdAt_idx" ON "thread_messages"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "thread_messages_flaggedAt_idx" ON "thread_messages"("flaggedAt");

-- CreateIndex
CREATE INDEX "notification_events_broadcastId_idx" ON "notification_events"("broadcastId");

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "broadcasts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "notification_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "message_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Messages: bounded text; a hidden message must say who hid it and why; messages are never deleted or edited.
ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_body_check" CHECK (char_length("body") BETWEEN 1 AND 2000);
ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_hidden_check" CHECK ("visibility" <> 'HIDDEN' OR ("hiddenById" IS NOT NULL AND "hiddenReason" IS NOT NULL AND "hiddenAt" IS NOT NULL));
CREATE FUNCTION thread_messages_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'messages cannot be deleted';
  END IF;
  IF NEW."body" <> OLD."body" OR NEW."senderUserId" <> OLD."senderUserId" OR NEW."threadId" <> OLD."threadId" THEN
    RAISE EXCEPTION 'a message cannot be edited';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER thread_messages_no_edit BEFORE UPDATE OR DELETE ON "thread_messages" FOR EACH ROW EXECUTE FUNCTION thread_messages_guard();

ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_channel_check" CHECK ("sendSms" OR "sendInApp");
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_body_check" CHECK (char_length("bodyEn") BETWEEN 1 AND 640);
