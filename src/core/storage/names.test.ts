/**
 * Name Rules Tests
 * User-entered name validation, import-name clean-up and "(2)" suffixes.
 */

import { describe, expect, it } from "vitest";

import { sanitizeName, uniqueName, validateName } from "./names";

describe("name rules", () => {
  it("validates user-entered names", () => {
    const siblings = [{ id: "1", name: "Reports" }];
    expect(validateName("Budget", siblings)).toBeNull();
    expect(validateName("reports", siblings)).toMatch("already in this folder");
    expect(validateName("Reports", siblings, "1")).toBeNull();
    expect(validateName("a:b", [])).toMatch("can't contain");
    expect(validateName("..", [])).toMatch("different name");
    expect(validateName("x".repeat(256), [])).toMatch("255");
  });

  it("cleans names from imported files", () => {
    expect(sanitizeName("  my:file?.pdf ")).toBe("my_file_.pdf");
    expect(sanitizeName("")).toBe("Untitled");
  });

  it("adds a counter before the extension for files", () => {
    const taken = new Set(["scan.jpg", "scan (2).jpg", "notes"]);
    expect(uniqueName("scan.jpg", taken, true)).toBe("scan (3).jpg");
    expect(uniqueName("notes", taken, false)).toBe("notes (2)");
    expect(uniqueName("fresh.pdf", taken, true)).toBe("fresh.pdf");
  });
});
