import { useCallback, useEffect, useRef, type ChangeEvent } from "react";
import { useNavigate } from "react-router";

import { ACCEPT_ATTR, toIntakeFiles, useIntakeStore } from "@/stores/intake-store";
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
      <input ref={fileRef} type="file" multiple accept={ACCEPT_ATTR} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={handleChange} />
      <input ref={folderRef} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={handleChange} />
    </>
  );

  return {
    inputs,
    pickFiles: () => fileRef.current?.click(),
    pickFolder: () => folderRef.current?.click(),
  };
}

/** Validates files, queues the supported ones and reports the rest. */
export function useQueueFiles() {
  const enqueue = useIntakeStore((s) => s.enqueue);
  // Stable so window-level drag listeners don't re-subscribe on every render.
  return useCallback((files: File[]) => {
    const { ok, rejected } = toIntakeFiles(files, "import");
    if (ok.length) enqueue(ok);
    if (rejected.length) {
      const first = rejected[0];
      toast(
        rejected.length === 1
          ? `Skipped “${first.name}”: ${first.reason.toLowerCase()}.`
          : `Skipped ${rejected.length} files that aren't PDF, XLSX, CSV, PNG, JPG or WebP (or are over 50 MB).`,
      );
    }
    return ok.length;
  }, [enqueue]);
}

/** Queue files and jump to the Import screen — used by the workspace "Upload" actions. */
export function useUploadToImport() {
  const queueFiles = useQueueFiles();
  const navigate = useNavigate();
  return (files: File[]) => {
    if (queueFiles(files) > 0) navigate("/import");
  };
}
