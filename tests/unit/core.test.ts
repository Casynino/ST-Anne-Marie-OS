import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizeIdentifier, normalizePhone } from "@/lib/phone";
import { formatDateOnly, parseDateOnly, todayInTimezone } from "@/lib/dates";
import { generateTemporaryPassword, hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth/password";
import { formatAdmissionNo } from "@/server/students";
import { ALL_PERMISSION_KEYS } from "@/lib/rbac/permissions";
import { SYSTEM_ROLES } from "@/lib/rbac/roles";

describe("phone normalisation", () => {
  it.each([
    ["0712 345 678", "+255712345678"],
    ["712345678", "+255712345678"],
    ["255712345678", "+255712345678"],
    ["+255 712-345-678", "+255712345678"],
  ])("normalises %s", (input, expected) => expect(normalizePhone(input)).toBe(expected));

  it.each(["", "12345", "0112345678", "+25571234", "abc"])("rejects %s", (input) => expect(normalizePhone(input)).toBeNull());

  it("accepts international numbers and rejects bad emails", () => {
    expect(normalizePhone("+44 7700 900123")).toBe("+447700900123");
    expect(normalizeEmail("  Teacher@School.TZ ")).toBe("teacher@school.tz");
    expect(normalizeEmail("nope")).toBeNull();
    expect(normalizeIdentifier("0712345678")).toBe("+255712345678");
    expect(normalizeIdentifier("A@b.co")).toBe("a@b.co");
  });
});

describe("calendar dates", () => {
  it("parses and formats without timezone shifts", () => {
    const d = parseDateOnly("2026-01-01") as Date;
    expect(d.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(formatDateOnly(d)).toBe("2026-01-01");
  });
  it("rejects impossible dates", () => {
    expect(parseDateOnly("2026-02-31")).toBeNull();
    expect(parseDateOnly("2026-13-01")).toBeNull();
    expect(parseDateOnly("01/02/2026")).toBeNull();
  });
  it("computes 'today' in the school timezone, not UTC", () => {
    // 22:30 UTC on 31 Dec is already 1 Jan in Dar es Salaam (UTC+3).
    expect(todayInTimezone("Africa/Dar_es_Salaam", new Date("2026-12-31T22:30:00Z"))).toBe("2027-01-01");
    expect(todayInTimezone("UTC", new Date("2026-12-31T22:30:00Z"))).toBe("2026-12-31");
  });
});

describe("passwords", () => {
  it("hashes and verifies; rejects wrong password and malformed hashes", async () => {
    const hash = await hashPassword("Correct-horse-9");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("Correct-horse-9", hash)).toBe(true);
    expect(await verifyPassword("Wrong-horse-9", hash)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
  it("enforces strength rules", () => {
    expect(validatePasswordStrength("short1")).toMatch(/at least 10/);
    expect(validatePasswordStrength("onlyletterslong")).toMatch(/letters and numbers/);
    expect(validatePasswordStrength("Valid-pass-123")).toBeNull();
  });
  it("generates temporary passwords that pass the policy", () => {
    for (let i = 0; i < 20; i++) expect(validatePasswordStrength(generateTemporaryPassword())).toBeNull();
  });
});

describe("admission number format", () => {
  const base = { prefix: "SAM", pattern: "{PREFIX}/{YEAR}/{SEQ}", seqPadding: 4, resetYearly: true };
  it("formats the documented example", () => expect(formatAdmissionNo(base, 2026, 1)).toBe("SAM/2026/0001"));
  it("supports configurable pattern, padding and short year", () => {
    expect(formatAdmissionNo({ ...base, pattern: "{PREFIX}-{YY}-{SEQ}", seqPadding: 3 }, 2026, 42)).toBe("SAM-26-042");
    expect(formatAdmissionNo({ ...base, seqPadding: 2 }, 2026, 12345)).toBe("SAM/2026/12345");
  });
});

describe("permission catalog", () => {
  it("every default role permission exists in the catalog", () => {
    for (const role of SYSTEM_ROLES) for (const p of role.permissions) expect(ALL_PERMISSION_KEYS).toContain(p);
  });
  it("super admin holds every permission; parent/student hold none of the staff permissions", () => {
    expect(SYSTEM_ROLES.find((r) => r.key === "super_admin")?.permissions.length).toBe(ALL_PERMISSION_KEYS.length);
    expect(SYSTEM_ROLES.find((r) => r.key === "parent")?.permissions).toEqual([]);
    expect(SYSTEM_ROLES.find((r) => r.key === "student")?.permissions).toEqual([]);
  });
  it("no role except super admin can manage roles or settings by default", () => {
    for (const role of SYSTEM_ROLES.filter((r) => r.key !== "super_admin")) {
      expect(role.permissions).not.toContain("role.manage");
      expect(role.permissions).not.toContain("school.settings.update");
    }
  });
});

import { zonedToUtc } from "@/lib/dates";
describe("zonedToUtc", () => {
  it("converts a school wall-clock time to a UTC instant", () => {
    expect(zonedToUtc("2026-10-25T08:00", "Africa/Dar_es_Salaam")?.toISOString()).toBe("2026-10-25T05:00:00.000Z"); // UTC+3
    expect(zonedToUtc("2026-01-01T00:30", "Africa/Dar_es_Salaam")?.toISOString()).toBe("2025-12-31T21:30:00.000Z");
    expect(zonedToUtc("2026-07-01T12:00", "UTC")?.toISOString()).toBe("2026-07-01T12:00:00.000Z");
    expect(zonedToUtc("2026-07-01T12:00", "America/New_York")?.toISOString()).toBe("2026-07-01T16:00:00.000Z"); // daylight time
    expect(zonedToUtc("not a date", "UTC")).toBeNull();
    expect(zonedToUtc("2026-07-01", "UTC")).toBeNull();
  });
});
