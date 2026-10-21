-- CreateEnum
CREATE TYPE "AdmissionDecision" AS ENUM ('ACCEPTED', 'NOT_ACCEPTED', 'DEFERRED', 'FURTHER_ASSESSMENT', 'AWAITING_DECISION');

-- CreateEnum
CREATE TYPE "AssessmentKind" AS ENUM ('INTERVIEW', 'ENTRANCE_EXAM', 'ASSESSMENT');

-- CreateEnum
CREATE TYPE "Recommendation" AS ENUM ('RECOMMEND', 'RECOMMEND_WITH_CONDITIONS', 'NOT_RECOMMENDED');

-- CreateEnum
CREATE TYPE "ConcernCategory" AS ENUM ('ABSENCE', 'LOW_MARKS', 'MISSING_WORK', 'DECLINE', 'BEHAVIOUR', 'OTHER');

-- CreateEnum
CREATE TYPE "ConcernStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "TransferKind" AS ENUM ('TRANSFER', 'PROMOTION');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'APPLIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('APPLIED', 'INTERVIEW_SCHEDULED', 'INTERVIEWED', 'AWAITING_DECISION', 'ACCEPTED', 'ONBOARDING', 'ACTIVE', 'REJECTED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "decisionOutcome" "AdmissionDecision";

-- AlterTable
ALTER TABLE "exam_subjects" ADD COLUMN     "sittingOn" DATE,
ADD COLUMN     "startsAt" TEXT,
ADD COLUMN     "venue" TEXT;

-- AlterTable
ALTER TABLE "interviews" ADD COLUMN     "kind" "AssessmentKind" NOT NULL DEFAULT 'INTERVIEW',
ADD COLUMN     "recommendation" "Recommendation",
ADD COLUMN     "recommendationNote" TEXT;

-- CreateTable
CREATE TABLE "academic_concerns" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "category" "ConcernCategory" NOT NULL,
    "summary" TEXT NOT NULL,
    "notes" TEXT,
    "status" "ConcernStatus" NOT NULL DEFAULT 'OPEN',
    "classId" UUID,
    "subjectId" UUID,
    "flaggedById" UUID NOT NULL,
    "flaggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedToId" UUID,
    "shareWithParent" BOOLEAN NOT NULL DEFAULT false,
    "parentMessage" TEXT,
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academic_concerns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concern_actions" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "concernId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "byUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "concern_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_transfers" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "kind" "TransferKind" NOT NULL DEFAULT 'TRANSFER',
    "academicYearId" UUID NOT NULL,
    "fromEnrollmentId" UUID,
    "fromClassId" UUID,
    "fromStreamId" UUID,
    "toClassId" UUID NOT NULL,
    "toStreamId" UUID,
    "effectiveOn" DATE NOT NULL,
    "reason" TEXT,
    "status" "TransferStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" UUID NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "appliedAt" TIMESTAMP(3),
    "appliedEnrollmentId" UUID,
    "overrideNote" TEXT,

    CONSTRAINT "class_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_candidates" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "candidateNo" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "positionApplied" TEXT NOT NULL,
    "subjects" TEXT,
    "qualifications" TEXT,
    "experience" TEXT,
    "notes" TEXT,
    "status" "CandidateStatus" NOT NULL DEFAULT 'APPLIED',
    "interviewAt" TIMESTAMP(3),
    "interviewLocation" TEXT,
    "interviewerId" UUID,
    "interviewScore" INTEGER,
    "interviewNotes" TEXT,
    "suitability" TEXT,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "employmentApprovedById" UUID,
    "employmentApprovedAt" TIMESTAMP(3),
    "startDate" DATE,
    "jobTitle" TEXT,
    "userId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_documents" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "docType" TEXT NOT NULL,
    "received" BOOLEAN NOT NULL DEFAULT false,
    "receivedOn" DATE,
    "note" TEXT,
    "recordedById" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "academic_concerns_schoolId_status_idx" ON "academic_concerns"("schoolId", "status");

-- CreateIndex
CREATE INDEX "academic_concerns_studentId_idx" ON "academic_concerns"("studentId");

-- CreateIndex
CREATE INDEX "concern_actions_concernId_idx" ON "concern_actions"("concernId");

-- CreateIndex
CREATE INDEX "class_transfers_schoolId_status_idx" ON "class_transfers"("schoolId", "status");

-- CreateIndex
CREATE INDEX "class_transfers_studentId_idx" ON "class_transfers"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_candidates_userId_key" ON "staff_candidates"("userId");

-- CreateIndex
CREATE INDEX "staff_candidates_schoolId_status_idx" ON "staff_candidates"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "staff_candidates_schoolId_candidateNo_key" ON "staff_candidates"("schoolId", "candidateNo");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_documents_candidateId_docType_key" ON "candidate_documents"("candidateId", "docType");

-- AddForeignKey
ALTER TABLE "academic_concerns" ADD CONSTRAINT "academic_concerns_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concern_actions" ADD CONSTRAINT "concern_actions_concernId_fkey" FOREIGN KEY ("concernId") REFERENCES "academic_concerns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_transfers" ADD CONSTRAINT "class_transfers_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_candidates" ADD CONSTRAINT "staff_candidates_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_documents" ADD CONSTRAINT "candidate_documents_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "staff_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═════════════ Integrity that Prisma cannot express ═════════════

-- A student has at most one open transfer or promotion request at a time.
CREATE UNIQUE INDEX "class_transfers_one_open_per_student" ON "class_transfers" ("studentId") WHERE "status" IN ('REQUESTED', 'APPROVED');
ALTER TABLE "class_transfers" ADD CONSTRAINT "class_transfers_two_people_check" CHECK ("decidedById" IS NULL OR "decidedById" <> "requestedById");
ALTER TABLE "class_transfers" ADD CONSTRAINT "class_transfers_applied_check" CHECK ("status" <> 'APPLIED' OR ("appliedAt" IS NOT NULL AND "decidedById" IS NOT NULL));
ALTER TABLE "class_transfers" ADD CONSTRAINT "class_transfers_rejected_check" CHECK ("status" <> 'REJECTED' OR "decisionNote" IS NOT NULL);

-- A concern is resolved with a statement of what was done.
ALTER TABLE "academic_concerns" ADD CONSTRAINT "academic_concerns_resolved_check" CHECK ("status" NOT IN ('RESOLVED', 'DISMISSED') OR ("resolvedAt" IS NOT NULL AND "resolvedById" IS NOT NULL AND "resolution" IS NOT NULL));
ALTER TABLE "academic_concerns" ADD CONSTRAINT "academic_concerns_parent_check" CHECK ("shareWithParent" = false OR "parentMessage" IS NOT NULL);

-- Concern actions are a log: never edited or deleted.
CREATE FUNCTION concern_actions_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'concern actions are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER concern_actions_no_change BEFORE UPDATE OR DELETE ON "concern_actions" FOR EACH ROW EXECUTE FUNCTION concern_actions_append_only();

-- Candidates: a decision always names who made it; an approved employment names the approver, who is never the person who recorded the candidate.
ALTER TABLE "staff_candidates" ADD CONSTRAINT "staff_candidates_decision_check" CHECK ("status" NOT IN ('ACCEPTED', 'ONBOARDING', 'ACTIVE', 'REJECTED') OR ("decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL));
ALTER TABLE "staff_candidates" ADD CONSTRAINT "staff_candidates_active_check" CHECK ("status" <> 'ACTIVE' OR ("employmentApprovedById" IS NOT NULL AND "userId" IS NOT NULL));
ALTER TABLE "staff_candidates" ADD CONSTRAINT "staff_candidates_score_check" CHECK ("interviewScore" IS NULL OR "interviewScore" BETWEEN 0 AND 100);

-- Exam sittings: a start time looks like a time.
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_time_check" CHECK ("startsAt" IS NULL OR "startsAt" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
