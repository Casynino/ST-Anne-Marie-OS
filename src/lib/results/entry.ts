/** Pure validation of one typed mark. A missing mark is "not entered"; it is never turned into a zero. */

export type MarkStatusValue = "SCORED" | "ABSENT" | "EXEMPT";
export type RawMark = { status?: string | null; score?: string | number | null };
export type CleanMark = { status: MarkStatusValue; score: number | null };
export type MarkCheck = { ok: true; value: CleanMark | null } | { ok: false; error: string };

const STATUSES = new Set(["SCORED", "ABSENT", "EXEMPT"]);

export function normalizeMark(raw: RawMark, maxMarks: number): MarkCheck {
  const status = typeof raw.status === "string" && raw.status.trim() !== "" ? raw.status.trim().toUpperCase() : null;
  if (status !== null && !STATUSES.has(status)) return { ok: false, error: "Invalid status" };
  const scoreText = raw.score === null || raw.score === undefined ? "" : String(raw.score).trim().replace(",", ".");

  if (status === "ABSENT" || status === "EXEMPT") {
    if (scoreText !== "") return { ok: false, error: `A score cannot be entered for a student marked ${status === "ABSENT" ? "absent" : "exempt"}` };
    return { ok: true, value: { status, score: null } };
  }
  if (scoreText === "") {
    if (status === "SCORED") return { ok: false, error: "Enter a score" };
    return { ok: true, value: null }; // nothing typed: not entered yet
  }
  if (!/^\d+(\.\d{1,2})?$/.test(scoreText)) {
    if (/^-/.test(scoreText)) return { ok: false, error: "Score cannot be negative" };
    if (/^\d+\.\d{3,}$/.test(scoreText)) return { ok: false, error: "At most 2 decimals" };
    return { ok: false, error: "Enter a number" };
  }
  const score = Number(scoreText);
  if (!Number.isFinite(score)) return { ok: false, error: "Enter a number" };
  if (score > maxMarks) return { ok: false, error: `Cannot be more than ${maxMarks}` };
  return { ok: true, value: { status: "SCORED", score } };
}
