/**
 * Domain Types
 * Shapes of every record Salin stores in IndexedDB (folders, files, file bytes,
 * and the later-phase datasets/jobs/templates). Repositories and the database
 * schema use these; UI code works with the WorkspaceItem view model instead.
 */

export type ID = string;

/** Milliseconds since the Unix epoch (`Date.now()`). Numbers keep IndexedDB indexes sortable. */
export type Timestamp = number;

/** File formats Salin accepts (docs 5.2). */
export type FileKind = "pdf" | "xlsx" | "csv" | "png" | "jpg" | "webp";

export type JobStatus =
  | "draft"
  | "imported"
  | "processing"
  | "needs_review"
  | "reviewed"
  | "saved"
  | "exported"
  | "failed"
  | "cancelled";

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

export interface Dataset {
  id: ID;
  name: string;
  folderId: ID | null;
  sourceFileIds: ID[];
  schema: Record<string, unknown>;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedAt: Timestamp | null;
  isFavorite: boolean;
}

export interface DatasetRow {
  id: ID;
  datasetId: ID;
  values: Record<string, unknown>;
  sourceReference?: string;
}

export interface ProcessingJob {
  id: ID;
  taskType: string;
  sourceFileIds: ID[];
  status: JobStatus;
  progress: number;
  error?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface DocumentTemplate {
  id: ID;
  name: string;
  version: number;
  fields: Record<string, unknown>[];
  rules: Record<string, unknown>[];
}

export interface ModelMetadata {
  id: ID;
  version: string;
  runtime: string;
  downloadState: string;
  size: number;
}

export interface AppSetting {
  key: string;
  value: unknown;
}
