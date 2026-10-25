/**
 * AI Helpers Settings
 * Settings → AI helpers, in plain words: which helpers to use (Automatic,
 * Off, Handwriting, or Handwriting and assistant), and each optional helper
 * — what it does — with Download (progress, Cancel, resumes per file),
 * Check files and Remove. Warns before a download that won't fit or a
 * helper that will be slow on this device. Documents never leave the
 * device; only the helpers' files are downloaded.
 */

import { useEffect, useState } from "react";
import { Bot, Download, LoaderCircle, ShieldCheck, Square, Trash2, TriangleAlert } from "lucide-react";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { AI_MODELS, AI_MODES, variantFor, type AiModelId } from "@/core/ai/ai-models";
import { aiRuntime } from "@/core/ai/ai-runtime";
import { totalBytes } from "@/core/ocr/models/model-assets";
import { errorMessage } from "@/core/storage/errors";
import { getStorageStatus, type StorageStatus } from "@/core/storage/storage-health";
import { SectionCard } from "@/features/settings/section-card";
import { formatBytes } from "@/features/workspace/query";
import { useAiStore, type AiModeSetting } from "@/stores/ai-store";
import { toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils";

const button = "press inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold ring-1 ring-salin-border hover:bg-salin-tile disabled:opacity-50";

function ModelCard({ id, storage }: { id: AiModelId; storage: StorageStatus | null }) {
  const model = AI_MODELS[id];
  const caps = useAiStore((s) => s.caps);
  const state = useAiStore((s) => s.models[id]);
  const stored = useAiStore((s) => s.stored[id]);
  const download = useAiStore((s) => s.download);
  const cancel = useAiStore((s) => s.cancelDownload);
  const remove = useAiStore((s) => s.remove);
  const verify = useAiStore((s) => s.verify);
  const [removing, setRemoving] = useState(false);
  const [checking, setChecking] = useState(false);
  const variant = variantFor(model, caps);
  const size = totalBytes(variant.assets);
  const needed = state.status === "missing" ? state.bytes : size;
  const free = storage?.supported && storage.quota ? storage.quota - storage.usage : null;
  const tooBig = free !== null && state.status === "missing" && needed * 1.1 > free;
  const slow = id === "assistant" && variant.device === "wasm";

  return (
    <li className="rounded-2xl p-4 ring-1 ring-salin-border">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-salin-text">{model.name}</h3>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
            state.status === "ready" ? "bg-salin-primary-soft text-salin-primary-ink" : state.status === "error" || state.status === "unsupported" ? "bg-red-50 text-red-800 dark:bg-red-400/15 dark:text-red-300" : "bg-salin-tile text-salin-muted",
          )}
        >
          {state.status === "ready" ? "Ready offline" : state.status === "downloading" ? "Downloading" : state.status === "unsupported" ? "Not available here" : state.status === "error" ? "Problem" : state.status === "checking" ? "Checking…" : "Not downloaded"}
        </span>
      </div>
      <p className="mt-1 text-sm text-salin-muted">{model.purpose}</p>

      {state.status === "unsupported" && <p className="mt-3 text-sm text-red-700 dark:text-red-300">{state.message}</p>}
      {state.status === "error" && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
          {state.message}
        </p>
      )}
      {tooBig && (
        <p className="mt-3 flex gap-2 text-sm text-amber-800 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" /> This needs {formatBytes(needed)}, but only about {formatBytes(Math.max(0, free!))} is free for e-Vet. Free up space first.
        </p>
      )}
      {slow && state.status !== "unsupported" && (
        <p className="mt-3 flex gap-2 text-sm text-amber-800 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" /> This device can't speed up the assistant, so each answer may take tens of seconds.
        </p>
      )}
      {state.status === "downloading" && (
        <div className="mt-3">
          <div role="progressbar" aria-label={`${model.name} download`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((state.loaded / Math.max(1, state.total)) * 100)} className="h-2 overflow-hidden rounded-full bg-salin-tile">
            <div className="h-full rounded-full bg-salin-primary transition-[width]" style={{ width: `${(state.loaded / Math.max(1, state.total)) * 100}%` }} />
          </div>
          <p className="mt-1 text-xs text-salin-muted" aria-live="polite">
            {state.label} — {formatBytes(state.loaded)} of {formatBytes(state.total)}. Files already finished are kept if this stops.
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {state.status === "downloading" ? (
          <button type="button" onClick={() => cancel(id)} className={button}>
            <Square className="size-4" /> Cancel
          </button>
        ) : (
          state.status !== "ready" &&
          state.status !== "unsupported" && (
            <button type="button" onClick={() => void download(id)} disabled={state.status === "checking" || tooBig} className={cn(button, "bg-salin-primary text-white ring-0 hover:bg-salin-primary-strong")}>
              <Download className="size-4" /> {state.status === "error" ? "Try again" : `Download ${formatBytes(needed)}`}
            </button>
          )
        )}
        {state.status === "ready" && (
          <button
            type="button"
            disabled={checking}
            onClick={() => {
              setChecking(true);
              void verify(id)
                .then((message) => toast(message))
                .catch((e) => toast(errorMessage(e, "The files couldn't be checked.")))
                .finally(() => setChecking(false));
            }}
            className={button}
          >
            {checking ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Check files
          </button>
        )}
        {(state.status === "ready" || stored > 0) && (
          <button type="button" onClick={() => setRemoving(true)} className={cn(button, "text-destructive hover:bg-destructive/10")}>
            <Trash2 className="size-4" /> Remove{stored ? ` (${formatBytes(stored)})` : ""}
          </button>
        )}
      </div>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove the ${model.name.toLowerCase()}?`}
        description="Its files are deleted from this device to free space. Your scans, datasets and accepted suggestions stay. Download it again (while online) to use it."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (aiRuntime.isBusy()) {
            toast("The AI is working right now. Wait for it to finish, then remove the model.");
            return;
          }
          await remove(id);
          toast(`${model.name} removed.`);
        }}
      />
    </li>
  );
}

const MODE_OPTIONS: { value: AiModeSetting; label: string; description: string }[] = [
  { value: "auto", label: "Automatic (recommended)", description: "e-Vet turns on what this device can run comfortably." },
  ...(["standard", "lite", "advanced"] as const).map((mode) => ({ value: mode, label: AI_MODES[mode].label, description: AI_MODES[mode].description })),
];

export function AiSettingsCard() {
  const setting = useAiStore((s) => s.setting);
  const setSetting = useAiStore((s) => s.setSetting);
  const refresh = useAiStore((s) => s.refresh);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const models = useAiStore((s) => s.models);

  useEffect(() => {
    void refresh();
    void getStorageStatus().then(setStorage, () => undefined);
  }, [refresh, models.handwriting.status, models.assistant.status]);

  return (
    <SectionCard icon={Bot} title="AI helpers" id="ai-heading">
      <p className="text-sm text-salin-muted">
        Optional helpers that read handwriting and suggest fixes. They work on this phone only, your documents are never uploaded, and nothing changes until you approve it. e-Vet works fine without them.
      </p>

      <fieldset className="mt-5">
        <legend className="text-sm font-semibold text-salin-text">Which helpers to use</legend>
        <div className="mt-2 grid gap-2">
          {MODE_OPTIONS.map((o) => (
            <label key={o.value} className={cn("flex cursor-pointer gap-3 rounded-xl p-3 ring-1", setting === o.value ? "bg-salin-primary-soft ring-salin-primary" : "ring-salin-border hover:bg-salin-tile")}>
              <input type="radio" name="ai-mode" checked={setting === o.value} onChange={() => setSetting(o.value)} className="mt-0.5 size-4 accent-salin-primary" />
              <span>
                <span className="block text-sm font-medium text-salin-text">{o.label}</span>
                <span className="block text-xs text-salin-muted">{o.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <h3 className="mt-5 text-sm font-semibold text-salin-text">Downloads</h3>
      <ul className="mt-2 space-y-3">
        {(Object.keys(AI_MODELS) as AiModelId[]).map((id) => (
          <ModelCard key={id} id={id} storage={storage} />
        ))}
      </ul>
    </SectionCard>
  );
}
