/*
 * iCalendar (RFC 5545) and RSS 2.0 text builders for the public feeds. Pure functions: they escape every value and fold long lines,
 * so a title with a comma, a semicolon or a line break cannot break the file.
 */

export type IcsEvent = { uid: string; title: string; from: string; to: string | null; description?: string | null; location?: string | null };

const escapeText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const compact = (d: string) => d.replace(/-/g, "");

/** Folds a content line at 75 octets, continuing on lines that start with one space. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let len = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (len + n > (out.length === 0 ? 75 : 74)) { out.push(cur); cur = ""; len = 0; }
    cur += ch; len += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** All-day events; the end date of a range is inclusive in the school's data, exclusive in iCalendar, so one day is added. */
export function buildIcs(calName: string, events: IcsEvent[], stamp = new Date()): string {
  const nextDay = (d: string) => compact(new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10));
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//St Anne Marie Schools//School calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${escapeText(calName)}`];
  const dtstamp = stamp.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${dtstamp}`, `DTSTART;VALUE=DATE:${compact(e.from)}`, `DTEND;VALUE=DATE:${nextDay(e.to ?? e.from)}`, `SUMMARY:${escapeText(e.title)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type RssItem = { title: string; link: string; description: string; date: Date | null; guid: string };

export function buildRss(o: { title: string; link: string; description: string; items: RssItem[] }): string {
  const items = o.items.map((i) => `<item><title>${xml(i.title)}</title><link>${xml(i.link)}</link><guid isPermaLink="false">${xml(i.guid)}</guid>${i.date ? `<pubDate>${i.date.toUTCString()}</pubDate>` : ""}<description>${xml(i.description)}</description></item>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xml(o.title)}</title><link>${xml(o.link)}</link><description>${xml(o.description)}</description>${items}</channel></rss>`;
}
