
export type ID = string;

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
  parentFolderId: ID | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  isFavorite: boolean;
}

export interface WorkspaceFile {
  id: ID;
  name: string;
  mimeType: string;
  size: number;
  folderId: ID | null;
  blobId: ID;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  deletedAt: string | null;
  isFavorite: boolean;
}

export interface FileBlob {
  id: ID;
  blob: Blob;
  checksum?: string;
}

export interface Dataset {
  id: ID;
  name: string;
  folderId: ID | null;
  sourceFileIds: ID[];
  schema: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
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
  createdAt: string;
  updatedAt: string;
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
