/**
 * Workbook Hook
 * Loads an Excel file from the workspace and reads it into a WorkbookModel
 * (sheets, cells, merges, formulas, embedded objects) for the "Choose
 * tables" screen and the file preview. The reader (SheetJS) is loaded on
 * first use. Pass `maxRows` for a quick preview of large workbooks.
 */

import { useEffect, useState } from "react";

import type { WorkbookModel } from "@/core/processing/excel/workbook-reader";
import { ProcessingError } from "@/core/processing/processing-errors";
import { errorMessage } from "@/core/storage/errors";
import { getFileWithBlob } from "@/core/storage/repositories/file-repository";
import type { WorkspaceFile } from "@/types/domain";

export type WorkbookState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; file: WorkspaceFile; workbook: WorkbookModel };

export function useWorkbook(fileId: string, maxRows?: number): WorkbookState {
  const [loaded, setLoaded] = useState<{ key: string; state: WorkbookState } | null>(null);
  const key = `${fileId}:${maxRows ?? "all"}`;

  useEffect(() => {
    let active = true;
    (async () => {
      const [{ file, blob }, { readWorkbook }] = await Promise.all([getFileWithBlob(fileId), import("@/core/processing/excel/workbook-reader")]);
      const workbook = await readWorkbook(blob, file.name, { maxRows });
      if (active) setLoaded({ key, state: { status: "ready", file, workbook } });
    })().catch((error: unknown) => {
      const message = error instanceof ProcessingError ? error.message : errorMessage(error, "This workbook couldn't be opened.");
      if (active) setLoaded({ key, state: { status: "error", message } });
    });
    return () => {
      active = false;
    };
  }, [fileId, key, maxRows]);

  return loaded?.key === key ? loaded.state : { status: "loading" };
}
