-- CreateEnum
CREATE TYPE "ProgressionOutcome" AS ENUM ('PROMOTED', 'REPEAT', 'PENDING_REVIEW', 'COMPLETED', 'WITHDRAWN', 'TRANSFERRED');

-- CreateEnum
CREATE TYPE "ProgressionStatus" AS ENUM ('DRAFT', 'AWAITING_HEAD', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'REGISTERED', 'ACTIVE', 'CANCELLED');

-- AlterTable
ALTER TABLE "academic_years" ADD COLUMN     "registrationClosesOn" DATE,
ADD COLUMN     "registrationOpensOn" DATE;

-- AlterTable
ALTER TABLE "classes" ADD COLUMN     "isFinalGrade" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nextClassId" UUID;

-- CreateTable
CREATE TABLE "student_progressions" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "fromAcademicYearId" UUID NOT NULL,
    "fromEnrollmentId" UUID,
    "fromClassId" UUID NOT NULL,
    "fromStreamId" UUID,
    "outcome" "ProgressionOutcome" NOT NULL,
    "status" "ProgressionStatus" NOT NULL DEFAULT 'DRAFT',
    "toClassId" UUID,
    "note" TEXT,
    "exceptionReason" TEXT,
    "evidence" JSONB,
    "preparedById" UUID NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "headApprovedById" UUID,
    "headApprovedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_progressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "annual_registrations" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "progressionId" UUID NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "classId" UUID,
    "streamId" UUID,
    "placedById" UUID,
    "placedAt" TIMESTAMP(3),
    "capacityOverrideReason" TEXT,
    "gradeOverrideReason" TEXT,
    "registeredById" UUID,
    "registeredAt" TIMESTAMP(3),
    "confirmations" JSONB,
    "clearanceExceptionReason" TEXT,
    "clearanceExceptionById" UUID,
    "clearanceExceptionAt" TIMESTAMP(3),
    "activatedById" UUID,
    "activatedAt" TIMESTAMP(3),
    "enrollmentId" UUID,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "annual_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_progressions_schoolId_fromAcademicYearId_status_idx" ON "student_progressions"("schoolId", "fromAcademicYearId", "status");

-- CreateIndex
CREATE INDEX "student_progressions_studentId_idx" ON "student_progressions"("studentId");

-- CreateIndex
CREATE INDEX "annual_registrations_schoolId_academicYearId_status_idx" ON "annual_registrations"("schoolId", "academicYearId", "status");

-- CreateIndex
CREATE INDEX "annual_registrations_schoolId_academicYearId_classId_idx" ON "annual_registrations"("schoolId", "academicYearId", "classId");

-- CreateIndex
CREATE UNIQUE INDEX "annual_registrations_studentId_academicYearId_key" ON "annual_registrations"("studentId", "academicYearId");

-- AddForeignKey
ALTER TABLE "student_progressions" ADD CONSTRAINT "student_progressions_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_progressions" ADD CONSTRAINT "student_progressions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_progressions" ADD CONSTRAINT "student_progressions_fromAcademicYearId_fkey" FOREIGN KEY ("fromAcademicYearId") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annual_registrations" ADD CONSTRAINT "annual_registrations_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annual_registrations" ADD CONSTRAINT "annual_registrations_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annual_registrations" ADD CONSTRAINT "annual_registrations_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annual_registrations" ADD CONSTRAINT "annual_registrations_progressionId_fkey" FOREIGN KEY ("progressionId") REFERENCES "student_progressions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One live decision per student and academic year (a superseded decision stays as history).
CREATE UNIQUE INDEX "student_progressions_one_live" ON "student_progressions" ("studentId", "fromAcademicYearId") WHERE "status" <> 'SUPERSEDED';

-- A final decision names who approved it and, when the student goes on or repeats, the grade.
ALTER TABLE "student_progressions" ADD CONSTRAINT "student_progressions_approved_has_approver" CHECK ("status" <> 'APPROVED' OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL));
ALTER TABLE "student_progressions" ADD CONSTRAINT "student_progressions_grade_for_move" CHECK ("status" <> 'APPROVED' OR "outcome" NOT IN ('PROMOTED', 'REPEAT') OR "toClassId" IS NOT NULL);

-- An approved decision is never edited or deleted: a revision supersedes it (the row stays for the history).
CREATE FUNCTION student_progressions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'progression decisions cannot be deleted';
  END IF;
  IF OLD."status" = 'APPROVED' AND NEW."status" <> 'SUPERSEDED' THEN
    RAISE EXCEPTION 'an approved progression decision cannot be changed; supersede it with a revision';
  END IF;
  IF OLD."status" = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'a superseded progression decision is history and cannot be changed';
  END IF;
  IF NEW."studentId" <> OLD."studentId" OR NEW."fromAcademicYearId" <> OLD."fromAcademicYearId" OR NEW."schoolId" <> OLD."schoolId" THEN
    RAISE EXCEPTION 'a progression decision stays with its student and year';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER student_progressions_no_edit BEFORE UPDATE OR DELETE ON "student_progressions" FOR EACH ROW EXECUTE FUNCTION student_progressions_guard();

-- A registration in the roster has a class and an enrolment; a placed one has a class. Registrations are never deleted.
ALTER TABLE "annual_registrations" ADD CONSTRAINT "annual_registrations_active_has_class" CHECK ("status" <> 'ACTIVE' OR ("classId" IS NOT NULL AND "enrollmentId" IS NOT NULL AND "activatedAt" IS NOT NULL));
ALTER TABLE "annual_registrations" ADD CONSTRAINT "annual_registrations_registered_has_class" CHECK ("status" NOT IN ('REGISTERED', 'ACTIVE') OR "classId" IS NOT NULL);
CREATE FUNCTION annual_registrations_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'annual registrations cannot be deleted; cancel them with a reason';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER annual_registrations_keep BEFORE DELETE ON "annual_registrations" FOR EACH ROW EXECUTE FUNCTION annual_registrations_no_delete();
