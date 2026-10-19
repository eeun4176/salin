/**
 * Domain Types
 * Shapes of the workspace records Salin stores in IndexedDB (folders, files,
 * file bytes, thumbnails, settings). Processing jobs, extracted content and
 * datasets live in processing.ts; OCR scans, pages and templates in ocr.ts.
 * Repositories and the database schema use these; UI code works with the
 * WorkspaceItem view model instead.
 */

export type ID = string;

/** Milliseconds since the Unix epoch (`Date.now()`). Numbers keep IndexedDB indexes sortable. */
export type Timestamp = number;

/** File formats Salin accepts (docs 5.2). */
export type FileKind = "pdf" | "xlsx" | "csv" | "txt" | "png" | "jpg" | "webp";

export interface Folder {
  id: ID;
  name: string;
  /** `null` = top level of the workspace. */
  parentFolderId: ID | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastOpenedAt: Timestamp | null;
  /** Set when the folder itself was moved to Trash. Its contents stay untouched underneath it. */
  deletedAt: Timestamp | null;
  isFavorite: boolean;
}

export interface WorkspaceFile {
  id: ID;
  name: string;
  mimeType: string;
  kind: FileKind;
  size: number;
  folderId: ID | null;
  /** Bytes live in `fileBlobs`; copies of a file share one blob. */
  blobId: ID;
  source: "import" | "scan";
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastOpenedAt: Timestamp | null;
  deletedAt: Timestamp | null;
  isFavorite: boolean;
}

export interface FileBlob {
  id: ID;
  blob: Blob;
  size: number;
  /** SHA-256 hex digest, or `null` when the browser had no Web Crypto (insecure context). */
  checksum: string | null;
}

/**
 * A file card's preview, made from the file's bytes: a small image (photos,
 * PDF first page), the first rows of a table (CSV, or an Excel workbook's main
 * table with its title) or the first lines of text. `none` records that the
 * file has nothing to show (e.g. an empty workbook); `problem` records why a
 * file can't be previewed (damaged, password-protected, empty, unsupported
 * format). Unexplained failures aren't saved, so they're tried again.
 */
export type Thumbnail = { blobId: ID; version: number } & (
  | { kind: "image"; image: Blob }
  | { kind: "table"; rows: string[][]; title?: string }
  | { kind: "text"; text: string }
  | { kind: "none" }
  | { kind: "problem"; problem: ThumbnailProblem }
);

export type ThumbnailProblem = "damaged" | "locked" | "empty" | "unsupported";

export interface AppSetting {
  key: string;
  value: unknown;
}
