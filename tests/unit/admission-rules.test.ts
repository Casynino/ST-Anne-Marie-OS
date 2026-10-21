import { describe, expect, it } from "vitest";
import { admissionAccount, docChecklist, docsComplete, slotsOverlap } from "@/lib/admissions/rules";

describe("document checklist", () => {
  it("marks each required type missing, pending, needing correction or verified", () => {
    const l = docChecklist(["BIRTH_CERTIFICATE", "PASSPORT_PHOTO", "IDENTITY", "MEDICAL"], [
      { id: "a", docType: "BIRTH_CERTIFICATE", verification: "VERIFIED" },
      { id: "b", docType: "PASSPORT_PHOTO", verification: "PENDING" },
      { id: "c", docType: "IDENTITY", verification: "NEEDS_CORRECTION" },
      { id: "d", docType: "OTHER", verification: "VERIFIED" },
    ]);
    expect(l.map((x) => x.state)).toEqual(["VERIFIED", "PENDING", "NEEDS_CORRECTION", "MISSING"]);
    expect(docsComplete(l)).toBe(false);
  });
  it("lets a verified copy win over an older rejected one", () => {
    const l = docChecklist(["IDENTITY"], [{ id: "old", docType: "IDENTITY", verification: "NEEDS_CORRECTION" }, { id: "new", docType: "IDENTITY", verification: "VERIFIED" }]);
    expect(l[0]).toEqual({ docType: "IDENTITY", state: "VERIFIED", documentId: "new" });
    expect(docsComplete(l)).toBe(true);
  });
  it("needs nothing when nothing is required", () => expect(docsComplete(docChecklist([], []))).toBe(true));
});

describe("admission account", () => {
  const p = (status: "PENDING" | "VERIFIED" | "REJECTED" | "REVERSED", amountCents: number) => ({ status, amountCents });
  it("counts only verified money", () => {
    const a = admissionAccount(100_000, [p("VERIFIED", 40_000), p("PENDING", 60_000), p("REJECTED", 100_000), p("REVERSED", 100_000)], false);
    expect(a).toMatchObject({ verifiedCents: 40_000, pendingCents: 60_000, balanceCents: 60_000, satisfied: false, status: "PARTIAL" });
  });
  it("is satisfied by verified payments in full, never by pending ones", () => {
    expect(admissionAccount(100_000, [p("VERIFIED", 100_000)], false)).toMatchObject({ satisfied: true, status: "PAID", balanceCents: 0 });
    expect(admissionAccount(100_000, [p("PENDING", 100_000)], false)).toMatchObject({ satisfied: false, status: "VERIFICATION_PENDING" });
    expect(admissionAccount(100_000, [], false)).toMatchObject({ satisfied: false, status: "AWAITING_PAYMENT" });
  });
  it("treats an overpayment as paid and a waiver as an exception", () => {
    expect(admissionAccount(100_000, [p("VERIFIED", 150_000)], false)).toMatchObject({ satisfied: true, balanceCents: 0 });
    expect(admissionAccount(100_000, [], true)).toMatchObject({ satisfied: true, status: "WAIVED" });
  });
  it("requires nothing when the fee is zero", () => expect(admissionAccount(0, [], false)).toMatchObject({ satisfied: true, status: "NOT_REQUIRED" }));
});

describe("interview overlaps", () => {
  const t = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 2, h, m));
  it("detects overlapping appointments and allows back-to-back ones", () => {
    expect(slotsOverlap({ start: t(9), minutes: 30 }, { start: t(9, 15), minutes: 30 })).toBe(true);
    expect(slotsOverlap({ start: t(9), minutes: 30 }, { start: t(9, 30), minutes: 30 })).toBe(false);
    expect(slotsOverlap({ start: t(9), minutes: 60 }, { start: t(9, 30), minutes: 10 })).toBe(true);
    expect(slotsOverlap({ start: t(10), minutes: 30 }, { start: t(9), minutes: 30 })).toBe(false);
  });
});
