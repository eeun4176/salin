/**
 * QR Scanner
 * A camera dialog that reads a stub's QR code. It uses the browser's own
 * BarcodeDetector where there is one (most Android phones), and jsQR in a
 * worker elsewhere, a few frames a second. The camera stays on this device:
 * no frame is saved or sent. Without a camera (or permission) it says so,
 * and the code can still be typed.
 */

import { useEffect, useRef, useState } from "react";
import { CameraOff } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

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

export function QrScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  });

  useEffect(() => {
    let live = true;
    let stream: MediaStream | null = null;
    let reader: Awaited<ReturnType<typeof makeReader>> | null = null;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) return setProblem("This device can't open the camera here. Type the code printed under the QR instead.");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch {
        return live && setProblem("Salin couldn't use the camera. Allow camera access, or type the code printed under the QR.");
      }
      if (!live || !video.current) return stream.getTracks().forEach((track) => track.stop());
      video.current.srcObject = stream;
      await video.current.play().catch(() => {});
      reader = await makeReader();
      while (live) {
        const text = video.current && video.current.readyState >= 2 ? await reader.read(video.current).catch(() => null) : null;
        if (text && live) return onCodeRef.current(text);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    void start();
    return () => {
      live = false;
      stream?.getTracks().forEach((track) => track.stop());
      reader?.close();
    };
  }, []);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>Scan a stub</DialogTitle>
        <DialogDescription>Point the camera at the QR code on the stub.</DialogDescription>
        {problem ? (
          <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-salin-tile p-3 text-sm text-salin-text">
            <CameraOff aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-salin-muted" /> {problem}
          </p>
        ) : (
          <video ref={video} muted playsInline aria-label="Camera view" className="mt-4 aspect-square w-full rounded-xl bg-black object-cover" />
        )}
      </DialogContent>
    </Dialog>
  );
}
