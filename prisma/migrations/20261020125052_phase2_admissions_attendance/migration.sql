-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateEnum
CREATE TYPE "RegisterStatus" AS ENUM ('DRAFT', 'FINALISED');

-- CreateEnum
CREATE TYPE "OperationKind" AS ENUM ('SAVE_DRAFT', 'FINALISE');

-- CreateEnum
CREATE TYPE "OperationOutcome" AS ENUM ('APPLIED', 'CONFLICT');

-- CreateEnum
CREATE TYPE "ConflictResolution" AS ENUM ('PENDING', 'ACCEPTED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('ABSENCE');

-- CreateEnum
CREATE TYPE "NotificationEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'SMS');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SUBMITTED', 'DELIVERED', 'FAILED', 'UNKNOWN', 'SKIPPED', 'STORED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('APPLIED', 'INTERVIEW', 'ACCEPTED', 'ENROLLED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('PREVIEW', 'IMPORTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('VALID', 'WARNING', 'ERROR', 'DUPLICATE', 'IMPORTED', 'SKIPPED');

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameSw" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_registers" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "streamId" UUID,
    "sessionId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "RegisterStatus" NOT NULL DEFAULT 'DRAFT',
    "startedById" UUID NOT NULL,
    "finalisedById" UUID,
    "finalisedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_attendance" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "registerId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "streamId" UUID,
    "sessionId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "note" TEXT,
    "markedById" UUID NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_corrections" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "attendanceId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "fromStatus" "AttendanceStatus" NOT NULL,
    "toStatus" "AttendanceStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "correctedById" UUID NOT NULL,
    "operationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_operations" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "clientOpId" UUID NOT NULL,
    "deviceId" TEXT,
    "kind" "OperationKind" NOT NULL,
    "classId" UUID NOT NULL,
    "streamId" UUID,
    "sessionId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "payload" JSONB NOT NULL,
    "outcome" "OperationOutcome" NOT NULL,
    "outcomeCode" TEXT NOT NULL,
    "registerId" UUID,
    "clientCreatedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolution" "ConflictResolution",
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "resolutionReason" TEXT,

    CONSTRAINT "attendance_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_attendance" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "note" TEXT,
    "recordedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_events" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "type" "NotificationEventType" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "studentId" UUID NOT NULL,
    "guardianId" UUID NOT NULL,
    "attendanceId" UUID,
    "payload" JSONB NOT NULL,
    "status" "NotificationEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL,
    "providerRef" TEXT,
    "detail" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "in_app_notifications" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "in_app_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "applicationNo" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'APPLIED',
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "gender" "Gender" NOT NULL,
    "intakeYearId" UUID,
    "classAppliedId" UUID,
    "nationality" TEXT,
    "religion" TEXT,
    "birthCertificateNo" TEXT,
    "previousSchool" TEXT,
    "address" TEXT,
    "guardians" JSONB NOT NULL,
    "interviewOn" DATE,
    "assessmentNotes" TEXT,
    "decisionReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" UUID,
    "studentId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_events" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "fromStatus" "ApplicationStatus",
    "toStatus" "ApplicationStatus" NOT NULL,
    "reason" TEXT,
    "byUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "applicationId" UUID,
    "studentId" UUID,
    "docType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedById" UUID,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'PREVIEW',
    "headerMap" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "status" "ImportRowStatus" NOT NULL,
    "messages" JSONB NOT NULL,
    "studentId" UUID,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_schoolId_code_key" ON "attendance_sessions"("schoolId", "code");

-- CreateIndex
CREATE INDEX "attendance_registers_schoolId_date_idx" ON "attendance_registers"("schoolId", "date");

-- CreateIndex
CREATE INDEX "attendance_registers_schoolId_classId_date_idx" ON "attendance_registers"("schoolId", "classId", "date");

-- CreateIndex
-- NULLS NOT DISTINCT: a class without streams (streamId NULL) still gets exactly one register per session/date.
CREATE UNIQUE INDEX "attendance_registers_unique_register" ON "attendance_registers"("classId", "streamId", "sessionId", "date") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "student_attendance_registerId_idx" ON "student_attendance"("registerId");

-- CreateIndex
CREATE INDEX "student_attendance_schoolId_classId_date_idx" ON "student_attendance"("schoolId", "classId", "date");

-- CreateIndex
CREATE INDEX "student_attendance_schoolId_studentId_date_idx" ON "student_attendance"("schoolId", "studentId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "student_attendance_studentId_sessionId_date_key" ON "student_attendance"("studentId", "sessionId", "date");

-- CreateIndex
CREATE INDEX "attendance_corrections_attendanceId_idx" ON "attendance_corrections"("attendanceId");

-- CreateIndex
CREATE INDEX "attendance_corrections_schoolId_createdAt_idx" ON "attendance_corrections"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "attendance_operations_schoolId_outcome_resolution_idx" ON "attendance_operations"("schoolId", "outcome", "resolution");

-- CreateIndex
CREATE INDEX "attendance_operations_registerId_idx" ON "attendance_operations"("registerId");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_operations_schoolId_userId_clientOpId_key" ON "attendance_operations"("schoolId", "userId", "clientOpId");

-- CreateIndex
CREATE INDEX "staff_attendance_schoolId_date_idx" ON "staff_attendance"("schoolId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "staff_attendance_staffId_date_key" ON "staff_attendance"("staffId", "date");

-- CreateIndex
CREATE INDEX "notification_events_status_nextAttemptAt_idx" ON "notification_events"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "notification_events_schoolId_createdAt_idx" ON "notification_events"("schoolId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_events_schoolId_dedupeKey_key" ON "notification_events"("schoolId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_eventId_channel_key" ON "notification_deliveries"("eventId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "in_app_notifications_eventId_key" ON "in_app_notifications"("eventId");

-- CreateIndex
CREATE INDEX "in_app_notifications_userId_readAt_idx" ON "in_app_notifications"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "applications_studentId_key" ON "applications"("studentId");

-- CreateIndex
CREATE INDEX "applications_schoolId_status_idx" ON "applications"("schoolId", "status");

-- CreateIndex
CREATE INDEX "applications_schoolId_lastName_firstName_idx" ON "applications"("schoolId", "lastName", "firstName");

-- CreateIndex
CREATE UNIQUE INDEX "applications_schoolId_applicationNo_key" ON "applications"("schoolId", "applicationNo");

-- CreateIndex
CREATE INDEX "application_events_applicationId_idx" ON "application_events"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "documents_storageKey_key" ON "documents"("storageKey");

-- CreateIndex
CREATE INDEX "documents_schoolId_applicationId_idx" ON "documents"("schoolId", "applicationId");

-- CreateIndex
CREATE INDEX "documents_schoolId_studentId_idx" ON "documents"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "import_batches_schoolId_createdAt_idx" ON "import_batches"("schoolId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_batchId_rowNumber_key" ON "import_rows"("batchId", "rowNumber");

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_registers" ADD CONSTRAINT "attendance_registers_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_registers" ADD CONSTRAINT "attendance_registers_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "attendance_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "attendance_registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "attendance_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "student_attendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_operations" ADD CONSTRAINT "attendance_operations_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "notification_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "notification_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────────────────── Integrity rules Prisma cannot express ─────────────────────────

-- Only one OPEN application per child (name + date of birth) and per birth certificate number.
-- Rejected/withdrawn/enrolled applications do not block a new application.
CREATE UNIQUE INDEX "applications_open_child_key"
  ON "applications" ("schoolId", lower(btrim("firstName")), lower(btrim("lastName")), "dateOfBirth")
  WHERE "status" IN ('APPLIED', 'INTERVIEW', 'ACCEPTED');
CREATE UNIQUE INDEX "applications_open_birthcert_key"
  ON "applications" ("schoolId", lower(btrim("birthCertificateNo")))
  WHERE "birthCertificateNo" IS NOT NULL AND "status" IN ('APPLIED', 'INTERVIEW', 'ACCEPTED');

-- A document belongs to an application and/or a student.
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_check" CHECK ("applicationId" IS NOT NULL OR "studentId" IS NOT NULL);
ALTER TABLE "documents" ADD CONSTRAINT "documents_size_check" CHECK ("sizeBytes" > 0);

-- Sync conflicts always carry a resolution state; applied operations never do.
ALTER TABLE "attendance_operations" ADD CONSTRAINT "attendance_operations_resolution_check"
  CHECK (("outcome" = 'CONFLICT') = ("resolution" IS NOT NULL));

-- A correction must actually change the status and carry a reason.
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_change_check"
  CHECK ("fromStatus" <> "toStatus" AND length(btrim("reason")) > 0);

-- Attendance corrections are append-only, like the audit log.
CREATE OR REPLACE FUNCTION prevent_append_only_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "attendance_corrections_append_only"
  BEFORE UPDATE OR DELETE ON "attendance_corrections"
  FOR EACH ROW EXECUTE FUNCTION prevent_append_only_change();
