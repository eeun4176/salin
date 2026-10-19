/**
 * Dataset Validator Tests
 * Structural checks that block saving a malformed dataset, and cell checks
 * that flag empty required cells and values of the wrong type for review.
 */

import { describe, expect, it } from "vitest";

import { content } from "@/test/fixtures";
import type { DatasetColumn } from "@/types/processing";

import { assertValidContent, cellIssue, findCellIssues } from "./dataset-validator";

const column = (type: DatasetColumn["type"], required = false): DatasetColumn => ({
  id: "c1",
  name: "Age",
  type,
  required,
  sourceHeader: null,
});

describe("assertValidContent", () => {
  it("accepts well-formed content", () => {
    const { columns, rows } = content(["Name", "Pet"], [["Ana", "Bantay"], ["Ben", null]]);
    expect(() => assertValidContent(columns, rows)).not.toThrow();
  });

  it("rejects missing, blank and duplicate column names", () => {
    expect(() => assertValidContent([], [])).toThrow("at least one column");
    expect(() => assertValidContent(content(["  "]).columns, [])).toThrow("not valid");
    expect(() => assertValidContent(content(["Name", " name "]).columns, [])).toThrow('more than one column named "name"');
  });

  it("rejects duplicate column ids", () => {
    const { columns } = content(["A", "B"]);
    columns[1].id = columns[0].id;
    expect(() => assertValidContent(columns, [])).toThrow("same id");
  });

  it("rejects rows with unknown columns or unstorable values", () => {
    const { columns, rows } = content(["Name"], [["Ana"]]);
    expect(() => assertValidContent(columns, [{ values: { ghost: "x" }, source: null }])).toThrow("doesn't exist");
    rows[0].values[columns[0].id] = { nested: true } as never;
    expect(() => assertValidContent(columns, rows)).toThrow("can't be stored");
    rows[0].values[columns[0].id] = Number.NaN;
    expect(() => assertValidContent(columns, rows)).toThrow("can't be stored");
  });
});

describe("cell checks", () => {
  it("flags empty required cells only", () => {
    expect(cellIssue(column("text", true), null)).toBe("Age is required.");
    expect(cellIssue(column("text", true), "  ")).toBe("Age is required.");
    expect(cellIssue(column("text"), undefined)).toBeNull();
  });

  it("checks values against the column type", () => {
    expect(cellIssue(column("number"), 12)).toBeNull();
    expect(cellIssue(column("number"), "twelve")).toBe("Age should be a number.");
    expect(cellIssue(column("date"), "2026-10-18")).toBeNull();
    expect(cellIssue(column("date"), "2026-02-30")).toMatch("a date");
    expect(cellIssue(column("date"), "18/10/2026")).toMatch("a date");
    expect(cellIssue(column("boolean"), true)).toBeNull();
    expect(cellIssue(column("boolean"), "yes")).toBe("Age should be yes or no.");
    expect(cellIssue(column("text"), 5)).toBe("Age should be text.");
  });

  it("lists every issue in row order", () => {
    const columns = [column("number", true)];
    const issues = findCellIssues(columns, [{ values: { c1: 3 } }, { values: {} }, { values: { c1: "x" } }]);
    expect(issues).toEqual([
      { row: 1, columnId: "c1", message: "Age is required." },
      { row: 2, columnId: "c1", message: "Age should be a number." },
    ]);
  });
});
