import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { formatDateOnly } from "@/lib/dates";

export type CalendarItem = { id: string; kind: "TERM_START" | "TERM_END" | "EVENT"; title: string; titleSw: string | null; from: string; to: string | null; category: string | null; location: string | null; isPublic: boolean; /** Event details kept so the calendar can edit an event without losing them. */ extra?: { description: string | null; descriptionSw: string | null; coverImage: string | null } };

/** Term dates and school events between two dates. Internal (non-public) events are returned only when `includeInternal` is set. */
export async function schoolCalendar(schoolId: string, from: Date, to: Date, opts: { includeInternal: boolean }): Promise<CalendarItem[]> {
  const [terms, events] = await Promise.all([
    db.term.findMany({ where: { schoolId, OR: [{ startsOn: { gte: from, lte: to } }, { endsOn: { gte: from, lte: to } }] }, include: { academicYear: { select: { name: true } } } }),
    db.schoolEvent.findMany({ where: { schoolId, ...(opts.includeInternal ? {} : { isPublic: true }), OR: [{ startsOn: { gte: from, lte: to } }, { endsOn: { gte: from, lte: to } }, { startsOn: { lte: from }, endsOn: { gte: to } }] }, orderBy: { startsOn: "asc" } }),
  ]);
  const items: CalendarItem[] = [];
  for (const t of terms) {
    const label = `${t.name} ${t.academicYear.name}`;
    if (t.startsOn >= from && t.startsOn <= to) items.push({ id: `${t.id}:s`, kind: "TERM_START", title: `${label} starts`, titleSw: `Muhula wa ${t.name} ${t.academicYear.name} unaanza`, from: formatDateOnly(t.startsOn), to: null, category: "Term", location: null, isPublic: true });
    if (t.endsOn >= from && t.endsOn <= to) items.push({ id: `${t.id}:e`, kind: "TERM_END", title: `${label} ends`, titleSw: `Muhula wa ${t.name} ${t.academicYear.name} unaisha`, from: formatDateOnly(t.endsOn), to: null, category: "Term", location: null, isPublic: true });
  }
  for (const e of events) items.push({ id: e.id, kind: "EVENT", title: e.title, titleSw: e.titleSw, from: formatDateOnly(e.startsOn), to: e.endsOn ? formatDateOnly(e.endsOn) : null, category: e.category, location: e.location, isPublic: e.isPublic, extra: { description: e.description, descriptionSw: e.descriptionSw, coverImage: e.coverImage } });
  return items.sort((a, b) => a.from.localeCompare(b.from) || a.title.localeCompare(b.title));
}

/** Staff see internal events too; the family portal sees public events only. */
export async function calendarFor(ctx: AuthContext, from: Date, to: Date) {
  return schoolCalendar(ctx.schoolId, from, to, { includeInternal: ctx.userType === "STAFF" });
}
