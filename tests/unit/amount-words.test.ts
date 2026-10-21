import { describe, expect, it } from "vitest";
import { amountInWords, numberToWordsEn, numberToWordsSw } from "@/lib/finance/words";

describe("amount in words", () => {
  it("writes English numbers", () => {
    expect(numberToWordsEn(0)).toBe("Zero");
    expect(numberToWordsEn(13)).toBe("Thirteen");
    expect(numberToWordsEn(100)).toBe("One Hundred");
    expect(numberToWordsEn(1_000_000)).toBe("One Million");
    expect(numberToWordsEn(1_881_688)).toBe("One Million Eight Hundred Eighty One Thousand Six Hundred Eighty Eight");
    expect(numberToWordsEn(250_000)).toBe("Two Hundred Fifty Thousand");
  });
  it("writes the amount with cents, as on the school's receipts", () => {
    expect(amountInWords(188_168_858, "TZS", "EN")).toBe("TZS One Million Eight Hundred Eighty One Thousand Six Hundred Eighty Eight and Fifty Eight Cents Only");
    expect(amountInWords(100_000_000, "TZS", "EN")).toBe("TZS One Million Only");
    expect(amountInWords(5, "TZS", "EN")).toBe("TZS Zero and Five Cents Only");
  });
  it("writes Kiswahili numbers joined with 'na'", () => {
    expect(numberToWordsSw(1)).toBe("moja");
    expect(numberToWordsSw(21)).toBe("ishirini na moja");
    expect(numberToWordsSw(250)).toBe("mia mbili na hamsini");
    expect(numberToWordsSw(1_000_000)).toBe("milioni moja");
    expect(numberToWordsSw(150_000)).toBe("elfu mia moja na hamsini");
    expect(amountInWords(100_000_000, "TZS", "SW")).toBe("TZS Milioni moja tu");
  });
});
