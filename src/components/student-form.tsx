import type { Translate } from "@/lib/i18n";
import { Field } from "@/components/form";
import { formatDateOnly } from "@/lib/dates";

type StudentDefaults = {
  firstName?: string; middleName?: string | null; lastName?: string; dateOfBirth?: Date; gender?: string; admissionDate?: Date;
  nationality?: string | null; religion?: string | null; birthCertificateNo?: string | null; previousSchool?: string | null; address?: string | null; medicalNotes?: string | null;
};

/** Personal-details fields shared by the registration and edit forms. */
export function StudentDetailsFields({ t, d = {}, showAdmissionDate, canEditMedical }: { t: Translate; d?: StudentDefaults; showAdmissionDate?: boolean; canEditMedical: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field name="firstName" label={t("student.firstName")} defaultValue={d.firstName} required autoComplete="off" />
      <Field name="middleName" label={t("student.middleName")} defaultValue={d.middleName} optionalLabel={t("common.optional")} />
      <Field name="lastName" label={t("student.lastName")} defaultValue={d.lastName} required />
      <Field name="dateOfBirth" label={t("student.dob")} type="date" defaultValue={d.dateOfBirth ? formatDateOnly(d.dateOfBirth) : undefined} required />
      <Field name="gender" label={t("student.gender")} type="select" defaultValue={d.gender} options={[{ value: "MALE", label: t("student.male") }, { value: "FEMALE", label: t("student.female") }]} placeholder={t("common.select")} required />
      {showAdmissionDate && <Field name="admissionDate" label={t("student.admissionDate")} type="date" optionalLabel={t("common.optional")} />}
      <Field name="nationality" label={t("student.nationality")} defaultValue={d.nationality ?? (showAdmissionDate ? "Tanzanian" : undefined)} optionalLabel={t("common.optional")} />
      <Field name="religion" label={t("student.religion")} defaultValue={d.religion} optionalLabel={t("common.optional")} />
      <Field name="birthCertificateNo" label={t("student.birthCert")} defaultValue={d.birthCertificateNo} optionalLabel={t("common.optional")} />
      <Field name="previousSchool" label={t("student.previousSchool")} defaultValue={d.previousSchool} optionalLabel={t("common.optional")} className="sm:col-span-2" />
      <Field name="address" label={t("common.address")} defaultValue={d.address} optionalLabel={t("common.optional")} />
      {canEditMedical && <Field name="medicalNotes" label={t("student.medical")} type="textarea" defaultValue={d.medicalNotes} hint={t("student.medical.hint")} optionalLabel={t("common.optional")} className="sm:col-span-3" />}
    </div>
  );
}
