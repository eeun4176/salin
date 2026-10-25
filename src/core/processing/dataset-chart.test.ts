/**
 * Dataset Chart Tests
 * The live chart reads numbers and numeric text, skips empty cells and a
 * sheet's own total row, and labels and caps its bars.
 */

import { describe, expect, it } from "vitest";

import { chartNumber, chartSummary, chartableColumns, compactNumber } from "@/core/processing/dataset-chart";
import type { DatasetColumn } from "@/types/processing";

const column = (id: string, type: DatasetColumn["type"]): DatasetColumn => ({ id, name: id, type, required: false, sourceHeader: null });
const rows = [
  { values: { channel: "Search", spend: 42300, note: "₱1,200" } },
  { values: { channel: "Social", spend: "32,300", note: "800" } },
  { values: { channel: "Email", spend: null, note: "" } },
  { values: { channel: "Total", spend: 74600, note: "2000" } },
];

describe("dataset chart", () => {
  it("reads numbers and numeric text, not other text", () => {
    expect(chartNumber(5)).toBe(5);
    expect(chartNumber("₱12,400")).toBe(12400);
    expect(chartNumber("abc")).toBeNull();
    expect(chartNumber(true)).toBeNull();
  });

  it("offers number columns and all-numeric text columns", () => {
    const columns = [column("channel", "text"), column("spend", "number"), column("note", "text")];
    expect(chartableColumns(columns, rows).map((c) => c.id)).toEqual(["spend", "note"]);
  });

  it("skips empty cells and the sheet's own total row", () => {
    const summary = chartSummary(rows, "spend", "channel");
    expect(summary.points).toEqual([
      { label: "Search", value: 42300 },
      { label: "Social", value: 32300 },
    ]);
    expect(summary.total).toBe(74600);
    expect(summary.average).toBe(37300);
    expect(summary.top).toEqual({ label: "Search", value: 42300 });
  });

  it("labels rows by number without a label column and caps the bars", () => {
    const summary = chartSummary(rows, "spend", null, 1);
    expect(summary.points).toEqual([{ label: "Row 1", value: 42300 }]);
    expect(summary.counted).toBe(3);
  });

  it("is empty when nothing is a number", () => {
    expect(chartSummary(rows, "channel", null)).toEqual({ points: [], counted: 0, total: 0, average: 0, top: null });
  });

  it("shortens big numbers for bar labels", () => {
    expect(compactNumber(42300)).toBe("42.3K");
  });
});
