/**
 * OCR Actions
 * What the scan screens do, with user-facing error handling: start a scan
 * from workspace files (images and PDFs — a PDF adds one page per page) or
 * from freshly captured photos (saved to the workspace first, so the
 * originals are kept), resume an unfinished scan of the same files, build
 * the extraction for review (or an empty one for typing values by hand when
 * OCR isn't available), save a template from a corrected scan, and create
 * the datasets.
 */

import { errorMessage } from "@/core/storage/errors";
import { getFileWithBlob, importFiles } from "@/core/storage/repositories/file-repository";
import { createOcrDocument, findOcrDocumentsForFile, getOcrDocumentOrThrow, getOcrPages, listSavedTemplates, saveOcrDatasets, saveTemplate, updateOcrDocument, type NewPage } from "@/core/storage/repositories/ocr.repository";
import { splitExtension } from "@/core/storage/names";
import { BUILTIN_TEMPLATES, GENERIC_TEMPLATE_ID } from "@/core/ocr/templates/builtin-templates";
import { extractDocument, makeValue } from "@/core/ocr/templates/field-mapping";
import { keyFromLabel, type DocumentTemplateDef } from "@/core/ocr/templates/template-schema";
import { normalize } from "@/core/ocr/layout/geometry";
import { extractionToDatasets } from "@/core/ocr/review/to-dataset";
import { pdfPageCount } from "@/features/ocr/page-sources";
import { toast } from "@/stores/toast-store";
import type { IntakeFile } from "@/stores/intake-store";
import type { WorkspaceFile } from "@/types/domain";
import type { Extraction, OcrDocument, OcrPage } from "@/types/ocr";

export const scanUrl = (documentId: string) => `/scans/${documentId}`;

export const OCR_KINDS = new Set<WorkspaceFile["kind"]>(["png", "jpg", "webp", "pdf"]);

/** At most this many pages per scan (memory and patience on phones). */
export const MAX_SCAN_PAGES = 30;

/** Every template the user can pick: built-in ones, then saved ones. */
export async function allTemplates(): Promise<DocumentTemplateDef[]> {
  return [...BUILTIN_TEMPLATES, ...(await listSavedTemplates().catch(() => []))];
}

export async function templateById(id: string) {
  if (id === GENERIC_TEMPLATE_ID) return null;
  return (await allTemplates()).find((t) => t.id === id) ?? null;
}

async function pagesFor(files: WorkspaceFile[]): Promise<NewPage[]> {
  const pages: NewPage[] = [];
  for (const file of files) {
    if (file.kind === "pdf") {
      const { blob } = await getFileWithBlob(file.id);
      const count = await pdfPageCount(blob);
      for (let n = 1; n <= count; n++) pages.push({ fileId: file.id, pdfPage: n });
    } else {
      pages.push({ fileId: file.id, pdfPage: null });
    }
  }
  return pages;
}

/**
 * Starts (or resumes) a scan of workspace files. Resolves to the scan id,
 * or `null` after telling the user what went wrong.
 */
export async function startScan(files: WorkspaceFile[]): Promise<string | null> {
  const usable = files.filter((f) => OCR_KINDS.has(f.kind) && f.deletedAt === null);
  if (usable.length === 0) {
    toast("Text recognition works on photos (JPG, PNG, WebP) and PDFs.");
    return null;
  }
  try {
    // An unfinished scan of exactly these files: continue it instead of starting over.
    const ids = usable.map((f) => f.id);
    const previous = (await findOcrDocumentsForFile(ids[0])).filter((d) => d.stage !== "done" && d.fileIds.length === ids.length && d.fileIds.every((id, i) => id === ids[i]));
    if (previous.length) return previous.sort((a, b) => b.updatedAt - a.updatedAt)[0].id;

    const pages = await pagesFor(usable);
    if (pages.length > MAX_SCAN_PAGES) {
      toast(`That's ${pages.length} pages — scans can have up to ${MAX_SCAN_PAGES}. Split the document and scan it in parts.`);
      return null;
    }
    const [base] = splitExtension(usable[0].name, true);
    const doc = await createOcrDocument({ name: usable.length > 1 ? `${base} + ${usable.length - 1} more` : base, pages });
    return doc.id;
  } catch (error) {
    toast(error instanceof Error && error.name === "PdfOpenError" ? error.message : errorMessage(error, "The scan couldn't be started. Please try again."));
    return null;
  }
}

/** Saves captured/uploaded pages to the workspace (originals kept), then starts a scan of them. */
export async function startScanFromIntake(intake: IntakeFile[], folderId: string | null): Promise<string | null> {
  try {
    const { files } = await importFiles(
      intake.map((f) => ({ blob: f.file, name: f.name, kind: f.kind, mimeType: f.file.type, dirPath: "", source: f.source })),
      folderId,
    );
    return await startScan(files);
  } catch (error) {
    toast(errorMessage(error, "The pages couldn't be saved. Please try again."));
    return null;
  }
}

const pageNumbers = (pages: OcrPage[]) => pages.map((p, i) => ({ page: i + 1, width: p.width || 1, height: p.height || 1, layout: p.layout, result: p.result }));

/** Maps the read pages onto the scan's template. */
export async function buildExtraction(doc: OcrDocument, pages: OcrPage[]): Promise<Extraction> {
  const template = await templateById(doc.templateId);
  return extractDocument(template, pageNumbers(pages));
}

/** An empty extraction for typing values from the page by hand (OCR unavailable, or skipped). */
export async function manualExtraction(doc: OcrDocument, pages: OcrPage[]): Promise<Extraction> {
  const template = await templateById(doc.templateId);
  const base: Extraction = { id: crypto.randomUUID(), templateId: template?.id ?? GENERIC_TEMPLATE_ID, forms: [], tables: [], summaries: [], unsupported: null, warnings: ["Typed by hand — no text recognition was used."] };
  if (!template) {
    return { ...base, tables: [{ key: "text", label: "Text", columns: [{ key: "text", label: "Text", type: "text", required: false }], rows: [] }] };
  }
  const empty = (spec: { type: DocumentTemplateDef["fields"][number]["type"]; options?: string[] }) => makeValue(spec, null);
  if (template.kind === "form") {
    base.forms = pages.map((_, i) => ({ page: i + 1, fields: template.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required, options: f.options, value: empty(f) })) }));
  } else {
    base.tables = template.tables.map((t) => ({ key: t.key, label: t.label, columns: t.columns.map((c) => ({ key: c.key, label: c.label, type: c.type, required: c.required, options: c.options })), rows: [] }));
    base.summaries = [...template.fields, ...template.summaries].map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required, options: f.options, value: empty(f) }));
  }
  return base;
}

/**
 * Saves a reusable template from a reviewed form: its fields, and where on
 * the page each value was (so the next scan of this layout finds them even
 * without labels). Resolves to the saved template.
 */
export async function saveTemplateFromScan(doc: OcrDocument, pages: OcrPage[], name: string): Promise<DocumentTemplateDef | null> {
  const extraction = doc.extraction;
  if (!extraction) return null;
  const base = await templateById(extraction.templateId);
  const form = extraction.forms[0];
  const page = pages[(form?.page ?? 1) - 1];
  const fields = (form?.fields ?? []).map((f) => {
    const original = base?.fields.find((x) => x.key === f.key);
    const region = f.value.box && page?.width ? normalize(f.value.box, page.width, page.height) : undefined;
    return { key: f.key || keyFromLabel(f.label), label: f.label, aliases: original?.aliases ?? [], type: f.type, required: f.required, options: f.options, ...(region ? { region } : {}) };
  });
  try {
    return await saveTemplate({
      id: `custom-${crypto.randomUUID()}`,
      name,
      description: base ? `Adapted from “${base.name}”.` : "Saved from a scanned form.",
      kind: base?.kind ?? (fields.length ? "form" : "table"),
      version: 1,
      builtIn: false,
      experimental: false,
      basedOn: base?.id,
      fields,
      tables: base?.tables ?? (fields.length ? [] : extraction.tables.map((t) => ({ key: keyFromLabel(t.key), label: t.label, columns: t.columns.map((c) => ({ ...c, aliases: [] })), minMatched: Math.min(2, t.columns.length) }))),
      summaries: base?.summaries ?? [],
    });
  } catch (error) {
    toast(errorMessage(error, error instanceof Error ? error.message : "The template couldn't be saved."));
    return null;
  }
}

/** Creates the datasets from a reviewed scan. Resolves to their ids (empty after a reported failure). */
export async function createScanDatasets(documentId: string, names?: Record<string, string>): Promise<string[]> {
  try {
    const doc = await getOcrDocumentOrThrow(documentId);
    if (!doc.extraction) throw new Error("Nothing has been read from this scan yet.");
    const pages = await getOcrPages(documentId);
    const drafts = extractionToDatasets(
      doc.extraction,
      doc.id,
      doc.name,
      pages.map((p, i) => ({ page: i + 1, fileId: p.fileId, pdfPage: p.pdfPage, width: p.width || 1, height: p.height || 1 })),
    ).map((d, i) => ({ ...d, name: names?.[i] ?? d.name }));
    const created = await saveOcrDatasets(documentId, drafts);
    return created.map((d) => d.id);
  } catch (error) {
    toast(errorMessage(error, error instanceof Error ? error.message : "The datasets couldn't be created."));
    return [];
  }
}

export async function renameScan(documentId: string, name: string) {
  try {
    await updateOcrDocument(documentId, { name });
  } catch (error) {
    toast(errorMessage(error, "The scan couldn't be renamed."));
  }
}
