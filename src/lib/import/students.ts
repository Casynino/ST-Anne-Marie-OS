import { parseDateOnly } from "@/lib/dates";
import { normalizeEmail, normalizePhone } from "@/lib/phone";

/*
 * Pure (database-free) logic for the student CSV import: header detection and per-row validation.
 * Dates are day-first (Tanzania): 05/03/2018 is 5 March 2018. ISO 2018-03-05 is also accepted.
 */

export const IMPORT_FIELDS = [
  "firstName", "middleName", "lastName", "dateOfBirth", "gender", "admissionNo", "admissionDate", "className", "streamName",
  "nationality", "religion", "birthCertificateNo", "previousSchool", "address",
  "guardianName", "guardianPhone", "guardianRelationship", "guardianEmail",
  "guardian2Name", "guardian2Phone", "guardian2Relationship",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const REQUIRED_FIELDS: readonly ImportField[] = ["firstName", "lastName", "dateOfBirth", "gender", "guardianName", "guardianPhone"];

/** Column names accepted for each field (compared after lower-casing and removing non-alphanumerics). English and Kiswahili. */
const SYNONYMS: Record<ImportField, string[]> = {
  firstName: ["firstname", "first", "givenname", "forename", "jinalakwanza"],
  middleName: ["middlename", "middle", "jinalakati"],
  lastName: ["lastname", "surname", "familyname", "last", "jinalamwisho", "jinalaukoo"],
  dateOfBirth: ["dateofbirth", "dob", "birthdate", "birthday", "dateborn", "tarehe yakuzaliwa".replace(/\s/g, ""), "tareheyakuzaliwa"],
  gender: ["gender", "sex", "jinsia"],
  admissionNo: ["admissionno", "admissionnumber", "admno", "admissionnum", "regno", "registrationno", "registrationnumber", "nambayaudahili"],
  admissionDate: ["admissiondate", "dateadmitted", "dateofadmission", "admitted", "tareheyaudahili"],
  className: ["class", "classname", "standard", "grade", "form", "darasa"],
  streamName: ["stream", "streamname", "section", "mkondo"],
  nationality: ["nationality", "uraia"],
  religion: ["religion", "dini"],
  birthCertificateNo: ["birthcertificateno", "birthcertificatenumber", "birthcertno", "birthcert", "certificateno", "nambayacheticakuzaliwa"],
  previousSchool: ["previousschool", "formerschool", "lastschool", "shuleyaawali"],
  address: ["address", "residence", "anwani", "makazi"],
  guardianName: ["guardianname", "guardian", "parentname", "parent", "jinalamzazi", "jinalamlezi", "guardian1name", "guardian1"],
  guardianPhone: ["guardianphone", "parentphone", "guardianphoneno", "guardianmobile", "parentmobile", "phone", "mobile", "simu", "simuyamzazi", "guardian1phone"],
  guardianRelationship: ["guardianrelationship", "relationship", "relation", "uhusiano", "guardian1relationship"],
  guardianEmail: ["guardianemail", "parentemail", "email", "guardian1email"],
  guardian2Name: ["guardian2name", "guardian2", "secondguardian", "secondguardianname", "parent2name", "mzazi2"],
  guardian2Phone: ["guardian2phone", "secondguardianphone", "parent2phone", "simuyamzazi2"],
  guardian2Relationship: ["guardian2relationship", "secondguardianrelationship", "uhusiano2"],
};

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

export type HeaderMap = Partial<Record<ImportField, number>>;

export function detectHeaders(headers: string[]): { map: HeaderMap; columns: { index: number; header: string; field: ImportField | null }[]; missing: ImportField[] } {
  const lookup = new Map<string, ImportField>();
  for (const f of IMPORT_FIELDS) {
    lookup.set(norm(f), f);
    for (const s of SYNONYMS[f]) if (!lookup.has(s)) lookup.set(s, f);
  }
  const map: HeaderMap = {};
  const columns = headers.map((header, index) => {
    const field = lookup.get(norm(header)) ?? null;
    if (field && map[field] === undefined) map[field] = index;
    return { index, header, field: field && map[field] === index ? field : null };
  });
  return { map, columns, missing: REQUIRED_FIELDS.filter((f) => map[f] === undefined) };
}

export type RawRow = Partial<Record<ImportField, string>>;
export function rowFromCells(cells: string[], map: HeaderMap): RawRow {
  const out: RawRow = {};
  for (const f of IMPORT_FIELDS) {
    const i = map[f];
    if (i !== undefined) {
      const v = (cells[i] ?? "").trim();
      if (v) out[f] = v;
    }
  }
  return out;
}

// ───────────────────────── Value parsers ─────────────────────────

export function parseFlexibleDate(v: string): Date | null {
  const s = v.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const dmy = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(s);
  const [y, m, d] = iso ? [iso[1]!, iso[2]!, iso[3]!] : dmy ? [dmy[3]!, dmy[2]!, dmy[1]!] : [null, null, null];
  if (!y || !m || !d) return null;
  return parseDateOnly(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
}

const GENDERS: Record<string, "MALE" | "FEMALE"> = { m: "MALE", male: "MALE", boy: "MALE", kiume: "MALE", me: "MALE", mwanaume: "MALE", f: "FEMALE", female: "FEMALE", girl: "FEMALE", kike: "FEMALE", ke: "FEMALE", mwanamke: "FEMALE" };
export const parseGender = (v: string) => GENDERS[v.trim().toLowerCase()] ?? null;

const RELATIONSHIPS: Record<string, string> = {
  father: "FATHER", baba: "FATHER", dad: "FATHER", mother: "MOTHER", mama: "MOTHER", mom: "MOTHER", mum: "MOTHER",
  grandparent: "GRANDPARENT", grandfather: "GRANDPARENT", grandmother: "GRANDPARENT", babu: "GRANDPARENT", bibi: "GRANDPARENT",
  uncle: "UNCLE", mjomba: "UNCLE", aunt: "AUNT", auntie: "AUNT", shangazi: "AUNT", sibling: "SIBLING", brother: "SIBLING", sister: "SIBLING", kaka: "SIBLING", dada: "SIBLING",
  guardian: "GUARDIAN", mlezi: "GUARDIAN", other: "OTHER", mwingine: "OTHER",
};
export const parseRelationship = (v: string) => RELATIONSHIPS[v.trim().toLowerCase()] ?? null;

// ───────────────────────── Row validation ─────────────────────────

export type RowMessage = { code: string; field?: ImportField; params?: Record<string, string | number> };

export type ParsedRow = {
  firstName: string;
  middleName?: string;
  lastName: string;
  dateOfBirth: string; // yyyy-mm-dd
  gender: "MALE" | "FEMALE";
  admissionNo?: string;
  admissionDate?: string;
  classId?: string;
  streamId?: string;
  nationality?: string;
  religion?: string;
  birthCertificateNo?: string;
  previousSchool?: string;
  address?: string;
  guardians: { fullName: string; phone: string; relationship: string; email?: string }[];
};

export type ValidationRefs = {
  today: Date;
  classes: { id: string; name: string; nameSw: string | null; streams: { id: string; name: string }[] }[];
};

const MAX = { name: 60, address: 300, school: 150, small: 60, cert: 40, admNo: 40, guardian: 120 } as const;

/** Format and reference checks for one row. Database-dependent checks (duplicates, taken numbers) happen in the service. */
export function validateRow(raw: RawRow, refs: ValidationRefs): { parsed: ParsedRow | null; errors: RowMessage[] } {
  const errors: RowMessage[] = [];
  const err = (code: string, field?: ImportField, params?: RowMessage["params"]) => errors.push({ code, field, params });
  const need = (f: ImportField) => {
    if (!raw[f]) err("REQUIRED", f);
    return raw[f];
  };
  const tooLong = (f: ImportField, max: number) => {
    if (raw[f] && raw[f]!.length > max) err("TOO_LONG", f, { max });
  };

  const firstName = need("firstName");
  const lastName = need("lastName");
  tooLong("firstName", MAX.name);
  tooLong("middleName", MAX.name);
  tooLong("lastName", MAX.name);
  tooLong("nationality", MAX.small);
  tooLong("religion", MAX.small);
  tooLong("previousSchool", MAX.school);
  tooLong("address", MAX.address);
  tooLong("guardianName", MAX.guardian);
  tooLong("guardian2Name", MAX.guardian);

  let dob: Date | null = null;
  if (need("dateOfBirth")) {
    dob = parseFlexibleDate(raw.dateOfBirth!);
    if (!dob) err("INVALID_DATE", "dateOfBirth");
    else if (dob >= refs.today) err("DOB_NOT_PAST", "dateOfBirth");
  }
  let gender: "MALE" | "FEMALE" | null = null;
  if (need("gender")) {
    gender = parseGender(raw.gender!);
    if (!gender) err("INVALID_GENDER", "gender");
  }

  let admissionDate: Date | null = null;
  if (raw.admissionDate) {
    admissionDate = parseFlexibleDate(raw.admissionDate);
    if (!admissionDate) err("INVALID_DATE", "admissionDate");
    else if (admissionDate > refs.today) err("DATE_IN_FUTURE", "admissionDate");
    else if (dob && admissionDate <= dob) err("DOB_AFTER_ADMISSION", "admissionDate");
  }

  if (raw.admissionNo) {
    if (raw.admissionNo.length > MAX.admNo || !/^[A-Za-z0-9][A-Za-z0-9/_.\-]*$/.test(raw.admissionNo)) err("ADMISSION_NO_FORMAT", "admissionNo");
  }

  let classId: string | undefined;
  let streamId: string | undefined;
  if (raw.className) {
    const wanted = raw.className.trim().toLowerCase();
    const cls = refs.classes.find((c) => c.name.toLowerCase() === wanted || c.nameSw?.toLowerCase() === wanted);
    if (!cls) err("UNKNOWN_CLASS", "className", { value: raw.className });
    else {
      classId = cls.id;
      if (cls.streams.length) {
        if (!raw.streamName) err("STREAM_REQUIRED", "streamName");
        else {
          const st = cls.streams.find((s) => s.name.toLowerCase() === raw.streamName!.trim().toLowerCase());
          if (!st) err("UNKNOWN_STREAM", "streamName", { value: raw.streamName });
          else streamId = st.id;
        }
      } else if (raw.streamName) err("UNKNOWN_STREAM", "streamName", { value: raw.streamName });
    }
  } else if (raw.streamName) err("STREAM_WITHOUT_CLASS", "streamName");

  const guardians: ParsedRow["guardians"] = [];
  const addGuardian = (nameF: ImportField, phoneF: ImportField, relF: ImportField, emailF?: ImportField, required = false) => {
    const name = raw[nameF];
    const phone = raw[phoneF];
    if (!name && !phone && !raw[relF]) {
      if (required) {
        err("REQUIRED", nameF);
        err("REQUIRED", phoneF);
      }
      return;
    }
    if (!name) err("REQUIRED", nameF);
    if (!phone) err("REQUIRED", phoneF);
    const normalised = phone ? normalizePhone(phone) : null;
    if (phone && !normalised) err("INVALID_PHONE", phoneF);
    let relationship = "GUARDIAN"; // no relationship column/value: record as the generic "Guardian"
    if (raw[relF]) {
      const r = parseRelationship(raw[relF]!);
      if (!r) err("INVALID_RELATIONSHIP", relF);
      else relationship = r;
    }
    let email: string | undefined;
    if (emailF && raw[emailF]) {
      const e = normalizeEmail(raw[emailF]!);
      if (!e) err("INVALID_EMAIL", emailF);
      else email = e;
    }
    if (name && normalised) guardians.push({ fullName: name, phone: normalised, relationship, ...(email ? { email } : {}) });
  };
  addGuardian("guardianName", "guardianPhone", "guardianRelationship", "guardianEmail", true);
  addGuardian("guardian2Name", "guardian2Phone", "guardian2Relationship");

  if (errors.length || !firstName || !lastName || !dob || !gender) return { parsed: null, errors };
  return {
    parsed: {
      firstName,
      ...(raw.middleName ? { middleName: raw.middleName } : {}),
      lastName,
      dateOfBirth: dob.toISOString().slice(0, 10),
      gender,
      ...(raw.admissionNo ? { admissionNo: raw.admissionNo } : {}),
      ...(admissionDate ? { admissionDate: admissionDate.toISOString().slice(0, 10) } : {}),
      ...(classId ? { classId } : {}),
      ...(streamId ? { streamId } : {}),
      ...(raw.nationality ? { nationality: raw.nationality } : {}),
      ...(raw.religion ? { religion: raw.religion } : {}),
      ...(raw.birthCertificateNo ? { birthCertificateNo: raw.birthCertificateNo } : {}),
      ...(raw.previousSchool ? { previousSchool: raw.previousSchool } : {}),
      ...(raw.address ? { address: raw.address } : {}),
      guardians,
    },
    errors,
  };
}

export const TEMPLATE_HEADERS = [
  "first_name", "middle_name", "last_name", "date_of_birth", "gender", "admission_no", "admission_date", "class", "stream",
  "nationality", "religion", "birth_certificate_no", "previous_school", "address",
  "guardian_name", "guardian_phone", "guardian_relationship", "guardian_email",
  "guardian2_name", "guardian2_phone", "guardian2_relationship",
] as const;
