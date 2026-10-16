
import Dexie, { type EntityTable } from "dexie";

import type {
  Folder,
  WorkspaceFile,
  FileBlob,
  Dataset,
  DatasetRow,
  ProcessingJob,
  DocumentTemplate,
  ModelMetadata,
  AppSetting,
} from "@/types/domain";

export const db = new Dexie("SalinAI") as Dexie & {
  folders: EntityTable<Folder, "id">;
  files: EntityTable<WorkspaceFile, "id">;
  fileBlobs: EntityTable<FileBlob, "id">;
  datasets: EntityTable<Dataset, "id">;
  datasetRows: EntityTable<DatasetRow, "id">;
  processingJobs: EntityTable<ProcessingJob, "id">;
  templates: EntityTable<DocumentTemplate, "id">;
  modelMetadata: EntityTable<ModelMetadata, "id">;
  settings: EntityTable<AppSetting, "key">;
};

db.version(1).stores({
  folders: "id, name, parentFolderId, updatedAt, deletedAt, isFavorite",
  files: "id, name, folderId, blobId, updatedAt, lastOpenedAt, deletedAt, isFavorite",
  fileBlobs: "id",
  datasets: "id, name, folderId, updatedAt, deletedAt, isFavorite, *sourceFileIds",
  datasetRows: "id, datasetId",
  processingJobs: "id, status, taskType, updatedAt",
  templates: "id, name",
  modelMetadata: "id",
  settings: "key",
});

export async function initializeDatabase() {
  await db.open();
  return db.isOpen();
}
