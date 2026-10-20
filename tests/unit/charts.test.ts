import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { BarList, Donut, TrendChart } from "@/components/charts";

describe("charts render real data accessibly", () => {
  it("BarList prints every value and a summary, and scales bars to the largest", () => {
    const html = renderToStaticMarkup(createElement(BarList, { items: [{ label: "Form I", value: 40 }, { label: "Form II", value: 10 }], label: "Students by class", summary: "Students per class" }));
    expect(html).toContain("Form I");
    expect(html).toContain(">40<");
    expect(html).toContain("width:100%");
    expect(html).toContain("width:25%");
    expect(html).toContain("Students per class (50)");
  });
  it("TrendChart exposes a title, description, tooltips and a data table", () => {
    const points = [{ date: "2026-10-01", rate: 91.5 }, { date: "2026-10-02", rate: 88 }];
    const html = renderToStaticMarkup(createElement(TrendChart, { points, label: "Attendance trend", summary: "Two days recorded", formatDate: (d) => d }));
    expect(html).toContain("<title>Attendance trend</title>");
    expect(html).toContain("<desc>Two days recorded</desc>");
    expect(html).toContain("2026-10-01: 91.5%");
    expect(html).toContain("<table");
  });
  it("TrendChart copes with a single point and Donut with zero totals", () => {
    expect(() => renderToStaticMarkup(createElement(TrendChart, { points: [{ date: "2026-10-01", rate: 100 }], label: "t", summary: "s", formatDate: (d) => d }))).not.toThrow();
    const html = renderToStaticMarkup(createElement(Donut, { segments: [{ label: "Girls", value: 0 }, { label: "Boys", value: 0 }], label: "Gender", summary: "none" }));
    expect(html).toContain("Girls");
    expect(html).not.toContain("NaN");
  });
});
