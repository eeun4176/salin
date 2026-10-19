/**
 * Column Type Detection Tests
 * Number, date and yes/no columns are detected and converted; codes such as
 * IDs, phone numbers and leading-zero values stay text; and converting a
 * single value never loses what was typed.
 */

import { describe, expect, it } from "vitest";

import { content } from "@/test/fixtures";

import { convertValue, inferColumnTypes, parseDate, parseNumber } from "./dataset-inference";

describe("inferColumnTypes", () => {
  it("detects and converts number, date and yes/no columns", () => {
    const result = inferColumnTypes(
      content(
        ["Name", "Pets", "Visit", "Vaccinated"],
        [
          ["Ana", "1,250", "10/18/2026", "Yes"],
          ["Ben", "2.5", "2026-01-05", "no"],
          ["Cara", null, null, null],
        ],
      ),
    );
    expect(result.columns.map((c) => c.type)).toEqual(["text", "number", "date", "boolean"]);
    const [name, pets, visit, vaccinated] = result.columns.map((c) => c.id);
    expect(result.rows.map((r) => [r.values[name], r.values[pets], r.values[visit], r.values[vaccinated]])).toEqual([
      ["Ana", 1250, "2026-10-18", true],
      ["Ben", 2.5, "2026-01-05", false],
      ["Cara", null, null, null],
    ]);
  });

  it("keeps codes and mixed columns as text", () => {
    const result = inferColumnTypes(
      content(
        ["Household ID", "Mobile", "Barangay Code", "Mixed"],
        [
          ["1001", "09171234567", "0042", "12"],
          ["1002", "09181234567", "0043", "twelve"],
        ],
      ),
    );
    expect(result.columns.map((c) => c.type)).toEqual(["text", "text", "text", "text"]);
    expect(result.rows[0].values[result.columns[0].id]).toBe("1001");
  });
});

describe("value parsing", () => {
  it("parses numbers and rejects codes", () => {
    expect(parseNumber("-1,234.5")).toBe(-1234.5);
    expect(parseNumber("0.75")).toBe(0.75);
    expect(parseNumber("007")).toBeNull();
    expect(parseNumber("1,23")).toBeNull();
  });

  it("parses real dates only", () => {
    expect(parseDate("2/29/2028")).toBe("2028-02-29");
    expect(parseDate("2/29/2027")).toBeNull();
    expect(parseDate("2026-13-01")).toBeNull();
  });

  it("converts single values and keeps ones that don't fit", () => {
    expect(convertValue("42", "number")).toBe(42);
    expect(convertValue("forty", "number")).toBe("forty");
    expect(convertValue(true, "text")).toBe("Yes");
    expect(convertValue(3, "text")).toBe("3");
    expect(convertValue("", "date")).toBeNull();
  });
});
