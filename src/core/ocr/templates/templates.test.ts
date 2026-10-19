/**
 * Template & Field Mapping Tests
 * Template validation (built-ins, broken definitions, keys), label matching
 * and value parsing, and mapping recognised pages onto the veterinary
 * registration and census templates and generic mode: fuzzy labels,
 * checkbox choices, saved regions, ambiguous matches, continuation pages,
 * totals checked against the rows, unsupported layouts — and missing
 * values staying empty instead of being made up.
 */

import { describe, expect, it } from "vitest";

import { analyzeLayout } from "@/core/ocr/layout/layout-analysis";
import { BUILTIN_TEMPLATES, builtinTemplate } from "@/core/ocr/templates/builtin-templates";
import { extractDocument, type MappingPage } from "@/core/ocr/templates/field-mapping";
import { keyFromLabel, parseTemplate, TemplateError } from "@/core/ocr/templates/template-schema";
import { digitSuggestion, labelSimilarity, matchChoice, parseFormBoolean, parseFormDate } from "@/core/ocr/templates/text-match";
import { checkbox, emptyMarks, line, pageResult } from "@/test/ocr-fixtures";
import type { OcrLine, PageMarks } from "@/types/ocr";

function page(n: number, lines: OcrLine[], marks: PageMarks = emptyMarks()): MappingPage {
  const result = pageResult(lines);
  return { page: n, width: 1000, height: 1400, result, layout: analyzeLayout({ width: 1000, height: 1400, lines, marks }) };
}

const field = (extraction: ReturnType<typeof extractDocument>, key: string, form = 0) => extraction.forms[form].fields.find((f) => f.key === key)!;

describe("template definitions", () => {
  it("ships valid veterinary templates", () => {
    expect(BUILTIN_TEMPLATES.map((t) => t.id)).toEqual(["vet-registration", "vet-census", "vet-consent"]);
    expect(builtinTemplate("vet-consent")?.experimental).toBe(true);
  });

  it("rejects broken definitions with a readable reason", () => {
    const base = { id: "x", name: "X", kind: "form", fields: [{ key: "a", label: "A", type: "text" }] };
    expect(parseTemplate(base).fields[0].required).toBe(false);
    expect(() => parseTemplate({ ...base, fields: [] })).toThrow(TemplateError);
    expect(() => parseTemplate({ ...base, fields: [base.fields[0], base.fields[0]] })).toThrow(/unique/);
    expect(() => parseTemplate({ ...base, fields: [{ key: "a", label: "A", type: "choice" }] })).toThrow(/choices/);
    expect(() => parseTemplate({ ...base, kind: "table", tables: [], summaries: [{ key: "t", label: "T", type: "number", countOf: { table: "nope" } }] })).toThrow();
    expect(keyFromLabel("Owner's Name (Full)")).toBe("owners_name_full");
  });
});

describe("label matching and values", () => {
  it("matches labels despite OCR slips, punctuation and word order", () => {
    expect(labelSimilarity("Owners Name", "Owner's name")).toBe(1);
    expect(labelSimilarity("0wner's Narne", "Owner's name")).toBeGreaterThan(0.6);
    expect(labelSimilarity("Name of the Owner", "Name of owner")).toBeGreaterThan(0.8);
    expect(labelSimilarity("Breed", "Address")).toBeLessThan(0.4);
  });

  it("parses form dates, ticks and choices, and suggests digit fixes without applying them", () => {
    expect(parseFormDate("10/18/2026")).toBe("2026-10-18");
    expect(parseFormDate("Oct. 18, 2026")).toBe("2026-10-18");
    expect(parseFormDate("18 October 2026")).toBe("2026-10-18");
    expect(parseFormDate("2/30/2026")).toBeNull();
    expect(parseFormBoolean("✓")).toBe(true);
    expect(parseFormBoolean("Hindi")).toBe(false);
    expect(matchChoice("cat", ["Dog", "Cat", "Other"])).toBe("Cat");
    expect(matchChoice("horse", ["Dog", "Cat"])).toBeNull();
    expect(digitSuggestion("1O5")).toBe("105");
  });
});

describe("registration form", () => {
  const template = builtinTemplate("vet-registration")!;

  it("maps labelled values and checkbox choices, with confidences and source regions", () => {
    const lines = [
      line(100, [[100, "PET REGISTRATION FORM"]]),
      line(200, [[100, "Name of Owner: Juan Dela Cruz"]]),
      line(250, [[100, "Address: Purok 2, Poblacion"]]),
      line(300, [[100, "Pet Name: Bantay"], [600, "Breed: Aspin"]]),
      line(350, [[100, "Species:"], [230, "Dog"], [330, "Cat"]]),
      line(400, [[100, "Date: 10/18/2026"], [600, "Age: 2 yrs", 60]]),
    ];
    const marks = emptyMarks({ checkboxes: [checkbox(205, 351, "checked"), checkbox(305, 351, "unchecked")] });
    const extraction = extractDocument(template, [page(1, lines, marks)]);
    expect(extraction.unsupported).toBeNull();
    expect(field(extraction, "owner_name").value).toMatchObject({ text: "Juan Dela Cruz", ocrConfidence: 92, page: 1, flags: [] });
    expect(field(extraction, "owner_name").value.box).not.toBeNull();
    expect(field(extraction, "species").value.text).toBe("Dog");
    expect(field(extraction, "date").value.text).toBe("10/18/2026");
    expect(field(extraction, "age").value.flags).toContain("low-confidence");
    // Not on the page: left empty, never made up.
    expect(field(extraction, "contact").value).toMatchObject({ text: "", ocrText: null });
    expect(field(extraction, "vaccinated").value.text).toBe("");
  });

  it("flags unclear checkboxes, two ticked choices, wrong value types and rival labels", () => {
    const lines = [
      line(200, [[100, "Owner: Ana"]]),
      line(250, [[100, "Owner: Ben"]]),
      line(300, [[100, "Sex:"], [200, "Male"], [330, "Female"]]),
      line(350, [[100, "Date: someday"]]),
      line(400, [[130, "Vaccinated against rabies"]]),
    ];
    const marks = emptyMarks({ checkboxes: [checkbox(175, 301, "checked"), checkbox(305, 301, "checked"), checkbox(100, 401, "unclear")] });
    const extraction = extractDocument(template, [page(1, lines, marks)]);
    expect(field(extraction, "owner_name").value.flags).toContain("ambiguous-mapping");
    expect(field(extraction, "sex").value.flags).toContain("checkbox-unclear");
    expect(field(extraction, "date").value.flags).toContain("type-mismatch");
    expect(field(extraction, "vaccinated").value).toMatchObject({ text: "", flags: ["checkbox-unclear"] });
  });

  it("uses a saved page region when the label is missing", () => {
    const custom = parseTemplate({ ...template, id: "mine", builtIn: false, fields: [{ key: "tag", label: "Tag", type: "text", region: { x: 0.6, y: 0.05, width: 0.3, height: 0.03 } }] });
    const extraction = extractDocument(custom, [page(1, [line(80, [[650, "TAG-0042"]]), line(300, [[100, "Owner: Ana"]])])]);
    expect(field(extraction, "tag").value).toMatchObject({ text: "TAG-0042", mappingConfidence: 0.85 });
  });

  it("labels a page that isn't this form as unsupported instead of claiming values", () => {
    const extraction = extractDocument(template, [page(1, [line(100, [[100, "Dear Sir, this letter is about the clinic schedule."]])])]);
    expect(extraction.unsupported).toMatch(/don't look like a pet registration form/);
    expect(extraction.forms[0].fields.every((f) => f.value.text === "")).toBe(true);
  });

  it("reports blank pages", () => {
    const extraction = extractDocument(template, [{ ...page(1, []), result: pageResult([], { status: "blank" }) }]);
    expect(extraction.unsupported).toMatch(/No text was found/);
  });
});

describe("census table", () => {
  const template = builtinTemplate("vet-census")!;
  const header = (y: number) => line(y, [[50, "No."], [120, "Owner"], [350, "Pet Name"], [550, "Species"], [700, "Sex"], [800, "Vaccinated"]]);
  const record = (y: number, no: string, owner: string, pet: string, species: string, sex: string, vacc: string) =>
    line(y, [[50, no], [120, owner], [350, pet], [550, species], [700, sex], [800, vacc]]);

  it("reads records across a continuation page and checks totals against them", () => {
    const first = page(1, [
      line(60, [[100, "Barangay: Poblacion"], [600, "Date: 10/18/2026"]]),
      header(150),
      record(190, "1", "Ana Cruz", "Bantay", "Dog", "M", "Y"),
      record(230, "2", "Ben Reyes", "Ming", "Cat", "F", "N"),
    ]);
    const second = page(2, [record(150, "3", "Cara Lim", "Choco", "Dog", "F", "Y"), record(190, "4", "Dan Uy", "Kitty", "Cat", "F", "Y"), line(300, [[100, "Total dogs: 3"]])]);
    const extraction = extractDocument(template, [first, second]);
    const animals = extraction.tables[0];
    expect(animals.rows.map((r) => r.cells.owner.text)).toEqual(["Ana Cruz", "Ben Reyes", "Cara Lim", "Dan Uy"]);
    expect(animals.rows[0].cells.vaccinated.text).toBe("Yes");
    // Not in the sheet: empty, not invented.
    expect(animals.rows[0].cells.age).toMatchObject({ text: "", ocrText: null });
    const totals = Object.fromEntries(extraction.summaries.map((s) => [s.key, s.value]));
    expect(totals.barangay.text).toBe("Poblacion");
    expect(totals.total_dogs.flags).toContain("count-mismatch");
    expect(totals.total_dogs.note).toMatch(/says 3, but 2 records/);
    // Counted but not printed: shown as a hint, not filled in.
    expect(totals.total_animals).toMatchObject({ text: "" });
    expect(totals.total_animals.note).toMatch(/4 records were read/);
  });

  it("says so when no matching table is found", () => {
    const extraction = extractDocument(template, [page(1, [line(100, [[100, "Owner: Ana"]])])]);
    expect(extraction.unsupported).toMatch(/No animals table/);
  });
});

describe("generic mode", () => {
  it("extracts whatever fields and tables it finds, and lines of text otherwise", () => {
    const withFields = page(1, [line(100, [[100, "Clinic: Vet Plus"], [600, "Town: Poblacion"]])]);
    const textOnly = page(2, [line(100, [[100, "Bring your pet's vaccination card."]])]);
    const extraction = extractDocument(null, [withFields, textOnly]);
    expect(extraction.templateId).toBe("generic");
    expect(extraction.forms[0].fields.map((f) => [f.label, f.value.text])).toEqual([
      ["Clinic", "Vet Plus"],
      ["Town", "Poblacion"],
    ]);
    expect(extraction.tables.find((t) => t.key === "text")?.rows[0].cells.text.text).toBe("Bring your pet's vaccination card.");
  });
});
