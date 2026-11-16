import { describe, expect, it } from "vitest";
import { SYSTEM_ROLES } from "@/lib/rbac/roles";

/*
 * Who may do what, written down as a guard (Nino's responsibility brief, 2026-11-16). Each department keeps its own work: this fails if a
 * default role ever gains a permission that belongs to another department. The owner (super_admin) holds everything by design, but the
 * owner-only keys below must reach nobody else by default.
 */
const role = (key: string) => new Set<string>(SYSTEM_ROLES.find((r) => r.key === key)!.permissions);
const none = (key: string, keys: (string | RegExp)[]) => {
  const have = role(key);
  const bad = [...have].filter((p) => keys.some((k) => (typeof k === "string" ? p === k : k.test(p))));
  expect(bad, `${key} must not hold ${bad.join(", ")}`).toEqual([]);
};
const MARKS = [/^marks\./, /^results\./, /^exam\.manage$/, /^reportcard\.(generate|publish)$/, /^grading\./];
const MONEY = [/^payment\./, /^invoice\./, /^fees\.(manage|discount)$/, /^refund\./, /^expense\./, /^finance\./, /^admission\.payment\./];
const ADMISSIONS_WORK = [/^admission\.(create|review|enrol|documents\.verify|offer\.approve|override)$/, /^student\.(create|update|status_change|import)$/, "registration.manage"];
const PROGRESSION = [/^progression\./, /^transfer\./];
const OWNER_ONLY = ["executive.read", "expense.approve_high", "refund.approve_high"];

describe("departments keep their own work", () => {
  it("Finance does not touch academic results, admissions decisions or progression", () => {
    none("accountant", [...MARKS, ...ADMISSIONS_WORK, ...PROGRESSION, /^attendance\.take/, ...OWNER_ONLY]);
    expect(role("accountant").has("payment.record") && role("accountant").has("admission.payment.verify")).toBe(true);
  });
  it("Admissions does not verify money, enter marks or decide progression", () => {
    none("registrar", [...MONEY, /^marks\./, /^results\./, /^progression\.(approve|head_approve|exception)$/, /^transfer\./, /^attendance\.take/, ...OWNER_ONLY]);
    expect(role("registrar").has("admission.review") && role("registrar").has("admission.enrol")).toBe(true);
  });
  it("The Academic Office does not touch money or process admissions applications", () => {
    none("academic_office", [...MONEY, /^admission\.(create|review|enrol|documents\.verify|offer\.approve|override)$/, /^student\.(create|update|status_change)$/, "registration.manage", ...OWNER_ONLY]);
    expect(role("academic_office").has("progression.approve") && role("academic_office").has("results.approve")).toBe(true);
  });
  it("Teachers have no money, admissions, registration or progression powers and cannot approve or lock results", () => {
    for (const key of ["class_teacher", "subject_teacher"]) none(key, [...MONEY, ...ADMISSIONS_WORK, ...PROGRESSION, /^results\.(approve|lock|unlock)$/, /^exam\.manage$/, ...OWNER_ONLY]);
  });
  it("The Head Teacher oversees but does not record or verify money, and holds nothing reserved for the owner", () => {
    none("head_teacher", [/^payment\./, /^invoice\./, "fees.manage", "expense.manage", "refund.request", "admission.payment.verify", ...OWNER_ONLY]);
  });
  it("only the owner holds the owner-only permissions; portal roles hold no staff permissions", () => {
    for (const r of SYSTEM_ROLES.filter((x) => x.key !== "super_admin" && x.key !== "parent" && x.key !== "student")) none(r.key, OWNER_ONLY);
    expect(role("super_admin").has("executive.read") && role("super_admin").has("expense.approve_high") && role("super_admin").has("refund.approve_high")).toBe(true);
    expect(role("parent").size + role("student").size).toBe(0);
  });
});
