-- CreateEnum
CREATE TYPE "ExpenseApproval" AS ENUM ('APPROVED', 'PENDING', 'REJECTED');

-- AlterTable
ALTER TABLE "expense_categories" ADD COLUMN     "requiresApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "approval" "ExpenseApproval" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "approvalNote" TEXT,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" UUID;

-- An approved or rejected expense always says who decided and when (an expense that never needed approval has neither).
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_decision_check" CHECK ("approval" = 'PENDING' OR "approvedById" IS NOT NULL OR "approvedAt" IS NULL);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_rejected_check" CHECK ("approval" <> 'REJECTED' OR ("approvedById" IS NOT NULL AND "approvalNote" IS NOT NULL));
-- The approver is never the person who recorded the expense.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_two_people_check" CHECK ("approvedById" IS NULL OR "approvedById" <> "createdById");
