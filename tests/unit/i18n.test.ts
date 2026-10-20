import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/en";
import { sw } from "@/lib/i18n/sw";
import { makeT } from "@/lib/i18n";

describe("i18n", () => {
  it("English and Kiswahili define exactly the same keys, with no empty strings", () => {
    expect(Object.keys(sw).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of Object.entries(sw)) expect(v.trim(), k).not.toBe("");
  });
  it("keeps the same placeholders in both languages", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      if (key === "settings.admission.pattern.hint") continue; // documents literal tokens like {SEQ}
      expect(vars(sw[key]), key).toEqual(vars(en[key]));
    }
  });
  it("interpolates variables", () => {
    expect(makeT("SW")("dash.welcome", { name: "Asha" })).toBe("Karibu, Asha");
    expect(makeT("EN")("common.page", { page: 2, pages: 5 })).toBe("Page 2 of 5");
  });
});
