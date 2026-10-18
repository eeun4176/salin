/**
 * CSV Preview Parser Tests
 * Quoted fields, escaped quotes, line endings, delimiter detection, row cap.
 */

import { describe, expect, it } from "vitest";

import { parseCsvPreview } from "./csv";

describe("CSV preview parser", () => {
  it("parses quoted fields, escaped quotes and CRLF", () => {
    const { rows } = parseCsvPreview('﻿Name,Note\r\n"Doe, Jane","said ""hi""\nthen left"\r\nBob,ok');
    expect(rows).toEqual([
      ["Name", "Note"],
      ["Doe, Jane", 'said "hi"\nthen left'],
      ["Bob", "ok"],
    ]);
  });

  it("detects semicolon and tab delimiters", () => {
    expect(parseCsvPreview("a;b\n1;2").rows).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsvPreview("a\tb\n1\t2").rows).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("caps the number of rows", () => {
    const text = Array.from({ length: 10 }, (_, i) => `row${i}`).join("\n");
    expect(parseCsvPreview(text, 3)).toEqual({ rows: [["row0"], ["row1"], ["row2"]], truncated: true });
  });
});
