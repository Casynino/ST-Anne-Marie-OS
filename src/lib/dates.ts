// Calendar dates are @db.Date columns. Prisma returns them as UTC-midnight Date objects,
// so ALL formatting/parsing here uses UTC to avoid off-by-one-day shifts.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDateOnly(value: string): Date | null {
  const m = DATE_RE.exec(value);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // Reject overflow such as 2026-02-31.
  return d.toISOString().slice(0, 10) === value ? d : null;
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's calendar date in the school's timezone (e.g. Africa/Dar_es_Salaam). */
export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

const DISPLAY_LOCALES = { EN: "en-GB", SW: "sw-TZ" } as const;

export function displayDate(date: Date | null | undefined, locale: "EN" | "SW" = "EN"): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat(DISPLAY_LOCALES[locale], {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function displayDateTime(date: Date | null | undefined, timezone: string, locale: "EN" | "SW" = "EN"): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat(DISPLAY_LOCALES[locale], {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Whole years between a calendar date of birth and "today" (both UTC calendar dates). */
export function ageOn(dob: Date, today: Date = new Date()): number {
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday = today.getUTCMonth() < dob.getUTCMonth() || (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/** Offset (ms) of a time zone from UTC at a given instant. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const o = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return Date.UTC(+o.year!, +o.month! - 1, +o.day!, +o.hour!, +o.minute!, +o.second!) - at.getTime();
}

/** A wall-clock time typed by a user ("2026-10-25T08:00", as from a datetime-local field) in the school's zone, as a UTC instant. */
export function zonedToUtc(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const guess = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  const first = guess - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess - zoneOffsetMs(new Date(first), timeZone));
}
