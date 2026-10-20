-- CreateEnum
CREATE TYPE "FeeCategory" AS ENUM ('TUITION', 'TRANSPORT', 'MEALS', 'BOARDING', 'UNIFORM', 'EXAM', 'ADMISSION', 'OTHER');

-- CreateEnum
CREATE TYPE "DiscountKind" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('TERM_FEES', 'OTHER');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'VOID');

-- CreateEnum
CREATE TYPE "InvoiceLineKind" AS ENUM ('CHARGE', 'DISCOUNT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK', 'MOBILE_MONEY', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('MANUAL', 'PROVIDER');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "PaymentEventStatus" AS ENUM ('POSTED', 'UNMATCHED', 'NOT_SUCCESSFUL', 'REJECTED');

-- CreateTable
CREATE TABLE "fee_items" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameSw" TEXT,
    "category" "FeeCategory" NOT NULL DEFAULT 'TUITION',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_structures" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "levelId" UUID,
    "classId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_structure_lines" (
    "id" UUID NOT NULL,
    "structureId" UUID NOT NULL,
    "feeItemId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "termSequence" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "fee_structure_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_discounts" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DiscountKind" NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "feeItemId" UUID,
    "reason" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "approvedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedById" UUID,

    CONSTRAINT "student_discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "termId" UUID,
    "classId" UUID,
    "number" TEXT NOT NULL,
    "type" "InvoiceType" NOT NULL DEFAULT 'TERM_FEES',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "issueDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" UUID,
    "voidReason" TEXT,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "feeItemId" UUID,
    "kind" "InvoiceLineKind" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_instalments" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "invoice_instalments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "targetInvoiceId" UUID,
    "method" "PaymentMethod" NOT NULL,
    "provider" TEXT,
    "reference" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "receivedOn" DATE NOT NULL,
    "payerName" TEXT,
    "notes" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'POSTED',
    "source" "PaymentSource" NOT NULL DEFAULT 'MANUAL',
    "idempotencyKey" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversedById" UUID,
    "reverseReason" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" UUID,
    "snapshot" JSONB NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" UUID NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidById" UUID,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "spentOn" DATE NOT NULL,
    "payee" TEXT NOT NULL,
    "description" TEXT,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "voidReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "providerStatus" TEXT NOT NULL,
    "status" "PaymentEventStatus" NOT NULL,
    "amount" DECIMAL(14,2),
    "currency" TEXT,
    "reference" TEXT,
    "msisdn" TEXT,
    "occurredAt" TIMESTAMP(3),
    "payloadHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "paymentId" UUID,
    "studentId" UUID,
    "note" TEXT,
    "resolvedById" UUID,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fee_items_schoolId_name_key" ON "fee_items"("schoolId", "name");

-- CreateIndex
CREATE INDEX "fee_structures_schoolId_academicYearId_idx" ON "fee_structures"("schoolId", "academicYearId");

-- CreateIndex
CREATE INDEX "student_discounts_schoolId_studentId_academicYearId_idx" ON "student_discounts"("schoolId", "studentId", "academicYearId");

-- CreateIndex
CREATE INDEX "invoices_schoolId_studentId_idx" ON "invoices"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "invoices_schoolId_termId_status_idx" ON "invoices"("schoolId", "termId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_schoolId_number_key" ON "invoices"("schoolId", "number");

-- CreateIndex
CREATE INDEX "invoice_lines_invoiceId_idx" ON "invoice_lines"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_instalments_invoiceId_sequence_key" ON "invoice_instalments"("invoiceId", "sequence");

-- CreateIndex
CREATE INDEX "payments_schoolId_studentId_status_idx" ON "payments"("schoolId", "studentId", "status");

-- CreateIndex
CREATE INDEX "payments_schoolId_receivedOn_idx" ON "payments"("schoolId", "receivedOn");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_paymentId_key" ON "receipts"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_schoolId_number_key" ON "receipts"("schoolId", "number");

-- CreateIndex
CREATE INDEX "refunds_schoolId_studentId_idx" ON "refunds"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "refunds_schoolId_status_idx" ON "refunds"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_schoolId_name_key" ON "expense_categories"("schoolId", "name");

-- CreateIndex
CREATE INDEX "expenses_schoolId_spentOn_idx" ON "expenses"("schoolId", "spentOn");

-- CreateIndex
CREATE INDEX "payment_events_schoolId_status_idx" ON "payment_events"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_schoolId_provider_providerEventId_key" ON "payment_events"("schoolId", "provider", "providerEventId");

-- AddForeignKey
ALTER TABLE "fee_items" ADD CONSTRAINT "fee_items_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "fee_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_feeItemId_fkey" FOREIGN KEY ("feeItemId") REFERENCES "fee_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_discounts" ADD CONSTRAINT "student_discounts_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_instalments" ADD CONSTRAINT "invoice_instalments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_targetInvoiceId_fkey" FOREIGN KEY ("targetInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══ Integrity rules Prisma cannot express ═══

-- Fee structures: a scope is a class, a level, or everyone; one active structure per scope and year.
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_scope_check" CHECK ("classId" IS NULL OR "levelId" IS NULL);
CREATE UNIQUE INDEX "fee_structures_one_active_scope" ON "fee_structures" ("schoolId", "academicYearId", "levelId", "classId") NULLS NOT DISTINCT WHERE "isActive";
ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_amount_check" CHECK ("amount" > 0);
ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_term_check" CHECK ("termSequence" IS NULL OR "termSequence" BETWEEN 1 AND 12);
CREATE UNIQUE INDEX "fee_structure_lines_unique" ON "fee_structure_lines" ("structureId", "feeItemId", "termSequence") NULLS NOT DISTINCT;

ALTER TABLE "student_discounts" ADD CONSTRAINT "student_discounts_value_check" CHECK ("value" > 0 AND ("kind" <> 'PERCENT' OR "value" <= 100));

-- Invoices: voiding needs who/when/why; one live term-fee invoice per student and term.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_void_check" CHECK ("status" <> 'VOID' OR ("voidedAt" IS NOT NULL AND "voidedById" IS NOT NULL AND "voidReason" IS NOT NULL));
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_dates_check" CHECK ("dueDate" >= "issueDate");
CREATE UNIQUE INDEX "invoices_one_term_fee_invoice" ON "invoices" ("studentId", "termId") WHERE "type" = 'TERM_FEES' AND "status" = 'ISSUED' AND "termId" IS NOT NULL;
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_amount_check" CHECK ("amount" > 0);
ALTER TABLE "invoice_instalments" ADD CONSTRAINT "invoice_instalments_amount_check" CHECK ("amount" > 0);

-- Invoice lines are append-only.
CREATE FUNCTION finance_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER invoice_lines_no_change BEFORE UPDATE OR DELETE ON "invoice_lines" FOR EACH ROW EXECUTE FUNCTION finance_append_only();

-- Payments: positive amounts, no double-entry of the same bank slip / transaction while it is posted,
-- an idempotency key identifies one submission forever.
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("amount" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversed_check" CHECK ("status" <> 'REVERSED' OR ("reversedAt" IS NOT NULL AND "reversedById" IS NOT NULL AND "reverseReason" IS NOT NULL));
CREATE UNIQUE INDEX "payments_idempotency_key" ON "payments" ("schoolId", "idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;
CREATE UNIQUE INDEX "payments_posted_reference" ON "payments" ("schoolId", "method", COALESCE("provider", ''), "reference") WHERE "status" = 'POSTED' AND "reference" IS NOT NULL;

-- A payment can only be reversed (POSTED -> REVERSED with reason); amount, student, method, reference and date never change.
CREATE FUNCTION payments_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments cannot be deleted';
  END IF;
  IF OLD."status" = 'REVERSED' THEN
    RAISE EXCEPTION 'a reversed payment cannot be changed';
  END IF;
  IF NEW."amount" <> OLD."amount" OR NEW."studentId" <> OLD."studentId" OR NEW."schoolId" <> OLD."schoolId"
     OR NEW."method" <> OLD."method" OR NEW."receivedOn" <> OLD."receivedOn"
     OR NEW."reference" IS DISTINCT FROM OLD."reference" OR NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."targetInvoiceId" IS DISTINCT FROM OLD."targetInvoiceId" OR NEW."source" <> OLD."source" THEN
    RAISE EXCEPTION 'payment details cannot be changed; reverse the payment instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payments_no_edit BEFORE UPDATE OR DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION payments_guard();

-- Receipts: only the void marker may change.
CREATE FUNCTION receipts_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'receipts cannot be deleted';
  END IF;
  IF NEW."paymentId" <> OLD."paymentId" OR NEW."number" <> OLD."number" OR NEW."snapshot"::text <> OLD."snapshot"::text OR NEW."schoolId" <> OLD."schoolId" THEN
    RAISE EXCEPTION 'a receipt cannot be edited; void it by reversing the payment';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER receipts_no_edit BEFORE UPDATE OR DELETE ON "receipts" FOR EACH ROW EXECUTE FUNCTION receipts_guard();

-- Refunds: positive; decided by someone other than the requester; paid only with a timestamp.
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_check" CHECK ("amount" > 0);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_decision_check" CHECK ("status" = 'REQUESTED' OR ("decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL));
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_two_people_check" CHECK ("decidedById" IS NULL OR "decidedById" <> "requestedById");
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paid_check" CHECK ("status" <> 'PAID' OR ("paidAt" IS NOT NULL AND "paidById" IS NOT NULL));

-- Expenses are voided, not deleted.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_check" CHECK ("amount" > 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_void_check" CHECK (NOT "voided" OR ("voidReason" IS NOT NULL AND "voidedAt" IS NOT NULL AND "voidedById" IS NOT NULL));
CREATE FUNCTION expenses_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'expenses cannot be deleted; void them instead';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER expenses_no_delete BEFORE DELETE ON "expenses" FOR EACH ROW EXECUTE FUNCTION expenses_no_delete();

-- Provider events: the payload is evidence and never changes; events are never deleted.
CREATE FUNCTION payment_events_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment events cannot be deleted';
  END IF;
  IF NEW."payload"::text <> OLD."payload"::text OR NEW."payloadHash" <> OLD."payloadHash" OR NEW."providerEventId" <> OLD."providerEventId" OR NEW."provider" <> OLD."provider" OR NEW."schoolId" <> OLD."schoolId" THEN
    RAISE EXCEPTION 'a payment event payload cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payment_events_no_edit BEFORE UPDATE OR DELETE ON "payment_events" FOR EACH ROW EXECUTE FUNCTION payment_events_guard();
