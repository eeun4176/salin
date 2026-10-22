/**
 * OCR Review & Dataset Integration Tests
 * Review states (Ready / Needs review / Unreadable / Missing), the
 * critical-field gate, reviewer edits and row changes; converting a
 * reviewed scan into Phase 3 datasets (typed columns, source regions, the
 * original OCR text kept next to corrections), saving them linked to the
 * scan, reopening them without re-running OCR, exporting, and including
 * scans and templates in backup/restore.
 */

import { describe, expect, it } from "vitest";

import { exportDataset } from "@/core/processing/dataset-export";
import { createBackupArchive, readBackupArchive, restoreBackup } from "@/core/storage/backup";
import { db } from "@/core/storage/database";
import { getDatasetWithRows } from "@/core/storage/repositories/dataset.repository";
import { createOcrDocument, getOcrDocumentOrThrow, getOcrPages, listSavedTemplates, saveOcrDatasets, saveTemplate, updateOcrDocument, updateOcrPage } from "@/core/storage/repositories/ocr.repository";
import { importFiles } from "@/core/storage/repositories/file-repository";
import { analyzeLayout } from "@/core/ocr/layout/layout-analysis";
import { addRow, confirmValue, editValue, reviewItems, stateCounts, unresolvedCritical, valueState } from "@/core/ocr/review/review-state";
import { extractionToDatasets } from "@/core/ocr/review/to-dataset";
import { builtinTemplate } from "@/core/ocr/templates/builtin-templates";
import { extractDocument, makeValue } from "@/core/ocr/templates/field-mapping";
import { emptyMarks, line, pageResult } from "@/test/ocr-fixtures";
import type { Extraction } from "@/types/ocr";

function registrationExtraction(): Extraction {
  const lines = [
    line(200, [[100, "Owner: Juan Dela Cruz"]]),
    line(250, [[100, "Address: Poblacion", 55]]),
    line(300, [[100, "Pet Name: Bantay"], [600, "Date: 10/18/2026"]]),
    line(350, [[100, "Species: Dog"], [600, "Vaccinated: Yes"]]),
  ];
  const layout = analyzeLayout({ width: 1000, height: 1400, lines, marks: emptyMarks() });
  return extractDocument(builtinTemplate("vet-registration"), [{ page: 1, width: 1000, height: 1400, layout, result: pageResult(lines) }]);
}

const ref = (id: string) => ({ kind: "form" as const, group: 0, id });

describe("review states", () => {
  it("rates each value and blocks creation until required values are resolved", () => {
    const extraction = registrationExtraction();
    const state = (key: string) => reviewItems(extraction).find((i) => i.ref.id === key)!.state;
    expect(state("owner_name")).toBe("ready");
    expect(state("address")).toBe("needs_review"); // read with 55% confidence
    expect(state("contact")).toBe("ready"); // optional and empty
    expect(unresolvedCritical(extraction).map((i) => i.ref.id)).toEqual(["address"]);
    expect(stateCounts(extraction).needs_review).toBe(1);

    const confirmed = confirmValue(extraction, ref("address"));
    expect(unresolvedCritical(confirmed)).toEqual([]);
  });

  it("treats very low confidence as unreadable and missing required values as missing", () => {
    const spec = { type: "text" as const, required: true };
    expect(valueState(makeValue(spec, { text: "J#a", confidence: 20, mapping: 1, page: 1, box: null }), spec)).toBe("unreadable");
    expect(valueState(makeValue(spec, null), spec)).toBe("missing");
  });

  it("keeps what OCR read when the reviewer corrects a value, and re-checks its type", () => {
    let extraction = editValue(registrationExtraction(), ref("address"), "Purok 2, Poblacion");
    const address = extraction.forms[0].fields.find((f) => f.key === "address")!.value;
    expect(address).toMatchObject({ text: "Purok 2, Poblacion", ocrText: "Poblacion", edited: true, confirmed: true });
    extraction = editValue(extraction, ref("date"), "not a date");
    expect(extraction.forms[0].fields.find((f) => f.key === "date")!.value.flags).toContain("type-mismatch");
  });
});

describe("datasets from scans", () => {
  it("builds typed datasets with source regions and the original OCR text", () => {
    const extraction = editValue(registrationExtraction(), ref("address"), "Purok 2, Poblacion");
    const [draft] = extractionToDatasets(extraction, "doc1", "Registration", [{ page: 1, fileId: "f1", pdfPage: null, width: 1000, height: 1400 }]);
    const column = (name: string) => draft.content.columns.find((c) => c.name === name)!;
    expect(column("Date registered").type).toBe("date");
    expect(column("Vaccinated against rabies").type).toBe("boolean");
    const [row] = draft.content.rows;
    expect(row.values[column("Date registered").id]).toBe("2026-10-18");
    expect(row.values[column("Vaccinated against rabies").id]).toBe(true);
    expect(row.values[column("Contact no.").id]).toBeNull();
    expect(row.source?.ocr?.cells[column("Owner's name").id]?.x).toBeCloseTo(0.168, 3); // "Juan" starts at x = 168 of 1000
    expect(row.source?.ocr?.original[column("Address").id]).toBe("Poblacion");
    expect(draft.sourceFileIds).toEqual(["f1"]);
  });

  it("makes one dataset per table plus a summary, named after the scan", () => {
    const extraction: Extraction = {
      templateId: "vet-census",
      forms: [],
      tables: [{ key: "animals", label: "Animals", columns: [{ key: "owner", label: "Owner", type: "text", required: true }], rows: [] }],
      summaries: [],
      unsupported: null,
      warnings: [],
    };
    const withRow = addRow(extraction, 0, 1);
    withRow.summaries = [{ key: "total", label: "Total animals", type: "number", required: false, value: { ...makeValue({ type: "number" }, { text: "12", confidence: 90, mapping: 1, page: 1, box: null }) } }];
    const drafts = extractionToDatasets(withRow, "doc", "Census", [{ page: 1, fileId: "f1", pdfPage: 3, width: 100, height: 100 }]);
    expect(drafts.map((d) => d.name)).toEqual(["Census – Animals", "Census – Summary"]);
    expect(drafts[1].content.rows[0].values[drafts[1].content.columns[0].id]).toBe(12);
    expect(drafts[0].content.rows[0].source?.page).toBe(3); // the PDF page
  });

  it("saves, reopens, exports and backs up a scan's datasets without re-running OCR", async () => {
    const { files } = await importFiles([{ blob: new Blob(["png"], { type: "image/png" }), name: "form.png", kind: "png", mimeType: "image/png", dirPath: "", source: "scan" }], null);
    const fileId = files[0].id;
    const doc = await createOcrDocument({ name: "Registration", pages: [{ fileId, pdfPage: null }], templateId: "vet-registration" });
    const [pageRecord] = await getOcrPages(doc.id);
    await updateOcrPage(pageRecord.id, { width: 1000, height: 1400, state: "done", result: pageResult([]) });
    const extraction = confirmValue(registrationExtraction(), ref("address"));
    await updateOcrDocument(doc.id, { extraction, stage: "review" });
    await saveTemplate({ ...builtinTemplate("vet-registration")!, id: "my-form", name: "My form" });

    const drafts = extractionToDatasets(extraction, doc.id, doc.name, [{ page: 1, fileId, pdfPage: null, width: 1000, height: 1400 }]);
    const [dataset] = await saveOcrDatasets(doc.id, drafts);
    expect(dataset.origin).toEqual({ kind: "ocr", documentId: doc.id, templateId: "vet-registration" });
    expect((await getOcrDocumentOrThrow(doc.id)).datasetIds).toEqual([dataset.id]);

    const reopened = await getDatasetWithRows(dataset.id);
    expect(reopened.rows[0].source?.ocr?.documentId).toBe(doc.id);
    const csv = await exportDataset({ name: reopened.dataset.name, content: { columns: reopened.dataset.columns, rows: reopened.rows } }, "csv").text();
    expect(csv).toContain("Juan Dela Cruz");

    const backup = await readBackupArchive(await createBackupArchive());
    expect(backup.ocrDocuments).toHaveLength(1);
    expect(backup.ocrPages[0]).toMatchObject({ processed: null, width: 1000 });
    await db.ocrDocuments.clear();
    await db.templates.clear();
    await restoreBackup(backup);
    expect((await getOcrDocumentOrThrow(doc.id)).extraction?.forms[0].fields.find((f) => f.key === "owner_name")?.value.text).toBe("Juan Dela Cruz");
    expect((await listSavedTemplates()).map((t) => t.id)).toEqual(["my-form"]);
    const restored = await getDatasetWithRows(dataset.id);
    expect(restored.dataset.origin).toMatchObject({ kind: "ocr", documentId: doc.id });
    expect(restored.rows[0].source?.ocr?.cells).toEqual(reopened.rows[0].source?.ocr?.cells);
  });
});
