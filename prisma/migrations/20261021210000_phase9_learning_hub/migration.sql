-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED');

-- CreateEnum
CREATE TYPE "SubmissionState" AS ENUM ('SUBMITTED', 'RETURNED', 'GRADED');

-- CreateEnum
CREATE TYPE "SubmissionVia" AS ENUM ('ONLINE', 'PAPER');

-- CreateEnum
CREATE TYPE "LearningFileOwner" AS ENUM ('ASSIGNMENT', 'SUBMISSION', 'PORTFOLIO');

-- CreateEnum
CREATE TYPE "PortfolioStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REMOVED');

-- CreateEnum
CREATE TYPE "BehaviourType" AS ENUM ('POSITIVE', 'CONCERN', 'INCIDENT');

-- CreateTable
CREATE TABLE "timetable_periods" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "isBreak" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "timetable_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timetable_entries" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "streamId" UUID,
    "dayOfWeek" INTEGER NOT NULL,
    "periodId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "teacherStaffId" UUID,
    "room" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timetable_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schemes_of_work" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "termId" UUID,
    "classId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "teacherStaffId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewNote" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schemes_of_work_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheme_weeks" (
    "id" UUID NOT NULL,
    "schemeId" UUID NOT NULL,
    "weekNo" INTEGER NOT NULL,
    "topic" TEXT NOT NULL,
    "objectives" TEXT,
    "activities" TEXT,
    "resources" TEXT,
    "assessment" TEXT,
    "periods" INTEGER,

    CONSTRAINT "scheme_weeks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_plans" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "streamId" UUID,
    "subjectId" UUID NOT NULL,
    "teacherStaffId" UUID NOT NULL,
    "lessonDate" DATE NOT NULL,
    "topic" TEXT NOT NULL,
    "objectives" TEXT NOT NULL,
    "activities" TEXT NOT NULL,
    "resources" TEXT,
    "assessment" TEXT,
    "homework" TEXT,
    "reflection" TEXT,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewNote" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "streamId" UUID,
    "subjectId" UUID NOT NULL,
    "teacherStaffId" UUID,
    "createdById" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "maxScore" DECIMAL(6,2),
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_submissions" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "via" "SubmissionVia" NOT NULL DEFAULT 'ONLINE',
    "text" TEXT,
    "state" "SubmissionState" NOT NULL DEFAULT 'SUBMITTED',
    "late" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" DECIMAL(6,2),
    "feedback" TEXT,
    "gradedById" UUID,
    "gradedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_files" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "ownerKind" "LearningFileOwner" NOT NULL,
    "ownerId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "learning_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_items" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "subjectId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdById" UUID NOT NULL,
    "createdByStudent" BOOLEAN NOT NULL DEFAULT false,
    "status" "PortfolioStatus" NOT NULL DEFAULT 'PENDING',
    "teacherComment" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "behaviour_records" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "occurredOn" DATE NOT NULL,
    "type" "BehaviourType" NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "action" TEXT,
    "sharedWithFamily" BOOLEAN NOT NULL DEFAULT false,
    "recordedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" UUID,
    "voidReason" TEXT,

    CONSTRAINT "behaviour_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "timetable_periods_schoolId_sequence_key" ON "timetable_periods"("schoolId", "sequence");

-- CreateIndex
CREATE INDEX "timetable_entries_schoolId_academicYearId_classId_idx" ON "timetable_entries"("schoolId", "academicYearId", "classId");

-- CreateIndex
CREATE INDEX "timetable_entries_teacherStaffId_idx" ON "timetable_entries"("teacherStaffId");

-- CreateIndex

-- CreateIndex
CREATE INDEX "schemes_of_work_schoolId_teacherStaffId_idx" ON "schemes_of_work"("schoolId", "teacherStaffId");

-- CreateIndex
CREATE INDEX "schemes_of_work_schoolId_status_idx" ON "schemes_of_work"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "scheme_weeks_schemeId_weekNo_key" ON "scheme_weeks"("schemeId", "weekNo");

-- CreateIndex
CREATE INDEX "lesson_plans_schoolId_teacherStaffId_lessonDate_idx" ON "lesson_plans"("schoolId", "teacherStaffId", "lessonDate");

-- CreateIndex
CREATE INDEX "lesson_plans_schoolId_status_idx" ON "lesson_plans"("schoolId", "status");

-- CreateIndex
CREATE INDEX "assignments_schoolId_classId_publishedAt_idx" ON "assignments"("schoolId", "classId", "publishedAt");

-- CreateIndex
CREATE INDEX "assignments_schoolId_teacherStaffId_idx" ON "assignments"("schoolId", "teacherStaffId");

-- CreateIndex
CREATE INDEX "assignment_submissions_schoolId_studentId_idx" ON "assignment_submissions"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submissions_assignmentId_studentId_key" ON "assignment_submissions"("assignmentId", "studentId");

-- CreateIndex
CREATE INDEX "learning_files_ownerKind_ownerId_idx" ON "learning_files"("ownerKind", "ownerId");

-- CreateIndex
CREATE INDEX "portfolio_items_schoolId_studentId_status_idx" ON "portfolio_items"("schoolId", "studentId", "status");

-- CreateIndex
CREATE INDEX "behaviour_records_schoolId_studentId_occurredOn_idx" ON "behaviour_records"("schoolId", "studentId", "occurredOn");

-- AddForeignKey
ALTER TABLE "timetable_periods" ADD CONSTRAINT "timetable_periods_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "timetable_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schemes_of_work" ADD CONSTRAINT "schemes_of_work_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_weeks" ADD CONSTRAINT "scheme_weeks_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "schemes_of_work"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_plans" ADD CONSTRAINT "lesson_plans_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_files" ADD CONSTRAINT "learning_files_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behaviour_records" ADD CONSTRAINT "behaviour_records_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══ Learning hub integrity ═══

ALTER TABLE "timetable_periods" ADD CONSTRAINT "timetable_periods_time_check" CHECK ("startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "endTime" > "startTime");
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_day_check" CHECK ("dayOfWeek" BETWEEN 1 AND 7);
-- A class or stream has one lesson per period (NULLS NOT DISTINCT so the "whole class" entry counts too),
-- a teacher is in one place per period, a room hosts one lesson per period.
CREATE UNIQUE INDEX "timetable_class_slot_unique" ON "timetable_entries" ("academicYearId", "classId", "streamId", "dayOfWeek", "periodId") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX "timetable_teacher_slot_unique" ON "timetable_entries" ("academicYearId", "teacherStaffId", "dayOfWeek", "periodId") WHERE "teacherStaffId" IS NOT NULL;
CREATE UNIQUE INDEX "timetable_room_slot_unique" ON "timetable_entries" ("academicYearId", lower("room"), "dayOfWeek", "periodId") WHERE "room" IS NOT NULL;

ALTER TABLE "scheme_weeks" ADD CONSTRAINT "scheme_weeks_week_check" CHECK ("weekNo" BETWEEN 1 AND 60);
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_score_check" CHECK ("maxScore" IS NULL OR "maxScore" > 0);
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_score_check" CHECK ("score" IS NULL OR "score" >= 0);
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_graded_check" CHECK ("state" <> 'GRADED' OR ("gradedById" IS NOT NULL AND "gradedAt" IS NOT NULL));
ALTER TABLE "learning_files" ADD CONSTRAINT "learning_files_size_check" CHECK ("sizeBytes" > 0);

ALTER TABLE "behaviour_records" ADD CONSTRAINT "behaviour_records_void_check" CHECK ("voidedAt" IS NULL OR ("voidedById" IS NOT NULL AND "voidReason" IS NOT NULL));
CREATE FUNCTION behaviour_records_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'behaviour records cannot be deleted; void them instead';
  END IF;
  IF NEW."description" <> OLD."description" OR NEW."studentId" <> OLD."studentId" OR NEW."type" <> OLD."type" OR NEW."occurredOn" <> OLD."occurredOn" OR NEW."recordedById" <> OLD."recordedById" THEN
    RAISE EXCEPTION 'a behaviour record cannot be edited; void it and record it again';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER behaviour_records_no_edit BEFORE UPDATE OR DELETE ON "behaviour_records" FOR EACH ROW EXECUTE FUNCTION behaviour_records_guard();
