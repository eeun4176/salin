/**
 * Census Sheet Code Tests
 * The printed code round-trips, and misread or foreign strips are rejected.
 */

import { describe, expect, it } from "vitest";

import { CODE_BITS, decodeSheetCode, encodeSheetCode, type SheetCode } from "./code-strip";

const code: SheetCode = { version: 1, continuation: false, barangay: 6, censusDate: "2026-10-22", sheetNumber: 7 };

describe("sheet code", () => {
  it("round-trips every field", () => {
    const bits = encodeSheetCode(code);
    expect(bits).toHaveLength(CODE_BITS);
    expect(decodeSheetCode(bits)).toEqual(code);
    expect(decodeSheetCode(encodeSheetCode({ ...code, continuation: true, barangay: 61, censusDate: "2031-02-28", sheetNumber: 4095 }))).toEqual({
      ...code,
      continuation: true,
      barangay: 61,
      censusDate: "2031-02-28",
      sheetNumber: 4095,
    });
  });

  it("rejects any single misread square", () => {
    const bits = encodeSheetCode(code);
    for (let i = 0; i < bits.length; i++) {
      const misread = [...bits];
      misread[i] ^= 1;
      expect(decodeSheetCode(misread)).toBeNull();
    }
  });

  it("rejects blank strips, the wrong length and values it can't hold", () => {
    expect(decodeSheetCode(new Array(CODE_BITS).fill(0))).toBeNull();
    expect(decodeSheetCode(encodeSheetCode(code).slice(1))).toBeNull();
    expect(() => encodeSheetCode({ ...code, sheetNumber: 5000 })).toThrow(RangeError);
  });
});
