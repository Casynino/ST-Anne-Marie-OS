-- CreateEnum
CREATE TYPE "ReportCardStatus" AS ENUM ('GENERATED', 'PUBLISHED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "userId" UUID;

-- CreateTable
CREATE TABLE "report_remarks" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "termId" UUID NOT NULL,
    "classRemark" TEXT,
    "headRemark" TEXT,
    "classRemarkById" UUID,
    "headRemarkById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_remarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_cards" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "termId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "streamId" UUID,
    "status" "ReportCardStatus" NOT NULL DEFAULT 'GENERATED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "snapshot" JSONB NOT NULL,
    "generatedById" UUID NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" UUID,
    "publishedAt" TIMESTAMP(3),
    "withdrawnById" UUID,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_card_revisions" (
    "id" UUID NOT NULL,
    "reportCardId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "generatedById" UUID NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "supersededAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_card_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_remarks_schoolId_termId_idx" ON "report_remarks"("schoolId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "report_remarks_studentId_termId_key" ON "report_remarks"("studentId", "termId");

-- CreateIndex
CREATE INDEX "report_cards_schoolId_termId_classId_idx" ON "report_cards"("schoolId", "termId", "classId");

-- CreateIndex
CREATE INDEX "report_cards_schoolId_studentId_status_idx" ON "report_cards"("schoolId", "studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "report_cards_studentId_termId_key" ON "report_cards"("studentId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "report_card_revisions_reportCardId_version_key" ON "report_card_revisions"("reportCardId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "students_userId_key" ON "students"("userId");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_remarks" ADD CONSTRAINT "report_remarks_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_card_revisions" ADD CONSTRAINT "report_card_revisions_reportCardId_fkey" FOREIGN KEY ("reportCardId") REFERENCES "report_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One portal account per student; a withdrawn card must carry a reason; a published card must carry who/when.
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_withdrawn_has_reason"
  CHECK ("status" <> 'WITHDRAWN' OR ("withdrawReason" IS NOT NULL AND "withdrawnAt" IS NOT NULL AND "withdrawnById" IS NOT NULL));
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_published_has_audit"
  CHECK ("status" <> 'PUBLISHED' OR ("publishedAt" IS NOT NULL AND "publishedById" IS NOT NULL));

-- Superseded snapshots are never changed or removed.
CREATE FUNCTION report_card_revisions_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'report_card_revisions is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER report_card_revisions_no_change BEFORE UPDATE OR DELETE ON "report_card_revisions"
  FOR EACH ROW EXECUTE FUNCTION report_card_revisions_append_only();
