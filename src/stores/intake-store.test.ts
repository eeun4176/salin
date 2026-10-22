/**
 * Intake Validation Tests
 * Imports take PDF, XLSX, CSV, PNG and JPG; scans take photos and PDFs
 * (JPG, PNG, PDF). Anything else — or a file over 50 MB — is refused with a
 * reason the user can act on.
 */

import { describe, expect, it } from "vitest";

import { MAX_FILE_BYTES, toIntakeFiles } from "./intake-store";

const file = (name: string, size = 10) => new File([new Uint8Array(size)], name);
const names = (files: { name: string }[]) => files.map((f) => f.name);

describe("toIntakeFiles", () => {
  it("imports PDF, XLSX, CSV, PNG and JPG only", () => {
    const { ok, rejected } = toIntakeFiles([file("a.csv"), file("b.XLSX"), file("c.pdf"), file("d.png"), file("e.jpg"), file("f.txt"), file("g.webp")], "import");
    expect(names(ok)).toEqual(["a.csv", "b.XLSX", "c.pdf", "d.png", "e.jpg"]);
    expect(rejected).toEqual(["f.txt", "g.webp"].map((name) => ({ name, reason: "Use a PDF, XLSX, CSV, PNG or JPG file" })));
  });

  it("scans JPG, PNG and PDF only", () => {
    const { ok, rejected } = toIntakeFiles([file("a.jpeg"), file("b.png"), file("c.pdf"), file("d.csv"), file("e.webp")], "scan");
    expect(names(ok)).toEqual(["a.jpeg", "b.png", "c.pdf"]);
    expect(ok.map((f) => f.kind)).toEqual(["jpg", "png", "pdf"]);
    expect(names(rejected)).toEqual(["d.csv", "e.webp"]);
  });

  it("refuses files over 50 MB", () => {
    expect(toIntakeFiles([file("big.csv", MAX_FILE_BYTES + 1)], "import").rejected).toEqual([{ name: "big.csv", reason: "Larger than 50 MB" }]);
  });
});
