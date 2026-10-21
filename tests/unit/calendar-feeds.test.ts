import { describe, expect, it } from "vitest";
import { daysBetween, itemsOn, monthGrid, monthRange, parseMonth, shiftMonth, termWeek, type CalItem } from "@/lib/calendar-grid";
import { buildIcs, buildRss, foldLine } from "@/lib/ics";

describe("calendar grid", () => {
  it("parses and shifts months", () => {
    expect(parseMonth("2026-10")).toEqual({ year: 2026, month: 10 });
    expect(parseMonth("2026-13")).toBeNull();
    expect(parseMonth("x")).toBeNull();
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });
  it("builds whole Monday-first weeks", () => {
    const g = monthGrid(2026, 10); // 1 October 2026 is a Thursday
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g[0]![0]!.date).toBe("2026-09-28");
    expect(g[0]![3]).toEqual({ date: "2026-10-01", day: 1, inMonth: true });
    expect(g.flat().filter((d) => d.inMonth)).toHaveLength(31);
    expect(monthRange(2026, 2)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("places single-day and range items on the right days", () => {
    const items: CalItem[] = [
      { id: "a", kind: "EVENT", title: "Sports day", from: "2026-10-10", to: null, category: null, location: null, href: null },
      { id: "b", kind: "EVENT", title: "Registration", from: "2026-10-05", to: "2026-10-07", category: null, location: null, href: null },
    ];
    expect(itemsOn(items, "2026-10-10").map((i) => i.id)).toEqual(["a"]);
    expect(itemsOn(items, "2026-10-06").map((i) => i.id)).toEqual(["b"]);
    expect(itemsOn(items, "2026-10-08")).toEqual([]);
  });
  it("counts term weeks and days", () => {
    expect(termWeek("2026-09-07", "2026-12-04", "2026-09-07")).toBe(1);
    expect(termWeek("2026-09-07", "2026-12-04", "2026-09-14")).toBe(2);
    expect(termWeek("2026-09-07", "2026-12-04", "2026-12-05")).toBeNull();
    expect(daysBetween("2026-10-20", "2026-10-27")).toBe(7);
  });
});

describe("feeds", () => {
  it("escapes and folds iCalendar text and ends ranges on the next day", () => {
    const ics = buildIcs("School, calendar", [{ uid: "1@x", title: "Open day; meet, greet\nand tour", from: "2026-10-05", to: "2026-10-07", location: "Hall, Block A" }], new Date("2026-10-01T10:00:00Z"));
    expect(ics).toContain("X-WR-CALNAME:School\\, calendar");
    expect(ics).toContain("SUMMARY:Open day\; meet\\, greet\\nand tour");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261005");
    expect(ics).toContain("DTEND;VALUE=DATE:20261008");
    expect(ics).toContain("DTSTAMP:20261001T100000Z");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(buildIcs("x", [{ uid: "2", title: "One day", from: "2026-10-05", to: null }])).toContain("DTEND;VALUE=DATE:20261006");
  });
  it("folds long lines at 75 octets without splitting characters", () => {
    const long = "SUMMARY:" + "é".repeat(80);
    const folded = foldLine(long);
    for (const part of folded.split("\r\n")) expect(new TextEncoder().encode(part.replace(/^ /, "")).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
  });
  it("escapes XML in the news feed", () => {
    const rss = buildRss({ title: "A & B", link: "https://x.test", description: "d", items: [{ title: "<b>Hi</b>", link: "https://x.test/n/1?a=1&b=2", description: 'say "hi"', date: new Date("2026-10-01T00:00:00Z"), guid: "g1" }] });
    expect(rss).toContain("<title>A &amp; B</title>");
    expect(rss).toContain("&lt;b&gt;Hi&lt;/b&gt;");
    expect(rss).toContain("a=1&amp;b=2");
    expect(rss).toContain("<pubDate>Thu, 01 Oct 2026 00:00:00 GMT</pubDate>");
  });
});
