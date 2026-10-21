import { describe, expect, it } from "vitest";
import { cleanDays, dayOpenOn, pickDay, type InterviewDay } from "@/lib/admissions/interview-days";

const day = (id: string, on: string, extra: Partial<InterviewDay> = {}): InterviewDay => ({ id, on, time: "09:00", venue: "", from: "", until: "", capacity: 0, ...extra });

describe("interview days", () => {
  it("reads only well-formed stored days and keeps them in date order", () => {
    const out = cleanDays([{ id: "b", on: "2026-11-20", time: "09:00" }, { id: "a", on: "2026-11-02", time: "14:30", venue: "Hall", capacity: 20 }, { id: "x", on: "bad", time: "09:00" }, { id: "y", on: "2026-11-03", time: "25:00" }, null, "z"]);
    expect(out.map((d) => d.id)).toEqual(["a", "b"]);
    expect(out[0]).toMatchObject({ venue: "Hall", capacity: 20, from: "", until: "" });
    expect(cleanDays(undefined)).toEqual([]);
  });

  it("a day is open for applications received inside its window, until the day itself has passed", () => {
    const d = day("a", "2026-11-10", { from: "2026-11-01", until: "2026-11-05" });
    expect(dayOpenOn(d, "2026-10-31")).toBe(false);
    expect(dayOpenOn(d, "2026-11-01")).toBe(true);
    expect(dayOpenOn(d, "2026-11-05")).toBe(true);
    expect(dayOpenOn(d, "2026-11-06")).toBe(false);
    expect(dayOpenOn(day("b", "2026-11-10"), "2026-11-10")).toBe(true); // no window: any time up to the day
    expect(dayOpenOn(day("b", "2026-11-10"), "2026-11-11")).toBe(false);
  });

  it("places an application on the earliest open day that still has room, and on none when every day is full or closed", () => {
    const days = [day("a", "2026-11-05", { capacity: 2 }), day("b", "2026-11-12"), day("c", "2026-11-20", { from: "2026-11-10" })];
    expect(pickDay(days, "2026-11-01", {})?.id).toBe("a");
    expect(pickDay(days, "2026-11-01", { a: 1 })?.id).toBe("a");
    expect(pickDay(days, "2026-11-01", { a: 2 })?.id).toBe("b"); // a is full
    expect(pickDay(days, "2026-11-06", { a: 0 })?.id).toBe("b"); // a has passed
    expect(pickDay([day("a", "2026-11-05", { capacity: 1 })], "2026-11-01", { a: 1 })).toBeNull();
    expect(pickDay([day("c", "2026-11-20", { from: "2026-11-10" })], "2026-11-01", {})).toBeNull(); // outside the window
    expect(pickDay([], "2026-11-01", {})).toBeNull();
  });
});
