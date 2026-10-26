/**
 * QR Reader
 * Reads QR codes from a live camera video, for the one scanner (/scan) that
 * takes document pages and stub QR codes alike. It uses the browser's own
 * BarcodeDetector where there is one (most Android phones), and jsQR in a
 * worker elsewhere, a few frames a second. Frames stay on this device: none
 * is saved or sent.
 */

import { useEffect, useRef, type RefObject } from "react";

interface Detector {
  detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
}
type DetectorClass = { new (options: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

/** The browser's QR reader, or a jsQR worker when there isn't one. */
async function makeReader(): Promise<{ read: (video: HTMLVideoElement) => Promise<string | null>; close: () => void }> {
  const Native = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (Native && (await Native.getSupportedFormats?.())?.includes("qr_code")) {
    const detector = new Native({ formats: ["qr_code"] });
    return { read: async (video) => (await detector.detect(video))[0]?.rawValue ?? null, close: () => {} };
  }
  const worker = new Worker(new URL("../../core/programs/qr.worker.ts", import.meta.url), { type: "module", name: "salin-qr" });
  const canvas = document.createElement("canvas");
  return {
    read: (video) => {
      // 640px is plenty for a stub held near the camera, and keeps each frame quick.
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = context.getImageData(0, 0, canvas.width, canvas.height);
      return new Promise((resolve) => {
        worker.onmessage = (event: MessageEvent<string | null>) => resolve(event.data);
        worker.postMessage({ data: frame.data, width: frame.width, height: frame.height }, [frame.data.buffer]);
      });
    },
    close: () => worker.terminate(),
  };
}

/** While `active`, looks for a QR code in the video about three times a second and hands each one found to `onCode`. */
export function useQrWatch(video: RefObject<HTMLVideoElement | null>, active: boolean, onCode: (text: string) => void) {
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  });
  useEffect(() => {
    if (!active) return;
    let live = true;
    let reader: Awaited<ReturnType<typeof makeReader>> | null = null;
    void (async () => {
      reader = await makeReader().catch(() => null);
      if (!live) return reader?.close();
      while (live && reader) {
        const element = video.current;
        const text = element && element.readyState >= 2 && element.videoWidth ? await reader.read(element).catch(() => null) : null;
        if (text && live) onCodeRef.current(text);
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    })();
    return () => {
      live = false;
      reader?.close();
    };
  }, [video, active]);
}
