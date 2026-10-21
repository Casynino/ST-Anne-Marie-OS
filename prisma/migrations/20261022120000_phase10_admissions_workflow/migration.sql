-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'VERIFIED', 'RETURNED');

-- CreateEnum
CREATE TYPE "DocVerification" AS ENUM ('PENDING', 'VERIFIED', 'NEEDS_CORRECTION');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "InterviewOutcome" AS ENUM ('PASSED', 'NOT_PASSED', 'DEFERRED', 'FURTHER_ASSESSMENT', 'AWAITING_DECISION');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING_APPROVAL', 'ISSUED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AdmissionPaymentStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'REVERSED');

-- AlterTable
ALTER TABLE "application_events" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'STATUS';

-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "docsExceptionAt" TIMESTAMP(3),
ADD COLUMN     "docsExceptionById" UUID,
ADD COLUMN     "docsExceptionReason" TEXT,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" UUID,
ADD COLUMN     "submittedOn" DATE;

-- AlterTable
ALTER TABLE "classes" ADD COLUMN     "capacity" INTEGER;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "verification" "DocVerification" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "verificationNote" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" UUID;

-- CreateTable
CREATE TABLE "interviews" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "location" TEXT,
    "method" TEXT,
    "interviewerId" UUID,
    "status" "InterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "outcome" "InterviewOutcome",
    "score" INTEGER,
    "notes" TEXT,
    "scheduleNote" TEXT,
    "cancelReason" TEXT,
    "rescheduledFromId" UUID,
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_offers" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'ISSUED',
    "letterNo" TEXT NOT NULL,
    "classOfferedId" UUID,
    "feeAmount" DECIMAL(14,2) NOT NULL,
    "expiresOn" DATE,
    "notes" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" UUID NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "respondedAt" TIMESTAMP(3),
    "responseNote" TEXT,
    "paymentWaivedAt" TIMESTAMP(3),
    "paymentWaivedById" UUID,
    "paymentWaiverReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admission_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_payments" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "paidOn" DATE NOT NULL,
    "payerName" TEXT,
    "notes" TEXT,
    "status" "AdmissionPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "receiptNo" TEXT,
    "idempotencyKey" TEXT,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "reversedById" UUID,
    "reversedAt" TIMESTAMP(3),
    "reverseReason" TEXT,

    CONSTRAINT "admission_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "interviews_schoolId_scheduledAt_idx" ON "interviews"("schoolId", "scheduledAt");

-- CreateIndex
CREATE INDEX "interviews_applicationId_idx" ON "interviews"("applicationId");

-- CreateIndex
CREATE INDEX "interviews_interviewerId_scheduledAt_idx" ON "interviews"("interviewerId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "admission_offers_applicationId_key" ON "admission_offers"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "admission_offers_schoolId_letterNo_key" ON "admission_offers"("schoolId", "letterNo");

-- CreateIndex
CREATE INDEX "admission_payments_schoolId_status_idx" ON "admission_payments"("schoolId", "status");

-- CreateIndex
CREATE INDEX "admission_payments_applicationId_idx" ON "admission_payments"("applicationId");

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_offers" ADD CONSTRAINT "admission_offers_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_offers" ADD CONSTRAINT "admission_offers_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_payments" ADD CONSTRAINT "admission_payments_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_payments" ADD CONSTRAINT "admission_payments_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═════════════ Integrity that Prisma cannot express ═════════════

ALTER TABLE "classes" ADD CONSTRAINT "classes_capacity_check" CHECK ("capacity" IS NULL OR "capacity" > 0);

-- Interviews: sensible values, and at most one live appointment per application (a reschedule cancels the old one first).
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_duration_check" CHECK ("durationMinutes" BETWEEN 5 AND 480);
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_score_check" CHECK ("score" IS NULL OR "score" BETWEEN 0 AND 100);
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_cancel_check" CHECK ("status" <> 'CANCELLED' OR "cancelReason" IS NOT NULL);
CREATE UNIQUE INDEX "interviews_one_live_per_application" ON "interviews" ("applicationId") WHERE "status" = 'SCHEDULED';

-- Offers: the fee is never negative; a payment waiver always names who allowed it and why.
ALTER TABLE "admission_offers" ADD CONSTRAINT "admission_offers_fee_check" CHECK ("feeAmount" >= 0);
ALTER TABLE "admission_offers" ADD CONSTRAINT "admission_offers_waiver_check" CHECK ("paymentWaivedAt" IS NULL OR ("paymentWaivedById" IS NOT NULL AND "paymentWaiverReason" IS NOT NULL));

-- Admission payments: positive; a verified payment names its verifier and receipt; a reversed one its reason.
ALTER TABLE "admission_payments" ADD CONSTRAINT "admission_payments_amount_check" CHECK ("amount" > 0);
ALTER TABLE "admission_payments" ADD CONSTRAINT "admission_payments_verified_check" CHECK ("status" <> 'VERIFIED' OR ("verifiedById" IS NOT NULL AND "verifiedAt" IS NOT NULL AND "receiptNo" IS NOT NULL));
ALTER TABLE "admission_payments" ADD CONSTRAINT "admission_payments_rejected_check" CHECK ("status" <> 'REJECTED' OR "rejectReason" IS NOT NULL);
ALTER TABLE "admission_payments" ADD CONSTRAINT "admission_payments_reversed_check" CHECK ("status" <> 'REVERSED' OR ("reversedAt" IS NOT NULL AND "reversedById" IS NOT NULL AND "reverseReason" IS NOT NULL));
CREATE UNIQUE INDEX "admission_payments_idempotency_key" ON "admission_payments" ("schoolId", "idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;
CREATE UNIQUE INDEX "admission_payments_receipt_no" ON "admission_payments" ("schoolId", "receiptNo") WHERE "receiptNo" IS NOT NULL;
-- The same bank slip or transaction id can only be counted once while the earlier payment is waiting or verified.
CREATE UNIQUE INDEX "admission_payments_live_reference" ON "admission_payments" ("schoolId", "method", "reference") WHERE "reference" IS NOT NULL AND "status" IN ('PENDING', 'VERIFIED');

-- Admission payments are never deleted; amount, applicant, method, reference and date never change. Only the status moves:
-- PENDING -> VERIFIED | REJECTED, VERIFIED -> REVERSED. Rejected and reversed rows are final.
CREATE FUNCTION admission_payments_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'admission payments cannot be deleted';
  END IF;
  IF NEW."amount" <> OLD."amount" OR NEW."applicationId" <> OLD."applicationId" OR NEW."schoolId" <> OLD."schoolId"
     OR NEW."method" <> OLD."method" OR NEW."paidOn" <> OLD."paidOn" OR NEW."reference" IS DISTINCT FROM OLD."reference" THEN
    RAISE EXCEPTION 'admission payment details cannot be changed; reject or reverse the payment instead';
  END IF;
  IF OLD."status" IN ('REJECTED', 'REVERSED') AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'a % admission payment cannot be changed', lower(OLD."status"::text);
  END IF;
  IF OLD."status" = 'VERIFIED' AND NEW."status" NOT IN ('VERIFIED', 'REVERSED') THEN
    RAISE EXCEPTION 'a verified admission payment can only be reversed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER admission_payments_no_edit BEFORE UPDATE OR DELETE ON "admission_payments" FOR EACH ROW EXECUTE FUNCTION admission_payments_guard();
