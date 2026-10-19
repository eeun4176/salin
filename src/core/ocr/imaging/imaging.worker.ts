/**
 * Imaging Worker
 * Runs page preparation (decode, crop, perspective, enhance, deskew, line
 * and checkbox detection) off the main thread so the page stays responsive
 * on phones. Receives `{ id, request }`, replies `{ id, result }` or
 * `{ id, error }`.
 */

import { runImaging, type ImagingRequest } from "@/core/ocr/imaging/imaging-ops";

self.onmessage = async (event: MessageEvent<{ id: number; request: ImagingRequest }>) => {
  const { id, request } = event.data;
  try {
    const result = await runImaging(request);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? { name: error.name, message: error.message } : { name: "Error", message: String(error) } });
  }
};
