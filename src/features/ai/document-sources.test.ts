import { describe, expect, it, vi } from "vitest";
vi.mock("@/core/ai/ai-runtime", () => ({ aiRuntime: { generate: vi.fn() } }));
import { db } from "@/core/storage/database";
import { importFiles, trashFile } from "@/core/storage/repositories/file-repository";
import { createDataset, replaceDatasetContent } from "@/core/storage/repositories/dataset.repository";
import { createFolder, trashFolder } from "@/core/storage/repositories/folder-repository";
import { createOcrDocument, updateOcrDocument, updateOcrPage, getOcrPages } from "@/core/storage/repositories/ocr.repository";
import { makeValue } from "@/core/ocr/templates/field-mapping";
import { content } from "@/test/fixtures";
import { listAskSources, loadAskSource } from "./document-sources";
import { answerGroundedQuestion } from "./grounded-answers";

const signal = () => new AbortController().signal;
async function upload(name: string, text: string) {
  return (await importFiles([{ name, kind: "txt", blob: new Blob([text]), mimeType: "text/plain", source: "import", dirPath: "" }], null)).files[0];
}

describe("selected document sources", () => {
  it("does not offer or read documents inside a trashed folder", async () => {
    const folder = await createFolder("Archive", null);
    const { files } = await importFiles([{ name: "Hidden.txt", kind: "txt", blob: new Blob(["Secret: 42"]), mimeType: "text/plain", source: "import", dirPath: "" }], folder.id);
    await trashFolder(folder.id);
    expect(await listAskSources()).toEqual([]);
    await expect(loadAskSource(`file:${files[0].id}`, signal())).rejects.toThrow("Trash");
  });
  it("reads and caches the selected file, and never retrieves another file's value", async () => {
    const first = await upload("First.txt", "Phone: 09170001");
    const second = await upload("Second.txt", "Phone: 09170002");
    const index = await loadAskSource(`file:${first.id}`, signal());
    expect(await answerGroundedQuestion("What is the phone?", index, null)).toMatchObject({ text: expect.stringContaining("09170001") });
    expect(JSON.stringify(index)).not.toContain("09170002");
    expect(await db.extractedDocuments.count()).toBe(1);
    await loadAskSource(`file:${first.id}`, signal());
    expect(await db.extractedDocuments.count()).toBe(1);
    await trashFile(second.id);
    expect((await listAskSources()).map((s) => s.id)).toEqual([`file:${first.id}`]);
    await expect(loadAskSource(`file:${second.id}`, signal())).rejects.toThrow("Trash");
  });

  it("reflects the latest saved dataset edit without retaining a stale index", async () => {
    const initial = content(["Name"], [["Ana"]]);
    const dataset = await createDataset({ name: "Names", sourceFileIds: [], content: initial });
    expect((await loadAskSource(dataset.id, signal())).rows[0].values).toEqual(initial.rows[0].values);
    const changed = { ...initial, rows: [{ values: { [initial.columns[0].id]: "Ben" }, source: null }] };
    await replaceDatasetContent(dataset.id, changed, 1);
    expect((await loadAskSource(dataset.id, signal())).rows[0].values).toEqual(changed.rows[0].values);
  });

  it("carries unresolved OCR into calculations and clears it after confirmation", async () => {
    const scan = await createOcrDocument({ name: "Scanned form", pages: [{ fileId: "photo", pdfPage: null }] });
    const page = (await getOcrPages(scan.id))[0];
    await updateOcrPage(page.id, { width: 1000, height: 1400, state: "done" });
    const spec = { key: "amount", label: "Amount", required: false, type: "number" as const };
    const value = makeValue(spec, { text: "100", page: 1, box: { x: 10, y: 20, width: 80, height: 30 }, confidence: 50, mapping: 1 });
    const extraction = { templateId: "generic", forms: [{ page: 1, fields: [{ ...spec, value }] }], tables: [], summaries: [], unsupported: null, warnings: [] };
    await updateOcrDocument(scan.id, { extraction });
    const unreviewed = await loadAskSource(`scan:${scan.id}`, signal());
    expect(await answerGroundedQuestion("Total amount", unreviewed, null)).toMatchObject({ kind: "unsupported" });
    value.confirmed = true;
    await updateOcrDocument(scan.id, { extraction });
    const reviewed = await loadAskSource(`scan:${scan.id}`, signal());
    expect(await answerGroundedQuestion("Total amount", reviewed, null)).toMatchObject({ kind: "table", rows: [[100]] });
    expect(reviewed.evidence.some((e) => e.cells?.Amount.box)).toBe(true);
  });
});
