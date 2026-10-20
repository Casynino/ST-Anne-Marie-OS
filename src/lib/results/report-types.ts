/** The report card document. Built once from locked results; later changes to marks, scales or remarks never alter it. */
export type ReportSnapshot = {
  schema: 1;
  school: { name: string; motto: string | null; address: string | null; phone: string | null; email: string | null };
  student: { id: string; admissionNo: string; name: string; gender: string; dateOfBirth: string };
  term: { id: string; name: string; year: string; startsOn: string; endsOn: string };
  class: { id: string; name: string; stream: string | null; level: string };
  scale: { name: string; bands: { grade: string; min: number; max: number; points: number | null }[]; passMark: number | null; divisionBestN: number | null };
  policy: { absentAs: "EXCLUDE" | "ZERO"; positionBy: "AVERAGE" | "TOTAL"; decimals: number };
  exams: { id: string; name: string; weight: number }[];
  subjects: {
    subjectId: string; name: string; code: string;
    exams: { examId: string; examName: string; status: "SCORED" | "ABSENT" | "EXEMPT"; score: number | null; maxMarks: number; percent: number | null }[];
    percent: number; grade: string | null; points: number | null; position: number | null; classMean: number | null; classCount: number;
  }[];
  summary: {
    total: number; average: number | null; grade: string | null; pointsSum: number | null; division: string | null; subjectCount: number;
    position: number | null; classSize: number; streamPosition: number | null; streamSize: number | null;
  };
  attendance: { recorded: number; present: number; absent: number; late: number; excused: number; ratePct: number | null };
  remarks: { class: string | null; head: string | null };
  generatedAt: string;
};

/** Key-order independent JSON, because the database (jsonb) does not keep the order keys were written in. */
const canonical = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v ?? null);

/** Content equality that ignores the generation time, so regenerating unchanged data does not create a new version. */
export const sameContent = (a: ReportSnapshot, b: ReportSnapshot): boolean => canonical({ ...a, generatedAt: "" }) === canonical({ ...b, generatedAt: "" });
