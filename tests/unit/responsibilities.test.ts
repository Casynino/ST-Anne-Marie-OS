import { describe, expect, it } from "vitest";
import { SYSTEM_ROLES } from "@/lib/rbac/roles";
import { applyOversight } from "@/lib/rbac/oversight";
import type { PermissionKey } from "@/lib/rbac/permissions";

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
    none("registrar", [...MONEY, /^marks\./, /^results\./, /^progression\.(approve|head_approve|exception)$/, /^transfer\./, /^attendance\.(take|staff\.record)/, ...OWNER_ONLY]);
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

describe("the owner oversees and does not do the departments' work", () => {
  const held = (key: string) => new Set<PermissionKey>(SYSTEM_ROLES.find((r) => r.key === key)!.permissions as readonly PermissionKey[]);
  const owner = (roleKeys: string[], stepInUntil: number | null = null, now = 1_000) =>
    applyOversight({ userId: "u", userType: "STAFF", schoolId: "s", branchId: null, fullName: "Owner", locale: "EN", mustChangePassword: false, staffId: null, roleKeys, permissions: held("super_admin"), meta: { ip: null, userAgent: null } }, stepInUntil, now);

  it("by default the owner can view and govern but holds no daily-work permission", () => {
    const p = owner(["super_admin"]).permissions;
    for (const k of ["executive.read", "user.create", "role.manage", "school.settings.update", "audit.read", "backup.read", "expense.approve_high", "refund.approve_high", "finance.reports", "student.read", "registration.read", "admission.read", "attendance.read"] as const) expect(p.has(k), `owner should hold ${k}`).toBe(true);
    for (const k of ["student.enroll", "student.create", "student.update", "student.status_change", "registration.manage", "admission.review", "admission.enrol", "payment.record", "payment.reverse", "admission.payment.verify", "invoice.generate", "fees.manage", "expense.manage", "expense.approve", "refund.approve", "marks.enter", "marks.enter_any", "results.approve", "results.lock", "progression.approve", "attendance.take", "attendance.take_any", "attendance.correct", "academic.manage", "academic.assign", "reportcard.publish", "student.medical.read", "transfer.approve"] as const) expect(p.has(k), `owner must not hold ${k}`).toBe(false);
  });
  it("stepping in (until a time that has not passed) gives the full set back, and only that long", () => {
    expect(owner(["super_admin"], 5_000, 1_000).permissions.has("registration.manage")).toBe(true);
    expect(owner(["super_admin"], 5_000, 1_000).oversight).toBe(false);
    expect(owner(["super_admin"], 5_000, 9_000).permissions.has("registration.manage")).toBe(false);
  });
  it("only an owner is reduced: a department's own role is never cut, and a cookie gives nobody else anything", () => {
    const reg = applyOversight({ userId: "r", userType: "STAFF", schoolId: "s", branchId: null, fullName: "R", locale: "EN", mustChangePassword: false, staffId: null, roleKeys: ["registrar"], permissions: held("registrar"), meta: { ip: null, userAgent: null } }, 5_000, 1_000);
    expect(reg.permissions.size).toBe(held("registrar").size);
    expect(owner(["super_admin", "registrar"]).permissions.has("registration.manage")).toBe(true); // an owner who also holds a department role keeps that department's work
  });
});
