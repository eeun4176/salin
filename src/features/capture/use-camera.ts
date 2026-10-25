/**
 * Camera Hook
 * Streams the device camera into the Scan screen's video element, handles
 * switching cameras and retrying, and explains camera errors.
 */

import { useEffect, useState, type RefObject } from "react";

export type Facing = "environment" | "user";
export type CameraError = "unsupported" | "insecure" | "denied" | "not-found" | "busy" | "unknown";
export type CameraStatus = { state: "starting" } | { state: "live" } | { state: "error"; error: CameraError };

function classify(error: unknown): CameraError {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "not-found";
  if (name === "NotReadableError" || name === "AbortError") return "busy";
  return "unknown";
}

function initialStatus(): CameraStatus {
  if (!window.isSecureContext) return { state: "error", error: "insecure" };
  if (!navigator.mediaDevices?.getUserMedia) return { state: "error", error: "unsupported" };
  return { state: "starting" };
}

/**
 * Streams the device camera into `videoRef`. Camera access needs a secure
 * context (HTTPS or localhost) — see docs, Step 7.
 */
export function useCamera(videoRef: RefObject<HTMLVideoElement | null>) {
  const [status, setStatus] = useState<CameraStatus>(initialStatus);
  const [facing, setFacing] = useState<Facing>("environment");
  const [attempt, setAttempt] = useState(0);
  const blocked = status.state === "error" && (status.error === "insecure" || status.error === "unsupported");

  useEffect(() => {
    if (blocked) return;
    const video = videoRef.current;
    let cancelled = false;
    let stream: MediaStream | null = null;

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (video) {
          video.srcObject = s;
          await video.play().catch(() => undefined);
        }
        setStatus({ state: "live" });
      })
      .catch((error: unknown) => {
        if (!cancelled) setStatus({ state: "error", error: classify(error) });
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (video) video.srcObject = null;
    };
  }, [blocked, facing, attempt, videoRef]);

  return {
    status,
    facing,
    flip: () => {
      setStatus({ state: "starting" });
      setFacing((f) => (f === "environment" ? "user" : "environment"));
    },
    retry: () => {
      setStatus({ state: "starting" });
      setAttempt((n) => n + 1);
    },
  };
}

export const CAMERA_ERROR_COPY: Record<CameraError, { title: string; body: string }> = {
  insecure: { title: "Camera needs a secure connection", body: "Open e-Vet over HTTPS (or localhost) to use the camera. You can still upload a photo." },
  unsupported: { title: "Camera not available", body: "This browser can't open the camera. Upload a photo of the document instead." },
  denied: { title: "Camera permission is off", body: "Allow camera access in your browser's site settings, then try again." },
  "not-found": { title: "No camera found", body: "Connect a camera or upload a photo of the document." },
  busy: { title: "Camera is busy", body: "Another app may be using the camera. Close it and try again." },
  unknown: { title: "Couldn't start the camera", body: "Try again, or upload a photo of the document." },
};
