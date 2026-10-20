-- CreateEnum
CREATE TYPE "ApplicationSource" AS ENUM ('STAFF', 'ONLINE');

-- AlterTable
ALTER TABLE "application_events" ALTER COLUMN "byUserId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "consentAt" TIMESTAMP(3),
ADD COLUMN     "source" "ApplicationSource" NOT NULL DEFAULT 'STAFF',
ALTER COLUMN "createdById" DROP NOT NULL;

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "titleSw" TEXT,
    "body" TEXT NOT NULL,
    "bodySw" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_events" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "titleSw" TEXT,
    "description" TEXT,
    "descriptionSw" TEXT,
    "location" TEXT,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_events" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "announcements_schoolId_publishedAt_idx" ON "announcements"("schoolId", "publishedAt");

-- CreateIndex
CREATE INDEX "school_events_schoolId_startsOn_idx" ON "school_events"("schoolId", "startsOn");

-- CreateIndex
CREATE INDEX "rate_limit_events_key_createdAt_idx" ON "rate_limit_events"("key", "createdAt");

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_events" ADD CONSTRAINT "school_events_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Events cannot end before they start.
ALTER TABLE "school_events" ADD CONSTRAINT "school_events_dates_check" CHECK ("endsOn" IS NULL OR "endsOn" >= "startsOn");
