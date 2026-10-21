/*
 * Interview days: dates the school has already set for interviews, before any family applies. An application that is received while a day is
 * open (and has room) is placed on that day at once; one received outside every window waits, and the office gives it a date later.
 * Pure rules only, so they can be tested without a database. Dates are "YYYY-MM-DD" in the school's time zone, times are "HH:MM".
 */

export type InterviewDay = {
  id: string;
  /** The day of the interview. */
  on: string;
  time: string;
  /** Where it takes place (may be empty). */
  venue: string;
  /** Applications received from this date are placed on the day (empty = from the start). */
  from: string;
  /** ...until this date (empty = until the day itself). */
  until: string;
  /** How many applicants fit (0 = no limit). */
  capacity: number;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Reads what is stored, ignoring anything that is not a well-formed day. */
export function cleanDays(raw: unknown): InterviewDay[] {
  if (!Array.isArray(raw)) return [];
  const out: InterviewDay[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const { id, on, time, venue, from, until, capacity } = r as Record<string, unknown>;
    if (typeof id !== "string" || typeof on !== "string" || !DATE.test(on) || typeof time !== "string" || !TIME.test(time)) continue;
    out.push({
      id, on, time,
      venue: typeof venue === "string" ? venue : "",
      from: typeof from === "string" && DATE.test(from) ? from : "",
      until: typeof until === "string" && DATE.test(until) ? until : "",
      capacity: Number.isInteger(capacity) && (capacity as number) > 0 ? (capacity as number) : 0,
    });
  }
  return out.sort((a, b) => `${a.on}T${a.time}`.localeCompare(`${b.on}T${b.time}`));
}

/** Whether an application received on `today` belongs to this day's window (the day itself has not passed). */
export function dayOpenOn(d: InterviewDay, today: string): boolean {
  if (d.on < today) return false;
  if (d.from && today < d.from) return false;
  if (d.until && today > d.until) return false;
  return true;
}

/**
 * The day an application received today is placed on: the earliest day whose window includes today and that still has room.
 * `placed` is how many applicants each day already has. Returns null when there is none (the office gives a date later).
 */
export function pickDay(days: InterviewDay[], today: string, placed: Record<string, number>): InterviewDay | null {
  return days.find((d) => dayOpenOn(d, today) && (d.capacity === 0 || (placed[d.id] ?? 0) < d.capacity)) ?? null;
}
