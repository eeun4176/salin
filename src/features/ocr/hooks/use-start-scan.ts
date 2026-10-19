/**
 * Start Scan Hook
 * `useStartScan()` returns a function that opens the Read text workflow for
 * workspace files (photos or PDFs): it resumes an unfinished scan of the
 * same files, or starts a new one. Used by the file ⋮ menu, the file
 * preview and the "scanned PDF" hint after a failed extraction.
 */

import { useCallback } from "react";
import { useNavigate } from "react-router";

import { scanUrl, startScan } from "@/features/ocr/ocr-actions";
import { useWorkspaceStore } from "@/stores/workspace-store";

export function useStartScan() {
  const navigate = useNavigate();
  return useCallback(
    async (fileIds: string[]) => {
      const files = useWorkspaceStore.getState().files.filter((f) => fileIds.includes(f.id));
      const id = await startScan(fileIds.map((fid) => files.find((f) => f.id === fid)).filter((f) => f !== undefined));
      if (id) navigate(scanUrl(id));
    },
    [navigate],
  );
}
