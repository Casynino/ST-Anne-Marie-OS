import { describe, expect, it } from "vitest";
import { describeDevice, lastDates, maskIdentifier } from "@/server/ops";
import { scrub } from "@/server/monitor";

describe("dashboard helpers", () => {
  it("describes devices from the browser string", () => {
    expect(describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36")).toEqual({ label: "Chrome · Mac", mobile: false });
    expect(describeDevice("Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36")).toEqual({ label: "Chrome · Android", mobile: true });
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1").label).toBe("Safari · iPhone/iPad");
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120").label).toBe("Edge · Windows");
    expect(describeDevice(null).label).toBe("Unknown device");
  });

  it("masks phone numbers but shows e-mail addresses to the administrator", () => {
    expect(maskIdentifier("0712345678")).toBe("0712••••78");
    expect(maskIdentifier("+255712345678")).not.toContain("2345");
    expect(maskIdentifier("parent@example.com")).toBe("parent@example.com");
    expect(maskIdentifier("admin")).toBe("admin");
  });

  it("lists the last 14 school-time dates, oldest first", () => {
    const d = lastDates("Africa/Dar_es_Salaam", 14, new Date("2026-10-21T22:30:00Z")); // already 22 Oct in Dar es Salaam
    expect(d).toHaveLength(14);
    expect(d[13]).toBe("2026-10-22");
    expect(d[0]).toBe("2026-10-09");
  });

  it("scrubs error messages before they are stored", () => {
    const s = scrub("Failed for amina@example.com phone 0712345678\n  at line 3 " + "x".repeat(400));
    expect(s).not.toMatch(/@example|0712345678|\n/);
    expect(s.length).toBeLessThanOrEqual(200);
    expect(s).toContain("[email]");
  });
});
