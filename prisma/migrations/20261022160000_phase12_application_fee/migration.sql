-- CreateEnum
CREATE TYPE "ApplicationDraftStatus" AS ENUM ('AWAITING_PAYMENT', 'SUBMITTED', 'PAID_HOLD', 'CANCELLED');

-- CreateTable
CREATE TABLE "application_drafts" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "feeAmount" DECIMAL(14,2) NOT NULL,
    "status" "ApplicationDraftStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "paymentProvider" TEXT,
    "paymentEventId" TEXT,
    "paidAmount" DECIMAL(14,2),
    "paidAt" TIMESTAMP(3),
    "receiptNo" TEXT,
    "applicationId" UUID,
    "holdNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "application_drafts_applicationId_key" ON "application_drafts"("applicationId");

-- CreateIndex
CREATE INDEX "application_drafts_schoolId_userId_idx" ON "application_drafts"("schoolId", "userId");

-- CreateIndex
CREATE INDEX "application_drafts_schoolId_status_idx" ON "application_drafts"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "application_drafts_schoolId_reference_key" ON "application_drafts"("schoolId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "application_drafts_schoolId_paymentProvider_paymentEventId_key" ON "application_drafts"("schoolId", "paymentProvider", "paymentEventId");

-- AddForeignKey
ALTER TABLE "application_drafts" ADD CONSTRAINT "application_drafts_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_drafts" ADD CONSTRAINT "application_drafts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_drafts" ADD CONSTRAINT "application_drafts_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The fee confirmation is a financial fact: a draft that has been paid is never deleted and its money, reference and confirmation never change.
ALTER TABLE "application_drafts" ADD CONSTRAINT "application_drafts_paid_complete" CHECK ("paidAt" IS NULL OR ("paidAmount" IS NOT NULL AND "paymentProvider" IS NOT NULL AND "paymentEventId" IS NOT NULL AND "receiptNo" IS NOT NULL));
ALTER TABLE "application_drafts" ADD CONSTRAINT "application_drafts_submitted_needs_application" CHECK ("status" <> 'SUBMITTED' OR "applicationId" IS NOT NULL);
ALTER TABLE "application_drafts" ADD CONSTRAINT "application_drafts_fee_paid_before_submit" CHECK ("status" <> 'SUBMITTED' OR "feeAmount" = 0 OR "paidAt" IS NOT NULL);
ALTER TABLE "application_drafts" ADD CONSTRAINT "application_drafts_fee_not_negative" CHECK ("feeAmount" >= 0);

CREATE FUNCTION application_drafts_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."paidAt" IS NOT NULL THEN
      RAISE EXCEPTION 'a paid application cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."paidAt" IS NOT NULL AND (
       NEW."paidAt" IS DISTINCT FROM OLD."paidAt" OR NEW."paidAmount" IS DISTINCT FROM OLD."paidAmount"
    OR NEW."paymentProvider" IS DISTINCT FROM OLD."paymentProvider" OR NEW."paymentEventId" IS DISTINCT FROM OLD."paymentEventId"
    OR NEW."receiptNo" IS DISTINCT FROM OLD."receiptNo" OR NEW."feeAmount" <> OLD."feeAmount" OR NEW."reference" <> OLD."reference"
    OR NEW."userId" <> OLD."userId" OR NEW."schoolId" <> OLD."schoolId") THEN
    RAISE EXCEPTION 'the payment details of an application cannot be changed';
  END IF;
  IF OLD."applicationId" IS NOT NULL AND NEW."applicationId" IS DISTINCT FROM OLD."applicationId" THEN
    RAISE EXCEPTION 'the application a draft became cannot be changed';
  END IF;
  IF OLD."status" = 'SUBMITTED' AND NEW."status" <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'a submitted application cannot go back to a draft';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER application_drafts_guard BEFORE UPDATE OR DELETE ON "application_drafts" FOR EACH ROW EXECUTE FUNCTION application_drafts_guard();
