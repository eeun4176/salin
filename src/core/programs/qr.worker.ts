/**
 * QR Worker
 * Reads a QR code from one camera frame with jsQR, off the main thread, for
 * browsers without the built-in BarcodeDetector. Replies with the code's
 * text, or null when the frame has none.
 */

import jsQR from "jsqr";

self.onmessage = (event: MessageEvent<{ data: Uint8ClampedArray; width: number; height: number }>) => {
  const { data, width, height } = event.data;
  self.postMessage(jsQR(data, width, height, { inversionAttempts: "dontInvert" })?.data ?? null);
};
