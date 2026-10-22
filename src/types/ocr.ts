/**
 * OCR Types
 * Shapes of the Phase 4 records: a scan/OCR document (one reading session
 * over one or more pages), each page's edits and processed image, what the
 * OCR engine recognised (words and lines with boxes and confidence), the
 * page layout found in it (headings, label/value pairs, tables, checkboxes),
 * and the reviewed extraction (fields and records with their source regions
 * and review flags) that becomes a Phase 3 dataset. Stored in IndexedDB.
 */

import type { CensusSheetRead } from "@/core/census/omr/read-sheet";
import type { ID, Timestamp } from "./domain";

/* ------------------------------------------------------------------
   Geometry
------------------------------------------------------------------- */

/** A rectangle in pixels of the processed page image. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Four page corners (top-left, top-right, bottom-right, bottom-left), each 0–1 of the image size. */
export type Quad = [Point, Point, Point, Point];

/* ------------------------------------------------------------------
   Page preparation
------------------------------------------------------------------- */

export type QuarterTurn = 0 | 90 | 180 | 270;

export interface Enhancements {
  /** Even out shadows and uneven lighting. */
  shadows: boolean;
  /** Stretch faint text to full contrast. */
  contrast: boolean;
  /** Remove speckles and camera noise. */
  denoise: boolean;
  /** Pure black-and-white (helps faint printed text; can hurt photos with gradients). */
  blackAndWhite: boolean;
}

/** What the user (or auto-detection) did to a page before recognition. The original stays untouched. */
export interface PageEdits {
  rotation: QuarterTurn;
  /** Page corners for cropping and perspective correction, in the rotated image; `null` = whole image. */
  crop: Quad | null;
  /** Straighten slightly tilted text automatically. */
  deskew: boolean;
  enhance: Enhancements;
}

/** Ruling lines, checkboxes and ink found in a processed page image (by image analysis, not OCR). */
export interface PageMarks {
  horizontal: Box[];
  vertical: Box[];
  checkboxes: CheckboxMark[];
  /** Share of the page covered by ink, 0–1. Near 0 = blank page. */
  inkRatio: number;
  /** Degrees the page was rotated to straighten it (0 if not deskewed). */
  skew: number;
  /** True when the text runs top-to-bottom (the page is probably sideways). */
  sideways: boolean;
  /** True when speckle noise was removed automatically (the page was grainy). */
  autoDenoised?: boolean;
}

export interface CheckboxMark {
  box: Box;
  /** Share of the box's inside that is inked, 0–1. */
  fill: number;
  state: "checked" | "unchecked" | "unclear";
}

/* ------------------------------------------------------------------
   Recognition
------------------------------------------------------------------- */

export interface OcrWord {
  text: string;
  /** 0–100, from the OCR model. */
  confidence: number;
  box: Box;
  /** Characters the model was unsure about (each below 60% confidence). */
  unclear: string;
}

export interface OcrLine {
  text: string;
  confidence: number;
  box: Box;
  words: OcrWord[];
  /** Tesseract block the line belongs to. */
  block: number;
}

export type OcrPageStatus = "ok" | "blank" | "unreadable";

export interface OcrPageResult {
  /** Engine and model, e.g. "tesseract.js 7 · LSTM". */
  engine: string;
  profile: OcrProfileId;
  languages: string[];
  /** Size of the image that was read (the processed page). */
  width: number;
  height: number;
  lines: OcrLine[];
  text: string;
  /** Mean word confidence, 0–100 (0 when nothing was read). */
  confidence: number;
  status: OcrPageStatus;
  /** Quarter turns applied automatically because the page read better that way. */
  autoRotated: QuarterTurn;
  durationMs: number;
}

export type OcrProfileId = "standard" | "accurate";

/* ------------------------------------------------------------------
   Layout
------------------------------------------------------------------- */

export interface LayoutText {
  text: string;
  box: Box;
  confidence: number;
}

/** "Label: value" or a label followed by a filled-in line. `value` is "" when the field was left blank. */
export interface KeyValue {
  label: string;
  labelBox: Box;
  value: string;
  valueBox: Box | null;
  /** Mean OCR confidence of the value's words; `null` when there is no value. */
  confidence: number | null;
  unclear: string;
}

export interface LayoutCell {
  text: string;
  box: Box;
  /** `null` = empty cell. */
  confidence: number | null;
  unclear: string;
  /** True when the cell spans several columns (a merged region); its text sits in the first. */
  merged?: boolean;
}

export interface LayoutTable {
  id: string;
  box: Box;
  /** Ruled = drawn grid lines; aligned = columns found from text alignment. */
  source: "ruled" | "aligned";
  columns: { x0: number; x1: number }[];
  rows: { box: Box; cells: LayoutCell[] }[];
  /** 0 or 1. */
  headerRows: number;
}

export interface LayoutCheckbox {
  box: Box;
  state: CheckboxMark["state"];
  fill: number;
  /** The text right of (or next to) the box. */
  label: string;
  labelBox: Box | null;
}

export type LayoutIssueKind = "overlap" | "low-confidence" | "empty-table" | "decorative" | "ambiguous" | "unsupported";

export interface LayoutIssue {
  kind: LayoutIssueKind;
  message: string;
  box: Box | null;
}

export interface PageLayout {
  headings: LayoutText[];
  /** Ordinary text lines in reading order (multi-column pages read column by column). */
  text: (LayoutText & { column: number })[];
  keyValues: KeyValue[];
  tables: LayoutTable[];
  checkboxes: LayoutCheckbox[];
  /** Text columns found on the page (1 or 2). */
  columns: number;
  issues: LayoutIssue[];
}

/* ------------------------------------------------------------------
   Extraction & review
------------------------------------------------------------------- */

export type FieldType = "text" | "number" | "date" | "boolean" | "choice";

export type ValueFlag =
  | "low-confidence"
  | "unclear-characters"
  | "ambiguous-mapping"
  | "checkbox-unclear"
  | "type-mismatch"
  | "possibly-handwritten"
  | "count-mismatch"
  /** Handwriting recognition couldn't read it reliably: type it from the close-up. */
  | "illegible"
  /** More than one box is marked where one answer is expected (census sheets). */
  | "multiple-marks";

/** One extracted value with everything needed to review it against the page. */
export interface ExtractedValue {
  /** Current value: what OCR read, or what the reviewer typed. */
  text: string;
  /** What OCR read (`null` when nothing was found on the page). */
  ocrText: string | null;
  /** OCR recognition confidence, 0–100. */
  ocrConfidence: number | null;
  /** How sure the field mapping is that this text belongs to this field, 0–1. */
  mappingConfidence: number | null;
  /** 1-based page and the region on it. */
  page: number | null;
  box: Box | null;
  flags: ValueFlag[];
  /** Extra detail for flags ("The form says 12, but 11 records were read"). */
  note: string | null;
  edited: boolean;
  /** The reviewer checked this value against the page. */
  confirmed: boolean;
  /** Set when the value came from a suggestion the reviewer accepted (cleared when they type over it). */
  suggestedBy?: SuggestionSource;
}

export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
}

export interface ExtractedField extends FieldSpec {
  value: ExtractedValue;
}

/** One filled-in form (one page for form templates). */
export interface FormRecord {
  page: number;
  fields: ExtractedField[];
}

export interface RecordRow {
  id: string;
  page: number;
  box: Box | null;
  cells: Record<string, ExtractedValue>;
}

/** Repeated records: a table read from one or more pages. */
export interface RecordSet {
  key: string;
  label: string;
  columns: FieldSpec[];
  rows: RecordRow[];
}

export interface Extraction {
  /** New for every fresh mapping (re-read, template switch, typing by hand); kept through review edits. */
  id?: string;
  templateId: string;
  forms: FormRecord[];
  tables: RecordSet[];
  summaries: ExtractedField[];
  /** Set when the pages don't match the template (or nothing could be read): nothing is claimed as extracted. */
  unsupported: string | null;
  warnings: string[];
  /** Version of the template the pages were mapped with (saved templates can change later). */
  templateVersion?: number;
  /** Suggested corrections, standard forms and handwriting readings — applied only when the reviewer accepts them. */
  suggestions?: Suggestion[];
}

/** A value in an extraction: a form field, a table cell (`rowId:columnKey`) or a summary field. */
export interface ValueRef {
  kind: "form" | "table" | "summary";
  /** Form/table index (0 for summaries). */
  group: number;
  /** Field key or `${rowId}:${columnKey}`. */
  id: string;
}

/** rule = a deterministic rule (OCR slip, standard form); handwriting = the handwriting model; ai = the local language model. */
export type SuggestionSource = "rule" | "handwriting" | "ai";

export interface Suggestion {
  id: string;
  ref: ValueRef;
  /** correction = fix what was read; standardize = same value in standard form; fill = a value for an empty field; move = the value belongs in another column. */
  kind: "correction" | "standardize" | "fill" | "move";
  source: SuggestionSource;
  /** The value now (what OCR read, or the reviewer's text). */
  before: string;
  after: string;
  /** Why, in plain words. */
  reason: string;
  /** Backed by the page: found in the text read, a small fix of it, a validated rule, or read from the value's own region. */
  grounded: boolean;
  /** 0–1 where the source gives one. */
  confidence: number | null;
  /** Where the suggested value was found on the page (fill suggestions from page text). */
  page?: number | null;
  box?: Box | null;
  /** For move suggestions: the value it should go to. */
  to?: ValueRef;
  status: "pending" | "accepted" | "rejected";
  decidedAt?: number;
}

export type ReviewState = "ready" | "needs_review" | "unreadable" | "missing";

/* ------------------------------------------------------------------
   Stored records
------------------------------------------------------------------- */

export type OcrStage = "prepare" | "read" | "review" | "done";

/** One OCR session over one or more pages. The original files are never changed. */
export interface OcrDocument {
  id: ID;
  name: string;
  /** Original files (images or PDFs), in page order. */
  fileIds: ID[];
  templateId: string;
  languages: string[];
  stage: OcrStage;
  extraction: Extraction | null;
  datasetIds: ID[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type OcrPageState = "pending" | "done" | "failed" | "cancelled";

export interface OcrPage {
  id: ID;
  documentId: ID;
  /** 0-based order within the document. */
  position: number;
  fileId: ID;
  /** 1-based page of a PDF file; `null` for images. */
  pdfPage: number | null;
  /** Rendered PDF page (PDFs only — images use their original file bytes). */
  source: Blob | null;
  edits: PageEdits;
  /** The prepared image OCR reads; kept separately from the original. */
  processed: Blob | null;
  /** Fingerprint of the source + edits the processed image was made from. */
  processedKey: string | null;
  width: number;
  height: number;
  marks: PageMarks | null;
  result: OcrPageResult | null;
  /** Fingerprint of the processed image + engine settings the result was read with. */
  resultKey: string | null;
  layout: PageLayout | null;
  state: OcrPageState;
  error: string | null;
  /** What was marked on a printed census sheet (the processed image is then the flattened sheet). */
  census?: CensusSheetRead | null;
  /** Census sheets: the flattened sheet with only the letter boxes' handwriting (no box lines), for the handwriting reader. */
  handwriting?: Blob | null;
}

/** A saved, reusable template (built-in templates live in code). */
export interface StoredTemplate {
  id: ID;
  /** JSON of the template definition, validated with zod when read. */
  definition: unknown;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** A device benchmark run, kept so results can be compared and documented. */
export interface BenchmarkRecord {
  id: ID;
  createdAt: Timestamp;
  report: unknown;
}
