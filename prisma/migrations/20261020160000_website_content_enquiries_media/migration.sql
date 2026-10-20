-- CreateEnum
CREATE TYPE "EnquiryStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'RESOLVED');

-- AlterTable
ALTER TABLE "announcements" ADD COLUMN     "barLink" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "coverImage" TEXT,
ADD COLUMN     "excerpt" TEXT,
ADD COLUMN     "showInBar" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "slug" TEXT;

-- AlterTable
ALTER TABLE "school_events" ADD COLUMN     "category" TEXT,
ADD COLUMN     "coverImage" TEXT;

-- CreateTable
CREATE TABLE "enquiries" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "topic" TEXT,
    "message" TEXT NOT NULL,
    "status" "EnquiryStatus" NOT NULL DEFAULT 'NEW',
    "consentAt" TIMESTAMP(3) NOT NULL,
    "internalNote" TEXT,
    "handledById" UUID,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "alt" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enquiries_schoolId_status_createdAt_idx" ON "enquiries"("schoolId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "media_assets_schoolId_createdAt_idx" ON "media_assets"("schoolId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "announcements_schoolId_slug_key" ON "announcements"("schoolId", "slug");

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Media assets: bounded size so a bad upload cannot bloat the database.
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_size_check" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 2097152);
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_dimensions_check" CHECK ("width" > 0 AND "height" > 0);
