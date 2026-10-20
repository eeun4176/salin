/**
 * Ask Box
 * Plain-language requests about a dataset ("show unvaccinated dogs in
 * Muzon", "ilan ang aso bawat barangay?"), answered by the on-device
 * assistant as a dataset command — validated against the dataset and then
 * previewed, never applied directly. Shows progress with Stop, explains
 * requests it can't do, and points to the Transform tools when the
 * assistant isn't set up on this device.
 */

import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Bot, LoaderCircle, SendHorizontal, Square } from "lucide-react";

import { AiError } from "@/core/ai/ai-runtime";
import type { DatasetCommand } from "@/core/processing/dataset-commands";
import { commandFromRequest } from "@/features/ai/ai-actions";
import { useAiFeature } from "@/stores/ai-store";
import type { DatasetColumn, DatasetRow } from "@/types/processing";

interface AskBoxProps {
  columns: DatasetColumn[];
  rows: DatasetRow[];
  onCommand: (command: DatasetCommand) => void;
  onOpenTransform: () => void;
}

export function AskBox({ columns, rows, onCommand, onOpenTransform }: AskBoxProps) {
  const assistant = useAiFeature("assistant");
  const [request, setRequest] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!request.trim() || status) return;
    setProblem(null);
    controller.current = new AbortController();
    setStatus("Starting the assistant…");
    try {
      const reply = await commandFromRequest(request, columns, rows, assistant.variant, {
        signal: controller.current.signal,
        onProgress: (p) => setStatus(p.stage === "loading" ? `Loading the assistant${p.fraction !== null ? ` ${Math.round(p.fraction * 100)}%` : ""}…` : "Thinking…"),
      });
      if (reply.ok) onCommand(reply.command);
      else setProblem(reply.message);
    } catch (error) {
      if (!controller.current?.signal.aborted) setProblem(error instanceof AiError ? error.message : "The assistant couldn't answer. Try again, or use Transform.");
    } finally {
      setStatus(null);
      controller.current = null;
    }
  }

  if (!assistant.ready) {
    return (
      <p className="flex items-start gap-2 text-xs text-salin-muted">
        <Bot aria-hidden="true" className="mt-px size-4 shrink-0" />
        <span>
          Want to ask in plain words? {assistant.reason}{" "}
          <Link to="/settings#ai-heading" className="font-semibold text-salin-primary hover:underline">
            Settings
          </Link>
        </span>
      </p>
    );
  }

  return (
    <div className="min-w-0">
      <form onSubmit={(e) => void ask(e)} className="flex items-center gap-2 rounded-xl bg-salin-surface p-1 pl-3 ring-1 ring-salin-border focus-within:ring-2 focus-within:ring-salin-primary/50">
        <Bot aria-hidden="true" className="size-4 shrink-0 text-violet-600" />
        <label htmlFor="ask-dataset" className="sr-only">
          Ask about this dataset
        </label>
        <input
          id="ask-dataset"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="Ask: “show unvaccinated dogs in Muzon”"
          maxLength={500}
          disabled={status !== null}
          className="h-9 min-w-0 flex-1 bg-transparent text-sm text-salin-text outline-none placeholder:text-salin-subtle"
        />
        {status ? (
          <button type="button" onClick={() => controller.current?.abort()} aria-label="Stop" className="grid size-9 shrink-0 place-items-center rounded-lg text-salin-muted hover:bg-salin-tile">
            <Square className="size-4" />
          </button>
        ) : (
          <button type="submit" aria-label="Ask" disabled={!request.trim()} className="grid size-9 shrink-0 place-items-center rounded-lg bg-salin-primary text-white hover:bg-salin-primary-strong disabled:bg-salin-tile disabled:text-salin-subtle">
            <SendHorizontal className="size-4" />
          </button>
        )}
      </form>
      {status && (
        <p role="status" className="mt-1.5 flex items-center gap-1.5 text-xs text-salin-muted">
          <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> {status} Runs on this device — the data never leaves it.
        </p>
      )}
      {problem && (
        <p role="alert" className="mt-1.5 text-xs text-amber-800 dark:text-amber-300">
          {problem}{" "}
          <button type="button" onClick={onOpenTransform} className="font-semibold text-salin-primary hover:underline">
            Use Transform instead
          </button>
        </p>
      )}
    </div>
  );
}
