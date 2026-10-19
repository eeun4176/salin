/**
 * Accuracy & Problem-File Tests
 * Character and word error rates and field-level accuracy (kept separate,
 * as the benchmark reports them), and the reasons given for files that
 * can't be previewed: damaged, password-protected, empty, or another format
 * hiding under a file's extension.
 */

import { describe, expect, it } from "vitest";

import { characterErrorRate, fieldAccuracy, levenshtein, wordErrorRate } from "@/core/ocr/benchmark/accuracy";
import { diagnoseProblem } from "@/features/workspace/thumbnails";

describe("recognition accuracy", () => {
  it("counts edits between sequences", () => {
    expect(levenshtein([..."kitten"], [..."sitting"])).toBe(3);
    expect(levenshtein([], [..."abc"])).toBe(3);
  });

  it("measures characters and words separately, ignoring spacing and case", () => {
    expect(characterErrorRate("Juan  Dela Cruz", "juan dela cruz")).toBe(0);
    expect(characterErrorRate("Bantay", "Bantey")).toBeCloseTo(1 / 6);
    expect(wordErrorRate("Owner: Juan Dela Cruz", "Owner: Juan Del Cruz")).toBe(0.25);
    expect(wordErrorRate("", "")).toBe(0);
  });

  it("scores extracted fields against verified values", () => {
    const score = fieldAccuracy({ owner: "Juan Dela Cruz", pet: "Bantay", age: "2" }, { owner: "juan dela cruz", pet: "Bantey" });
    expect(score).toMatchObject({ correct: 1, total: 3 });
    expect(score.scores.find((s) => s.key === "age")?.actual).toBe("");
  });
});

describe("files that can't be previewed", () => {
  const bytes = (...b: number[]) => new Uint8Array(b);

  it("explains why from the file's first bytes and the error", () => {
    expect(diagnoseProblem("pdf", bytes(0x25, 0x50, 0x44, 0x46), { name: "PasswordException" })).toBe("locked");
    expect(diagnoseProblem("pdf", bytes(0x25, 0x50, 0x44, 0x46), new Error("Invalid PDF structure"))).toBe("damaged");
    expect(diagnoseProblem("png", bytes(0x89, 0x50, 0x4e, 0x47), new Error("decode"))).toBe("damaged");
    // A HEIC photo saved as .jpg: not damaged, just a format this browser can't show.
    expect(diagnoseProblem("jpg", bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70), new Error("decode"))).toBe("unsupported");
    // An old .xls (or an encrypted .xlsx) under an .xlsx name.
    expect(diagnoseProblem("xlsx", bytes(0xd0, 0xcf, 0x11, 0xe0), new Error("zip"))).toBe("unsupported");
    expect(diagnoseProblem("xlsx", bytes(1, 2, 3, 4), new Error("File is password-protected"))).toBe("locked");
    expect(diagnoseProblem("png", bytes(), new Error("decode"))).toBe("empty");
    expect(diagnoseProblem("csv", bytes(1, 2), new Error("?"))).toBeNull();
  });
});
