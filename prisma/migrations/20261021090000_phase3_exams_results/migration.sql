-- CreateEnum
CREATE TYPE "ExamCategory" AS ENUM ('MONTHLY', 'MIDTERM', 'TERMINAL', 'ANNUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "MarkStatus" AS ENUM ('SCORED', 'ABSENT', 'EXEMPT');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'LOCKED', 'RETURNED');

-- CreateTable
CREATE TABLE "grading_scales" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "levelId" UUID,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "passMark" DECIMAL(5,2),
    "divisionBestN" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grading_scales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_bands" (
    "id" UUID NOT NULL,
    "scaleId" UUID NOT NULL,
    "grade" TEXT NOT NULL,
    "minPercent" DECIMAL(5,2) NOT NULL,
    "maxPercent" DECIMAL(5,2) NOT NULL,
    "points" INTEGER,
    "remark" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "grade_bands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "division_rules" (
    "id" UUID NOT NULL,
    "scaleId" UUID NOT NULL,
    "division" TEXT NOT NULL,
    "minPoints" INTEGER NOT NULL,
    "maxPoints" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "division_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "termId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ExamCategory" NOT NULL DEFAULT 'TERMINAL',
    "examDate" DATE,
    "maxMarks" DECIMAL(6,2) NOT NULL DEFAULT 100,
    "weight" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "submissionDeadline" DATE,
    "gradingScaleId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_subjects" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "maxMarks" DECIMAL(6,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_submissions" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "examSubjectId" UUID NOT NULL,
    "streamId" UUID,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedById" UUID,
    "submittedAt" TIMESTAMP(3),
    "returnReason" TEXT,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "lockedById" UUID,
    "lockedAt" TIMESTAMP(3),
    "unlockedById" UUID,
    "unlockedAt" TIMESTAMP(3),
    "unlockReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "result_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marks" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "examSubjectId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "status" "MarkStatus" NOT NULL,
    "score" DECIMAL(6,2),
    "enteredById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lockedPercent" DECIMAL(5,2),
    "lockedGrade" TEXT,
    "lockedPoints" INTEGER,
    "lockedScaleId" UUID,

    CONSTRAINT "marks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_changes" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "examSubjectId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "oldStatus" "MarkStatus",
    "oldScore" DECIMAL(6,2),
    "newStatus" "MarkStatus",
    "newScore" DECIMAL(6,2),
    "reason" TEXT,
    "changedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "result_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "grading_scales_schoolId_name_key" ON "grading_scales"("schoolId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "grade_bands_scaleId_grade_key" ON "grade_bands"("scaleId", "grade");

-- CreateIndex
CREATE UNIQUE INDEX "division_rules_scaleId_division_key" ON "division_rules"("scaleId", "division");

-- CreateIndex
CREATE INDEX "exams_schoolId_termId_idx" ON "exams"("schoolId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "exams_schoolId_termId_name_key" ON "exams"("schoolId", "termId", "name");

-- CreateIndex
CREATE INDEX "exam_subjects_schoolId_classId_idx" ON "exam_subjects"("schoolId", "classId");

-- CreateIndex
CREATE UNIQUE INDEX "exam_subjects_examId_classId_subjectId_key" ON "exam_subjects"("examId", "classId", "subjectId");

-- CreateIndex
CREATE INDEX "result_submissions_schoolId_status_idx" ON "result_submissions"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "result_submissions_unit_unique" ON "result_submissions"("examSubjectId", "streamId");

-- CreateIndex
CREATE INDEX "marks_schoolId_studentId_idx" ON "marks"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "marks_examSubjectId_studentId_key" ON "marks"("examSubjectId", "studentId");

-- CreateIndex
CREATE INDEX "result_changes_schoolId_examSubjectId_studentId_idx" ON "result_changes"("schoolId", "examSubjectId", "studentId");

-- AddForeignKey
ALTER TABLE "grading_scales" ADD CONSTRAINT "grading_scales_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_bands" ADD CONSTRAINT "grade_bands_scaleId_fkey" FOREIGN KEY ("scaleId") REFERENCES "grading_scales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "division_rules" ADD CONSTRAINT "division_rules_scaleId_fkey" FOREIGN KEY ("scaleId") REFERENCES "grading_scales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_submissions" ADD CONSTRAINT "result_submissions_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_submissions" ADD CONSTRAINT "result_submissions_examSubjectId_fkey" FOREIGN KEY ("examSubjectId") REFERENCES "exam_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "marks_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "marks_examSubjectId_fkey" FOREIGN KEY ("examSubjectId") REFERENCES "exam_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_changes" ADD CONSTRAINT "result_changes_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One submission per exam-subject and stream; streamId is optional so NULLs must compare equal.
DROP INDEX IF EXISTS "result_submissions_unit_unique";
CREATE UNIQUE INDEX "result_submissions_unit_unique" ON "result_submissions" ("examSubjectId", "streamId") NULLS NOT DISTINCT;

-- Marks: a score exists exactly when the status is SCORED, and is never negative.
ALTER TABLE "marks" ADD CONSTRAINT "marks_score_state_check" CHECK (("status" = 'SCORED') = ("score" IS NOT NULL));
ALTER TABLE "marks" ADD CONSTRAINT "marks_score_nonneg_check" CHECK ("score" IS NULL OR "score" >= 0);
ALTER TABLE "exams" ADD CONSTRAINT "exams_max_check" CHECK ("maxMarks" > 0 AND "weight" > 0 AND "weight" <= 100);
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_max_check" CHECK ("maxMarks" > 0);
ALTER TABLE "grade_bands" ADD CONSTRAINT "grade_bands_range_check" CHECK ("minPercent" >= 0 AND "maxPercent" <= 100 AND "minPercent" <= "maxPercent");
ALTER TABLE "division_rules" ADD CONSTRAINT "division_rules_range_check" CHECK ("minPoints" <= "maxPoints");
-- A locked submission always records who locked it and when.
ALTER TABLE "result_submissions" ADD CONSTRAINT "result_submissions_locked_check" CHECK ("status" <> 'LOCKED' OR ("lockedAt" IS NOT NULL AND "lockedById" IS NOT NULL));
-- Only one default scale per school.
CREATE UNIQUE INDEX "grading_scales_one_default" ON "grading_scales" ("schoolId") WHERE "isDefault";
-- Result history is append-only.
CREATE FUNCTION result_changes_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'result_changes is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER result_changes_no_change BEFORE UPDATE OR DELETE ON "result_changes"
  FOR EACH ROW EXECUTE FUNCTION result_changes_append_only();
