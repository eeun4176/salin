/**
 * AI Run Hook
 * Runs one on-device AI task at a time over a scan's extraction, with a
 * progress line (loading the model, working, writing) and Stop. The task's
 * suggestions go to the screen's `onResult`, applied to its latest
 * extraction; a toast says how many there are, or why nothing changed.
 */

import { useRef, useState } from "react";
import { LoaderCircle, Square } from "lucide-react";

import { AiError } from "@/core/ai/ai-runtime";
import type { AiResult } from "@/features/ai/ai-actions";
import { toast } from "@/stores/toast-store";
import type { Extraction } from "@/types/ocr";

type AiTask = (options: { signal: AbortSignal; onProgress: (p: { stage: string; fraction: number | null; tokens?: number }) => void }) => Promise<AiResult & { notFound?: string[] }>;

/** Runs one on-device AI task at a time with progress and Stop; its suggestions go to `onResult`. */
export function useAiRun(onResult: (apply: (current: Extraction) => Extraction) => void) {
  const [running, setRunning] = useState<{ label: string; progress: string } | null>(null);
  const controller = useRef<AbortController | null>(null);

  async function run(label: string, task: AiTask) {
    controller.current = new AbortController();
    setRunning({ label, progress: "Starting…" });
    try {
      const result = await task({
        signal: controller.current.signal,
        onProgress: (p) =>
          setRunning({
            label,
            progress:
              p.stage === "loading"
                ? `Loading the model${p.fraction !== null ? ` ${Math.round(p.fraction * 100)}%` : ""}…`
                : p.tokens
                  ? `Writing (${p.tokens} words)…`
                  : `Working${p.fraction !== null ? ` ${Math.round(p.fraction * 100)}%` : ""}…`,
          }),
      });
      onResult(result.apply);
      const missing = result.notFound?.length ? ` Not on the page: ${result.notFound.join(", ")}.` : "";
      toast(result.offered ? `${result.offered} suggestion${result.offered === 1 ? "" : "s"} to review.${missing}` : `No suggestions — nothing to change.${missing}`);
    } catch (error) {
      if (controller.current?.signal.aborted) toast("Stopped. Nothing was changed.");
      else toast(error instanceof AiError ? error.message : "The AI couldn't finish. Nothing was changed — try again.");
    } finally {
      setRunning(null);
      controller.current = null;
    }
  }

  const status = running && (
    <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-salin-muted">
      <LoaderCircle className="size-4 animate-spin text-salin-primary motion-reduce:animate-none" /> {running.label} — {running.progress}
      <button type="button" onClick={() => controller.current?.abort()} className="inline-flex items-center gap-1 font-semibold text-salin-primary hover:underline">
        <Square className="size-3.5" /> Stop
      </button>
    </p>
  );
  return { busy: running !== null, run, status };
}
