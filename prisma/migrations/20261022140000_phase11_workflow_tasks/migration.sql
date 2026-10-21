-- CreateEnum
CREATE TYPE "TaskDepartment" AS ENUM ('ADMISSIONS', 'ACADEMIC', 'FINANCE', 'HR', 'ADMIN');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "workflow_tasks" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "department" "TaskDepartment" NOT NULL,
    "sourceEvent" TEXT NOT NULL,
    "relatedType" TEXT NOT NULL,
    "relatedId" UUID NOT NULL,
    "relatedLabel" TEXT,
    "assignedToId" UUID,
    "dueOn" DATE,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,
    "completionNote" TEXT,

    CONSTRAINT "workflow_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_tasks_schoolId_department_status_idx" ON "workflow_tasks"("schoolId", "department", "status");

-- CreateIndex
CREATE INDEX "workflow_tasks_schoolId_relatedType_relatedId_idx" ON "workflow_tasks"("schoolId", "relatedType", "relatedId");

-- CreateIndex
CREATE INDEX "workflow_tasks_assignedToId_status_idx" ON "workflow_tasks"("assignedToId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_tasks_schoolId_dedupeKey_key" ON "workflow_tasks"("schoolId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A finished task says who finished it and when; a started one says when.
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_completed_check" CHECK ("status" <> 'COMPLETED' OR "completedAt" IS NOT NULL);
