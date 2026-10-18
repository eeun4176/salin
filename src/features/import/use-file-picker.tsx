/**
 * File Picker Hooks
 * Hidden <input type="file"> elements (files or a whole folder) with functions
 * to open them, plus hooks that validate picked files and either queue them
 * on the Import screen or save them straight into a workspace folder.
 */

import { useCallback, useEffect, useRef, type ChangeEvent } from "react";

import { saveIntakeFiles } from "@/features/workspace/workspace-actions";
import { ACCEPT_ATTR, toIntakeFiles, useIntakeStore, type IntakeResult, type PickedFile } from "@/stores/intake-store";
import { toast } from "@/stores/toast-store";

/**
 * Hidden file / folder inputs plus functions that open them. Render `inputs`
 * once in the component that owns the pickers.
 */
export function useFilePicker(onFiles: (files: File[]) => void) {
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Not in React's typings; enables "Upload a Folder" in Chromium, Safari and Firefox.
    folderRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length) onFiles(files);
  };

  const inputs = (
    <>
      <input ref={fileRef} type="file" multiple accept={ACCEPT_ATTR} className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="file-input" onChange={handleChange} />
      <input ref={folderRef} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="folder-input" onChange={handleChange} />
    </>
  );

  return {
    inputs,
    pickFiles: () => fileRef.current?.click(),
    pickFolder: () => folderRef.current?.click(),
  };
}

/** Toast for files that failed validation. */
export function reportRejected(rejected: IntakeResult["rejected"]) {
  if (rejected.length === 0) return;
  const first = rejected[0];
  toast(
    rejected.length === 1
      ? `Skipped “${first.name}”: ${first.reason.toLowerCase()}.`
      : `Skipped ${rejected.length} files that aren't PDF, XLSX, CSV, PNG, JPG or WebP (or are over 50 MB).`,
  );
}

/** Validates files, queues the supported ones on the Import screen and reports the rest. */
export function useQueueFiles() {
  const enqueue = useIntakeStore((s) => s.enqueue);
  // Stable so window-level drag listeners don't re-subscribe on every render.
  return useCallback(
    (files: (File | PickedFile)[]) => {
      const { ok, rejected } = toIntakeFiles(files, "import");
      if (ok.length) enqueue(ok);
      reportRejected(rejected);
      return ok.length;
    },
    [enqueue],
  );
}

/** Validates files and saves them straight into a workspace folder (the workspace "Upload" actions). */
export function useUploadToFolder(folderId: string | null) {
  return useCallback(
    async (files: (File | PickedFile)[]) => {
      const { ok, rejected } = toIntakeFiles(files, "import");
      reportRejected(rejected);
      if (ok.length === 0) return;
      toast(`Saving ${ok.length} file${ok.length === 1 ? "" : "s"}…`);
      await saveIntakeFiles(ok, folderId);
      ok.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
    },
    [folderId],
  );
}
