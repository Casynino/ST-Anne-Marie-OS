-- CreateEnum
CREATE TYPE "LibraryStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LibraryAudience" AS ENUM ('PUBLIC', 'STUDENTS', 'STAFF', 'CLASSES', 'SUBJECTS', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "LibraryEventKind" AS ENUM ('VIEW', 'DOWNLOAD');

-- CreateEnum
CREATE TYPE "LibraryOutcome" AS ENUM ('GRANTED', 'DENIED');

-- CreateEnum
CREATE TYPE "LibraryPerson" AS ENUM ('STUDENT', 'STAFF', 'GUARDIAN', 'VISITOR');

-- CreateEnum
CREATE TYPE "LibraryLevel" AS ENUM ('FULL', 'ID_ONLY');

-- CreateTable
CREATE TABLE "library_categories" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameSw" TEXT,
    "slug" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_resources" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" UUID NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'EN',
    "author" TEXT,
    "academicYearId" UUID,
    "status" "LibraryStatus" NOT NULL DEFAULT 'DRAFT',
    "audience" "LibraryAudience" NOT NULL DEFAULT 'STUDENTS',
    "idOnly" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "availableFrom" TIMESTAMP(3),
    "copyright" TEXT,
    "coverKey" TEXT,
    "coverMime" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "publishedById" UUID,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "library_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_files" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "resourceId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "note" TEXT,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_resource_classes" (
    "resourceId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,

    CONSTRAINT "library_resource_classes_pkey" PRIMARY KEY ("resourceId","classId")
);

-- CreateTable
CREATE TABLE "library_resource_subjects" (
    "resourceId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,

    CONSTRAINT "library_resource_subjects_pkey" PRIMARY KEY ("resourceId","subjectId")
);

-- CreateTable
CREATE TABLE "library_resource_staff" (
    "resourceId" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,

    CONSTRAINT "library_resource_staff_pkey" PRIMARY KEY ("resourceId","staffId")
);

-- CreateTable
CREATE TABLE "library_events" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "resourceId" UUID NOT NULL,
    "fileId" UUID,
    "kind" "LibraryEventKind" NOT NULL,
    "outcome" "LibraryOutcome" NOT NULL,
    "person" "LibraryPerson" NOT NULL,
    "studentId" UUID,
    "staffId" UUID,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_pins" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "pinHash" TEXT NOT NULL,
    "setById" UUID NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_pins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_sessions" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "person" "LibraryPerson" NOT NULL,
    "studentId" UUID,
    "staffId" UUID,
    "level" "LibraryLevel" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "library_categories_schoolId_slug_key" ON "library_categories"("schoolId", "slug");

-- CreateIndex
CREATE INDEX "library_resources_schoolId_status_audience_idx" ON "library_resources"("schoolId", "status", "audience");

-- CreateIndex
CREATE INDEX "library_resources_schoolId_categoryId_idx" ON "library_resources"("schoolId", "categoryId");

-- CreateIndex
CREATE INDEX "library_resources_schoolId_createdAt_idx" ON "library_resources"("schoolId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "library_files_storageKey_key" ON "library_files"("storageKey");

-- CreateIndex
CREATE INDEX "library_files_schoolId_resourceId_idx" ON "library_files"("schoolId", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "library_files_resourceId_version_key" ON "library_files"("resourceId", "version");

-- CreateIndex
CREATE INDEX "library_resource_classes_schoolId_classId_idx" ON "library_resource_classes"("schoolId", "classId");

-- CreateIndex
CREATE INDEX "library_resource_subjects_schoolId_subjectId_idx" ON "library_resource_subjects"("schoolId", "subjectId");

-- CreateIndex
CREATE INDEX "library_events_schoolId_resourceId_outcome_createdAt_idx" ON "library_events"("schoolId", "resourceId", "outcome", "createdAt");

-- CreateIndex
CREATE INDEX "library_events_schoolId_createdAt_idx" ON "library_events"("schoolId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "library_pins_studentId_key" ON "library_pins"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "library_sessions_tokenHash_key" ON "library_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "library_sessions_schoolId_expiresAt_idx" ON "library_sessions"("schoolId", "expiresAt");

-- AddForeignKey
ALTER TABLE "library_categories" ADD CONSTRAINT "library_categories_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_resources" ADD CONSTRAINT "library_resources_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_resources" ADD CONSTRAINT "library_resources_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "library_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_files" ADD CONSTRAINT "library_files_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "library_resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_resource_classes" ADD CONSTRAINT "library_resource_classes_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "library_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_resource_classes" ADD CONSTRAINT "library_resource_classes_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_resource_subjects" ADD CONSTRAINT "library_resource_subjects_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "library_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_resource_subjects" ADD CONSTRAINT "library_resource_subjects_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_resource_staff" ADD CONSTRAINT "library_resource_staff_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "library_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_resource_staff" ADD CONSTRAINT "library_resource_staff_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_events" ADD CONSTRAINT "library_events_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "library_resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_pins" ADD CONSTRAINT "library_pins_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_pins" ADD CONSTRAINT "library_pins_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_sessions" ADD CONSTRAINT "library_sessions_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_sessions" ADD CONSTRAINT "library_sessions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_sessions" ADD CONSTRAINT "library_sessions_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One current file per resource; older versions stay as history.
CREATE UNIQUE INDEX "library_files_one_current" ON "library_files" ("resourceId") WHERE "isCurrent";
ALTER TABLE "library_files" ADD CONSTRAINT "library_files_size_check" CHECK ("sizeBytes" > 0);
ALTER TABLE "library_files" ADD CONSTRAINT "library_files_version_check" CHECK ("version" >= 1);

-- A restricted-audience, public or other resource must always name a category; published resources must have a file (checked in the service);
-- the audience lists only make sense for their audience, which the service enforces. Here: simple value checks.
ALTER TABLE "library_resources" ADD CONSTRAINT "library_resources_title_check" CHECK (length(btrim("title")) > 0);

-- Library events are a record of use: never edited or deleted.
CREATE FUNCTION library_events_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'library events cannot be changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER library_events_no_edit BEFORE UPDATE OR DELETE ON "library_events" FOR EACH ROW EXECUTE FUNCTION library_events_guard();

-- Stored file versions are never edited (replacing a file adds a version) apart from the current flag.
CREATE FUNCTION library_files_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'library files cannot be deleted';
  END IF;
  IF NEW."storageKey" <> OLD."storageKey" OR NEW."sha256" <> OLD."sha256" OR NEW."sizeBytes" <> OLD."sizeBytes" OR NEW."version" <> OLD."version" OR NEW."resourceId" <> OLD."resourceId" THEN
    RAISE EXCEPTION 'a stored library file cannot be changed; add a new version instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER library_files_guard BEFORE UPDATE OR DELETE ON "library_files" FOR EACH ROW EXECUTE FUNCTION library_files_guard();
