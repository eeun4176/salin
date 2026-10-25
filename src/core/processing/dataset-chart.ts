/**
 * Dataset Chart
 * What the live chart beside a dataset's grid shows: one bar per row for a
 * chosen number column, labelled by a text column, with the total, the
 * average and the largest row. Pure, so the chart follows every cell edit.
 * Rows labelled "Total" are left out so a sheet's own total row isn't
 * counted twice; cells that aren't numbers are skipped, not read as 0.
 */

import type { CellValue, DatasetColumn } from "@/types/processing";

export interface ChartPoint {
  label: string;
  value: number;
}

export interface ChartSummary {
  /** Bars in row order, at most `limit`. */
  points: ChartPoint[];
  /** Rows with a number, including those beyond `limit`. */
  counted: number;
  total: number;
  average: number;
  top: ChartPoint | null;
}

/** A cell as a number: numbers as they are, and text like "₱12,400" or "8 800"; anything else is null. */
export function chartNumber(value: CellValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[₱$,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** Columns worth charting: typed as numbers, or text columns whose filled cells are all numbers. */
export function chartableColumns(columns: DatasetColumn[], rows: { values: Record<string, CellValue> }[]): DatasetColumn[] {
  return columns.filter((column) => {
    if (column.type === "number") return true;
    if (column.type !== "text") return false;
    const filled = rows.map((row) => row.values[column.id]).filter((value) => value !== null && value !== undefined && value !== "");
    return filled.length > 0 && filled.every((value) => chartNumber(value) !== null);
  });
}

/** Bars for `valueColumnId`, labelled by `labelColumnId` (or "Row n" without one). */
export function chartSummary(rows: { values: Record<string, CellValue> }[], valueColumnId: string, labelColumnId: string | null, limit = 12): ChartSummary {
  const all: ChartPoint[] = [];
  rows.forEach((row, index) => {
    const value = chartNumber(row.values[valueColumnId] ?? null);
    if (value === null) return;
    const label = labelColumnId ? String(row.values[labelColumnId] ?? "").trim() : "";
    if (/^(grand\s+)?total$/i.test(label)) return;
    all.push({ label: label || `Row ${index + 1}`, value });
  });
  const total = all.reduce((sum, point) => sum + point.value, 0);
  const top = all.reduce<ChartPoint | null>((best, point) => (best === null || point.value > best.value ? point : best), null);
  return { points: all.slice(0, limit), counted: all.length, total, average: all.length ? total / all.length : 0, top };
}

/** Short bar labels: 42300 → "42.3k", 1250000 → "1.3M". */
export function compactNumber(value: number): string {
  return new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
