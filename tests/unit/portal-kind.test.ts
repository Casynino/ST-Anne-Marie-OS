import { describe, expect, it } from "vitest";
import { portalOf } from "@/lib/auth/portal";

const staff = (roleKeys: string[], permissions: string[] = []) => ({ userType: "STAFF" as const, roleKeys, permissions: new Set(permissions) });

describe("portalOf", () => {
  it("sends parents and students to the family portal", () => {
    expect(portalOf({ userType: "GUARDIAN", roleKeys: ["parent"] })).toBe("parent");
    expect(portalOf({ userType: "STUDENT", roleKeys: ["student"] })).toBe("student");
  });
  it("gives each staff role its own home", () => {
    expect(portalOf(staff(["super_admin"]))).toBe("admin");
    expect(portalOf(staff(["head_teacher"]))).toBe("head");
    expect(portalOf(staff(["accountant"]))).toBe("accountant");
    expect(portalOf(staff(["registrar"]))).toBe("registrar");
    expect(portalOf(staff(["class_teacher"]))).toBe("teacher");
    expect(portalOf(staff(["subject_teacher"]))).toBe("teacher");
  });
  it("picks the highest role when a person has several", () => {
    expect(portalOf(staff(["class_teacher", "head_teacher"]))).toBe("head");
    expect(portalOf(staff(["registrar", "accountant"]))).toBe("accountant");
    expect(portalOf(staff(["class_teacher", "super_admin"]))).toBe("admin");
    expect(portalOf(staff(["subject_teacher", "registrar"]))).toBe("registrar");
  });
  it("treats a custom role by its permissions", () => {
    expect(portalOf(staff(["custom"], ["attendance.take", "marks.enter"]))).toBe("teacher");
    expect(portalOf(staff(["custom"], ["attendance.take", "student.read"]))).toBe("staff");
    expect(portalOf(staff(["custom"]))).toBe("staff");
  });
});
