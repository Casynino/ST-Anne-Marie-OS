import { describe, expect, it } from "vitest";
import { mosaicSpans } from "@/components/site/fx/gallery";

/** Cells occupied on a 4-column desktop grid. */
const cells = (spans: string[]) => spans.reduce((n, s) => n + (s.includes("col-span-4") ? 4 : (s.includes("col-span-2") ? 2 : 1) * (s.includes("row-span-2") ? 2 : 1)), 0);

describe("gallery mosaic", () => {
  it("always fills complete rows of four for any number of photos", () => {
    for (let n = 1; n <= 12; n++) expect(cells(mosaicSpans(n)) % 4, `n=${n}`).toBe(0);
  });
  it("gives a single photo the full width and leaves a full set alone", () => {
    expect(mosaicSpans(1)).toEqual(["sm:col-span-4"]);
    expect(mosaicSpans(8).every((s) => s === "")).toBe(true);
  });
});
