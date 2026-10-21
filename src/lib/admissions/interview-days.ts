/*
 * Application windows: the office opens a window for the classes it is taking applications for, with the dates it is open and the interview
 * date already set. An application for one of those classes received while the window is open (and has room) is placed on its interview at
 * once; one received at any other time waits under review, and the office gives it a date when it accepts it. (In the code a window is an
 * "InterviewDay": the window with its interview.) Pure rules only, so they can be tested without a database. Dates are "YYYY-MM-DD" in the
 * school's time zone, times are "HH:MM".
 */

export type InterviewDay = {
  id: string;
  /** What the window is called, for example "Form I intake". */
  name: string;
  /** The classes it is for (empty = every class). */
  classIds: string[];
  /** The day of the interview. */
  on: string;
  time: string;
  /** Where it takes place (may be empty). */
  venue: string;
  /** The window opens on this date (empty = already open). */
  from: string;
  /** ...and closes after this date (empty = open until the interview day itself). */
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
    const { id, name, classIds, on, time, venue, from, until, capacity } = r as Record<string, unknown>;
    if (typeof id !== "string" || typeof on !== "string" || !DATE.test(on) || typeof time !== "string" || !TIME.test(time)) continue;
    out.push({
      id, on, time,
      name: typeof name === "string" ? name : "",
      classIds: Array.isArray(classIds) ? classIds.filter((x): x is string => typeof x === "string") : [],
      venue: typeof venue === "string" ? venue : "",
      from: typeof from === "string" && DATE.test(from) ? from : "",
      until: typeof until === "string" && DATE.test(until) ? until : "",
      capacity: Number.isInteger(capacity) && (capacity as number) > 0 ? (capacity as number) : 0,
    });
  }
  return out.sort((a, b) => `${a.on}T${a.time}`.localeCompare(`${b.on}T${b.time}`));
}

/** Whether the window covers this class (a window with no classes covers every class). */
export const coversClass = (d: InterviewDay, classId: string | null | undefined) => d.classIds.length === 0 || (!!classId && d.classIds.includes(classId));

/** Whether the window is open on `today` (the interview day itself has not passed). */
export function dayOpenOn(d: InterviewDay, today: string): boolean {
  if (d.on < today) return false;
  if (d.from && today < d.from) return false;
  if (d.until && today > d.until) return false;
  return true;
}

/**
 * The window an application for `classId` received today is placed in: the earliest open window for that class that still has room.
 * `placed` is how many applicants each window already has. Returns null when there is none (the office gives a date when it accepts it).
 */
export function pickDay(days: InterviewDay[], today: string, placed: Record<string, number>, classId?: string | null): InterviewDay | null {
  return days.find((d) => coversClass(d, classId) && dayOpenOn(d, today) && (d.capacity === 0 || (placed[d.id] ?? 0) < d.capacity)) ?? null;
}
