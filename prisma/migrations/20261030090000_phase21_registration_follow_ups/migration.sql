-- CreateEnum
CREATE TYPE "FollowUpOutcome" AS ENUM ('WILL_RETURN', 'NOT_RETURNING', 'NO_ANSWER', 'OTHER');

-- CreateTable
CREATE TABLE "registration_follow_ups" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "registrationId" UUID NOT NULL,
    "outcome" "FollowUpOutcome" NOT NULL,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "registration_follow_ups_registrationId_createdAt_idx" ON "registration_follow_ups"("registrationId", "createdAt");

-- CreateIndex
CREATE INDEX "registration_follow_ups_schoolId_createdAt_idx" ON "registration_follow_ups"("schoolId", "createdAt");

-- AddForeignKey
ALTER TABLE "registration_follow_ups" ADD CONSTRAINT "registration_follow_ups_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_follow_ups" ADD CONSTRAINT "registration_follow_ups_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "annual_registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Follow-up notes are history: they are added, never edited or removed.
CREATE FUNCTION registration_follow_ups_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'registration follow-up notes are history and cannot be changed';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER registration_follow_ups_keep BEFORE UPDATE OR DELETE ON "registration_follow_ups" FOR EACH ROW EXECUTE FUNCTION registration_follow_ups_guard();
