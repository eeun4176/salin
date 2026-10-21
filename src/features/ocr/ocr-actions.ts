/**
 * OCR Actions
 * What the scan screens do, with user-facing error handling: start a scan
 * from workspace files (images and PDFs — a PDF adds one page per page) or
 * from freshly captured photos (saved to the workspace first, so the
 * originals are kept), resume an unfinished scan of the same files, find
 * photo page edges before reading, build the extraction for review (or an
 * empty one for typing values by hand when OCR isn't available), switch to
 * a template that clearly fits, extract just the columns the user asks for,
 * save a template from a corrected scan, and create the datasets.
 */

import { ruleSuggestions, templateRules } from "@/core/ai/suggestions";
import { errorMessage } from "@/core/storage/errors";
import { getFileWithBlob, importFiles } from "@/core/storage/repositories/file-repository";
import { createOcrDocument, findOcrDocumentsForFile, getOcrDocumentOrThrow, getOcrPages, listSavedTemplates, saveOcrDatasets, saveTemplate, updateOcrDocument, updateOcrPage, type NewPage } from "@/core/storage/repositories/ocr.repository";
import { splitExtension } from "@/core/storage/names";
import { BUILTIN_TEMPLATES, GENERIC_TEMPLATE_ID } from "@/core/ocr/templates/builtin-templates";
import { extractDocument, makeValue } from "@/core/ocr/templates/field-mapping";
import { suggestTemplates, type TemplateMatch } from "@/core/ocr/templates/template-suggest";
import { keyFromLabel, type DocumentTemplateDef } from "@/core/ocr/templates/template-schema";
import { normalize } from "@/core/ocr/layout/geometry";
import { detectPageEdges } from "@/core/ocr/imaging/imaging-client";
import { extractRequested, foundLabels, guessShape, isRequested, REQUESTED_PREFIX, requestedColumns, requestedTemplate, type RecordShape } from "@/core/ocr/templates/requested-columns";
import { extractionToDatasets } from "@/core/ocr/review/to-dataset";
import { nameColumns } from "@/core/processing/column-naming";
import { pageSource, pdfPageCount } from "@/features/ocr/page-sources";
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

/** Maps the read pages onto the scan's template, with rule-based suggestions (standard forms, OCR slips) for review. */
export async function buildExtraction(doc: OcrDocument, pages: OcrPage[]): Promise<Extraction> {
  const template = await templateById(doc.templateId);
  const extraction = template && isRequested(template) ? extractRequested(template, pageNumbers(pages)) : extractDocument(template, pageNumbers(pages));
  return { ...extraction, templateVersion: template?.version, suggestions: ruleSuggestions(extraction, templateRules(template, extraction)) };
}

/** Photos without a crop yet: finds the page edges first, so most photos need no manual cropping. */
export async function autoCropPhotos(pages: OcrPage[]) {
  for (const page of pages) {
    if (page.pdfPage !== null || page.edits.crop || page.state !== "pending") continue;
    const quad = await pageSource(page)
      .then((blob) => detectPageEdges(blob, page.edits.rotation))
      .catch(() => null);
    if (quad) await updateOcrPage(page.id, { edits: { ...page.edits, crop: quad } }).catch(() => undefined);
  }
}

/** After a first read in generic mode: switches to a template that clearly fits (a saved one, or a built-in form). */
export async function applyClearMatch(doc: OcrDocument, pages: OcrPage[]) {
  if (doc.templateId !== GENERIC_TEMPLATE_ID) return;
  const match = await templateSuggestion(doc, pages);
  if (match && match.score >= 0.6) await switchTemplate(doc, pages, match.template.id);
}

/**
 * "What do you need?": makes (or reuses) a template with just the columns
 * asked for, sets it on the scan, and maps the pages onto it — or, when
 * nothing has been read, gives empty records to type into. Resolves to the
 * new extraction (for the caller to save), or `null` after telling the
 * user what went wrong.
 */
export async function extractColumns(doc: OcrDocument, pages: OcrPage[], labels: string[], shape: RecordShape): Promise<Extraction | null> {
  try {
    const same = (await listSavedTemplates()).find((t) => isRequested(t) && t.kind === shape && requestedColumns(t).join("|") === labels.join("|"));
    const template = await saveTemplate(requestedTemplate(same?.id ?? `${REQUESTED_PREFIX}${doc.id}`, labels, shape));
    const next = { ...doc, templateId: template.id };
    const extraction = pages.some((p) => p.state === "done") ? await buildExtraction(next, pages) : await manualExtraction(next, pages);
    // The review screen keeps and saves the extraction itself (so it stays open with the new columns).
    await updateOcrDocument(doc.id, { templateId: template.id });
    return extraction;
  } catch (error) {
    toast(errorMessage(error, "Those columns couldn't be used. Please try again."));
    return null;
  }
}

/** What generic reading finds on the read pages: labels to tap instead of typing, and whether pages hold lists. */
export function pageHints(pages: OcrPage[]): { labels: string[]; shape: RecordShape } {
  if (!pages.some((p) => p.result)) return { labels: [], shape: "form" };
  const generic = extractDocument(null, pageNumbers(pages));
  return { labels: foundLabels(generic), shape: guessShape(generic) };
}

/** Column sets asked for before (newest first), to pick again with one tap. */
export async function recentColumnSets(limit = 3): Promise<{ labels: string[]; shape: RecordShape }[]> {
  const asked = (await listSavedTemplates().catch(() => [])).filter(isRequested);
  return asked.slice(0, limit).map((t) => ({ labels: requestedColumns(t), shape: t.kind }));
}

/** The template that best fits the read pages, when it isn't the one in use (deterministic: labels and headings found). */
export async function templateSuggestion(doc: OcrDocument, pages: OcrPage[]): Promise<TemplateMatch | null> {
  if (!pages.some((p) => p.result)) return null;
  const matches = suggestTemplates(await allTemplates(), pageNumbers(pages));
  const current = matches.find((m) => m.template.id === doc.templateId);
  const [best] = matches;
  // Only when it clearly fits better than the template in use.
  return best && best.template.id !== doc.templateId && (!current || best.score > current.score + 0.15) ? best : null;
}

/** Switches a scan to another template and maps the read pages again (corrections made in review are replaced). */
export async function switchTemplate(doc: OcrDocument, pages: OcrPage[], templateId: string) {
  try {
    const extraction = pages.some((p) => p.state === "done") ? await buildExtraction({ ...doc, templateId }, pages) : null;
    await updateOcrDocument(doc.id, { templateId, extraction });
  } catch (error) {
    toast(errorMessage(error, "The template couldn't be changed."));
  }
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

/**
 * Creates the datasets from a reviewed scan, with the reviewer's dataset
 * names and names for unnamed columns (by dataset and column position;
 * otherwise suggested from their values).
 * Resolves to their ids (empty after a reported failure).
 */
export async function createScanDatasets(documentId: string, names?: Record<string, string>, columnNames?: Record<number, Record<number, string>>): Promise<string[]> {
  try {
    const doc = await getOcrDocumentOrThrow(documentId);
    if (!doc.extraction) throw new Error("Nothing has been read from this scan yet.");
    const pages = await getOcrPages(documentId);
    const drafts = extractionToDatasets(
      doc.extraction,
      doc.id,
      doc.name,
      pages.map((p, i) => ({ page: i + 1, fileId: p.fileId, pdfPage: p.pdfPage, width: p.width || 1, height: p.height || 1 })),
    ).map((d, i) => ({
      ...d,
      name: names?.[i] ?? d.name,
      content: { ...d.content, columns: nameColumns(d.content, columnNames?.[i]) },
    }));
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
