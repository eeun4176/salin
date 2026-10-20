/**
 * Processing Types
 * Shapes of the Phase 3 records: processing jobs (status, stage, progress,
 * errors), the text and tables extracted from a document, and the structured
 * datasets (columns, rows, source-file references — for scanned documents also
 * the OCR page region of each value) built from them. Stored in IndexedDB;
 * shared by the processing services, repositories and UI.
 */

import type { FileKind, ID, Timestamp } from "./domain";
import type { Box } from "./ocr";

/* ------------------------------------------------------------------
   Processing jobs
------------------------------------------------------------------- */

/**
 * queued → running → completed | failed | cancelled.
 * Failed and cancelled jobs can be queued again (retry).
 */
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

/** What a running job is doing right now. */
export type JobStage = "extracting" | "structuring" | "saving";

export type JobErrorCode =
  /** No parser handles this file type yet. */
  | "unsupported-file"
  /** The file (or its bytes) was deleted before or during processing. */
  | "file-missing"
  /** The parser couldn't read the document (damaged, encrypted, wrong format…). */
  | "parse-failed"
  /** The document was read but contained no text or tables. */
  | "no-content"
  /** IndexedDB refused the write (usually: storage full). */
  | "storage"
  /** The tab closed or crashed while the job was running. */
  | "interrupted"
  | "unknown";

export interface JobError {
  code: JobErrorCode;
  /** Short, user-facing explanation. */
  message: string;
  /** The file that caused it, when the error is about one file. */
  fileId: ID | null;
}

/**
 * A table the user confirmed in an Excel workbook: which sheet, which cells
 * (A1 notation, e.g. "A2:G11"), and how many of its top rows are headers.
 */
export interface TableSelection {
  sheet: string;
  range: string;
  /** 0 = no header (columns are named by letter); 2–3 = a header split over several rows. */
  headerRows: number;
}

export interface JobOptions {
  /** Name for the resulting dataset; defaults to the first file's name. */
  datasetName?: string;
  /** Confirmed Excel tables per workbook file id. Workbooks without an entry use automatic detection. */
  tables?: Record<ID, TableSelection[]>;
}

export interface ProcessingJob {
  id: ID;
  /** Documents to process, in order. All of them feed one dataset. */
  sourceFileIds: ID[];
  status: JobStatus;
  stage: JobStage | null;
  /** 0–1 across the whole job. */
  progress: number;
  options: JobOptions;
  /** The dataset this job produced, once completed. */
  datasetId: ID | null;
  error: JobError | null;
  createdAt: Timestamp;
  /** Also the heartbeat of a running job: it is refreshed while work progresses. */
  updatedAt: Timestamp;
  startedAt: Timestamp | null;
  finishedAt: Timestamp | null;
}

/* ------------------------------------------------------------------
   Extracted content
------------------------------------------------------------------- */

export interface ExtractedPage {
  /** 1-based page number (1 for formats without pages). */
  number: number;
  text: string;
}

export interface ExtractedTable {
  /** Readable label: the sheet name, or "Page 2 · Table 1". */
  name: string;
  sheet: string | null;
  page: number | null;
  /** Cell text, row by row. Unless `headerRows` is 0, `rows[0]` is the header. */
  rows: string[][];
  /** Row number of `rows[0]` in the source (1-based), used for source references. */
  firstRowNumber: number;
  /** 1 (default): `rows[0]` holds the column names. 0: every row is data. */
  headerRows?: 0 | 1;
  /** Spreadsheet cells the table was read from, e.g. "B3:F20". */
  range?: string;
  /** 0-based spreadsheet column of `rows[*][0]` — names unnamed columns by letter and gives each row its cell range. */
  firstColumn?: number;
}

/** What a parser returns for one document. */
export interface ExtractedContent {
  pages: ExtractedPage[];
  tables: ExtractedTable[];
  /** Non-fatal problems worth showing during review ("Page 3 has no text layer"). */
  warnings: string[];
}

/**
 * Cached parser output for one set of document bytes. Keyed by blob, so
 * copies of a file (which share bytes) are only parsed once. A new parser
 * version makes the cached result stale and it is extracted again.
 */
export interface ExtractedDocument extends ExtractedContent {
  id: ID;
  blobId: ID;
  /** The file it was extracted for (copies sharing the blob reuse it). */
  fileId: ID;
  kind: FileKind;
  parserId: string;
  parserVersion: number;
  createdAt: Timestamp;
}

/* ------------------------------------------------------------------
   Structured datasets
------------------------------------------------------------------- */

export type ColumnType = "text" | "number" | "date" | "boolean";

/** A cell after structuring. Dates are ISO "YYYY-MM-DD" strings in `date` columns. */
export type CellValue = string | number | boolean | null;

export interface DatasetColumn {
  /** Stable key into each row's `values`; survives renames and reordering. */
  id: ID;
  name: string;
  type: ColumnType;
  required: boolean;
  /** The header text this column came from in the source, if any. */
  sourceHeader: string | null;
}

/** Where a row came from, so reviewers can check it against the original document. */
export interface SourceReference {
  fileId: ID;
  page: number | null;
  sheet: string | null;
  /** 1-based row (or line) number within the page/sheet. */
  row: number | null;
  /** Spreadsheet cells the row came from, e.g. "B5:F5" (Excel only). */
  range: string | null;
  /** For rows read by OCR: the scan they came from and where on its page (page-relative 0–1 boxes). */
  ocr?: OcrSourceReference;
}

export interface OcrSourceReference {
  documentId: ID;
  /** 1-based page within the OCR document. */
  page: number;
  /** The whole record's region. */
  region: Box | null;
  /** Each value's region, by column id. */
  cells: Record<ID, Box>;
  /** What OCR originally read, by column id, where the reviewer changed it. */
  original: Record<ID, string>;
  /** Values that came from a suggestion the reviewer accepted, by column id: a rule, the handwriting reader or the on-device assistant. */
  suggested?: Record<ID, "rule" | "handwriting" | "ai">;
}

/** How a dataset was made, beyond its source files. */
export interface DatasetOrigin {
  kind: "ocr";
  documentId: ID;
  templateId: string;
}

export type DatasetStatus = "needs_review" | "reviewed";

export interface Dataset {
  id: ID;
  name: string;
  /** Documents the data came from. They may later be deleted; the dataset stays. */
  sourceFileIds: ID[];
  /** The processing job that created it (`null` if made another way, e.g. restored). */
  jobId: ID | null;
  /** Column order is array order. */
  columns: DatasetColumn[];
  rowCount: number;
  status: DatasetStatus;
  /** Increases on every content change, for conflict checks and exports. */
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastExportedAt: Timestamp | null;
  /** Set for datasets made from scanned documents (OCR). */
  origin?: DatasetOrigin;
}

export interface DatasetRow {
  id: ID;
  datasetId: ID;
  /** 0-based order within the dataset. */
  position: number;
  /** Keyed by `DatasetColumn.id`; missing keys read as empty. */
  values: Record<ID, CellValue>;
  source: SourceReference | null;
}

/** A row before it is saved (ids and positions are assigned by the repository). */
export interface DatasetRowDraft {
  values: Record<ID, CellValue>;
  source: SourceReference | null;
}

/** Columns plus rows: the output of structuring, and the input to saving a dataset. */
export interface DatasetContent {
  columns: DatasetColumn[];
  rows: DatasetRowDraft[];
}
