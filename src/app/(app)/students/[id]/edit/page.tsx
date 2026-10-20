import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireContext, getT } from "@/lib/auth/next";
import { getStudentProfile } from "@/server/students";
import { AppError } from "@/lib/errors";
import { ActionForm } from "@/components/form";
import { StudentDetailsFields } from "@/components/student-form";
import { Card, NoAccess, PageHeader } from "@/components/ui";
import { updateStudentAction } from "../../actions";

export const metadata: Metadata = { title: "Edit student" };

export default async function EditStudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("student.update")) return <NoAccess t={t} />;
  const student = await getStudentProfile(ctx, id).catch((e) => (e instanceof AppError && e.code === "NOT_FOUND" ? null : Promise.reject(e)));
  if (!student) notFound();
  return (
    <>
      <PageHeader title={`${t("student.profile.edit")} · ${student.admissionNo}`} />
      <Card>
        <ActionForm action={updateStudentAction} submitLabel={t("common.save")}>
          <input type="hidden" name="id" value={student.id} />
          <StudentDetailsFields t={t} d={student} canEditMedical={ctx.permissions.has("student.medical.update") && student.canSeeMedical} />
        </ActionForm>
      </Card>
    </>
  );
}
