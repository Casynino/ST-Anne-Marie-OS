-- CreateEnum
CREATE TYPE "ExamTaskStatus" AS ENUM ('ASSIGNED', 'DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "application_exams" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "interviewId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "assignedToId" UUID NOT NULL,
    "maxMark" DECIMAL(6,2) NOT NULL DEFAULT 100,
    "mark" DECIMAL(6,2),
    "outcome" TEXT,
    "comment" TEXT,
    "instructions" TEXT,
    "dueOn" DATE,
    "status" "ExamTaskStatus" NOT NULL DEFAULT 'ASSIGNED',
    "returnNote" TEXT,
    "cancelReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_exam_events" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "byId" UUID NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_exam_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "application_exams_schoolId_assignedToId_status_idx" ON "application_exams"("schoolId", "assignedToId", "status");

-- CreateIndex
CREATE INDEX "application_exams_applicationId_idx" ON "application_exams"("applicationId");

-- CreateIndex
CREATE INDEX "application_exams_interviewId_idx" ON "application_exams"("interviewId");

-- CreateIndex
CREATE INDEX "application_exam_events_examId_createdAt_idx" ON "application_exam_events"("examId", "createdAt");

-- AddForeignKey
ALTER TABLE "application_exams" ADD CONSTRAINT "application_exams_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_exams" ADD CONSTRAINT "application_exams_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_exams" ADD CONSTRAINT "application_exams_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "interviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_exams" ADD CONSTRAINT "application_exams_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_exam_events" ADD CONSTRAINT "application_exam_events_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_exam_events" ADD CONSTRAINT "application_exam_events_examId_fkey" FOREIGN KEY ("examId") REFERENCES "application_exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One live examination task per interview and subject (a cancelled one stays as history).
CREATE UNIQUE INDEX "application_exams_one_live_per_subject" ON "application_exams" ("interviewId", "subjectId") WHERE "status" <> 'CANCELLED';

-- Marks are between 0 and the maximum; a submitted or approved task carries a mark or a configured outcome.
ALTER TABLE "application_exams" ADD CONSTRAINT "application_exams_mark_range" CHECK ("maxMark" > 0 AND ("mark" IS NULL OR ("mark" >= 0 AND "mark" <= "maxMark")));
ALTER TABLE "application_exams" ADD CONSTRAINT "application_exams_result_present" CHECK ("status" NOT IN ('SUBMITTED', 'APPROVED') OR "mark" IS NOT NULL OR "outcome" IS NOT NULL);

-- The history of marking is append-only.
CREATE FUNCTION application_exam_events_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'examination history cannot be changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER application_exam_events_no_edit BEFORE UPDATE OR DELETE ON "application_exam_events" FOR EACH ROW EXECUTE FUNCTION application_exam_events_guard();
