/**
 * Document Processing Hook
 * `useExtractData()` returns a function that turns workspace files into a
 * dataset and opens the review screen when it's ready. An Excel workbook
 * first goes to the "Choose tables" screen, where the user picks worksheets
 * and confirms the detected tables. Used by the file ⋮ menu, the file
 * preview and the document picker.
 */

import { useCallback } from "react";
import { useNavigate } from "react-router";

import { extractData } from "@/features/processing/processing-actions";
import { useWorkspaceStore } from "@/stores/workspace-store";

export function datasetUrl(datasetId: string) {
  return `/datasets/${datasetId}`;
}

export function chooseTablesUrl(fileId: string) {
  return `/files/${fileId}/tables`;
}

export function useExtractData() {
  const navigate = useNavigate();
  return useCallback(
    (fileIds: string[]) => {
      const files = useWorkspaceStore.getState().files;
      if (fileIds.length === 1 && files.find((f) => f.id === fileIds[0])?.kind === "xlsx") {
        navigate(chooseTablesUrl(fileIds[0]));
        return;
      }
      void extractData(fileIds, (datasetId) => navigate(datasetUrl(datasetId)));
    },
    [navigate],
  );
}
