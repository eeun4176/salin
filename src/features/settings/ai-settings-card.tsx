/**
 * On-device AI Settings
 * Settings → On-device AI: the processing mode (Auto picks Standard, AI
 * Lite or AI Advanced for this device), and each optional model — what it
 * does, download size, languages, device needs, license and its pinned
 * source — with Download (progress, Cancel, resumes per file), Check files
 * (integrity), and Remove. Warns before a download that won't fit or a
 * model this device is too weak for, and benchmarks the models here with
 * results to copy for the Android tests. Documents never leave the device;
 * only model files are downloaded, from the approved host.
 */

import { useEffect, useState } from "react";
import { Bot, Copy, Download, Gauge, LoaderCircle, ShieldCheck, Square, Trash2, TriangleAlert } from "lucide-react";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { AI_MODEL_HOST, AI_MODELS, AI_MODES, AI_RUNTIME, variantFor, variantSource, type AiModelId } from "@/core/ai/ai-models";
import { aiRuntime } from "@/core/ai/ai-runtime";
import { totalBytes } from "@/core/ocr/models/model-assets";
import { errorMessage } from "@/core/storage/errors";
import { listBenchmarks, saveBenchmark } from "@/core/storage/repositories/ocr.repository";
import { getStorageStatus, type StorageStatus } from "@/core/storage/storage-health";
import { aiReportToMarkdown, runAiBenchmark, type AiBenchmarkReport } from "@/features/ai/ai-benchmark";
import { SectionCard } from "@/features/settings/section-card";
import { formatBytes } from "@/features/workspace/query";
import { useAiMode, useAiStore, type AiModeSetting } from "@/stores/ai-store";
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
  const source = variantSource(model, variant);

  const facts: [string, string][] = [
    ["Download", `${formatBytes(size)}${variant.assets.some((a) => a.id === AI_RUNTIME.id) ? ` (includes the ${formatBytes(AI_RUNTIME.bytes)} AI engine shared by both models)` : ""}`],
    ["Runs on", variant.device === "webgpu" ? "The GPU (WebGPU)" : "The CPU (WebAssembly)"],
    ["Languages", model.languages],
    ["Can do", model.capabilities.join(" · ")],
    ["Needs", model.requirements],
    ["License", model.license],
    ["Source", `${new URL(AI_MODEL_HOST).host} · ${source.repo} @ ${source.revision.slice(0, 7)} (pinned)`],
  ];

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
      <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[7rem_1fr]">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-salin-muted">{k}</dt>
            <dd className="text-salin-text">{v}</dd>
          </div>
        ))}
      </dl>

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
          <TriangleAlert className="mt-0.5 size-4 shrink-0" /> No usable WebGPU here, so the assistant runs on the CPU — expect tens of seconds per answer. Run the benchmark below to see.
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

function AiBenchmark() {
  const caps = useAiStore((s) => s.caps);
  const handwriting = useAiStore((s) => s.models.handwriting.status);
  const assistantState = useAiStore((s) => s.models.assistant.status);
  const setAssistantSeconds = useAiStore((s) => s.setAssistantSeconds);
  const [step, setStep] = useState<string | null>(null);
  const [reports, setReports] = useState<AiBenchmarkReport[]>([]);

  useEffect(() => {
    void listBenchmarks().then((rows) => {
      const list = rows.map((r) => r.report as AiBenchmarkReport).filter((r) => r?.kind === "ai");
      setReports(list);
      const withAssistant = list.find((r) => r.assistant);
      if (withAssistant?.assistant) setAssistantSeconds(withAssistant.assistant.perAnswerMs / 1000);
    });
  }, [setAssistantSeconds]);

  async function run() {
    if (!caps) return;
    setStep("Starting");
    try {
      const report = await runAiBenchmark(caps, { assistant: assistantState === "ready" ? variantFor(AI_MODELS.assistant, caps) : null, onStep: setStep });
      await saveBenchmark(report);
      setReports((r) => [report, ...r]);
      if (report.assistant) setAssistantSeconds(report.assistant.perAnswerMs / 1000);
    } catch (e) {
      toast(e instanceof Error && e.name === "AiError" ? e.message : errorMessage(e, "The benchmark didn't finish."));
    } finally {
      setStep(null);
    }
  }

  async function copy(report: AiBenchmarkReport) {
    try {
      await navigator.clipboard.writeText(`${aiReportToMarkdown(report)}\n\n<details><summary>JSON</summary>\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n</details>\n`);
      toast("AI benchmark results copied.");
    } catch {
      toast("Copying isn't allowed here — select the results and copy them instead.");
    }
  }

  const latest = reports[0];
  return (
    <div>
      <p className="text-sm text-salin-muted">Times the handwriting reader (and the assistant, if downloaded) on built-in samples. Run it on your Android phone to document real-device speed and memory.</p>
      <button type="button" onClick={() => void run()} disabled={step !== null || handwriting !== "ready"} title={handwriting !== "ready" ? "Download the handwriting reader first." : undefined} className={cn(button, "mt-3")}>
        {step ? <LoaderCircle className="size-4 animate-spin" /> : <Gauge className="size-4" />} {step ? `${step}…` : "Test AI on this device"}
      </button>
      {latest && (
        <>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-salin-tile p-3 text-xs whitespace-pre-wrap text-salin-text" data-lenis-prevent-horizontal="">
            {aiReportToMarkdown(latest)}
          </pre>
          <button type="button" onClick={() => void copy(latest)} className={cn(button, "mt-3")}>
            <Copy className="size-4" /> Copy results
          </button>
        </>
      )}
    </div>
  );
}

export function AiSettingsCard() {
  const setting = useAiStore((s) => s.setting);
  const setSetting = useAiStore((s) => s.setSetting);
  const refresh = useAiStore((s) => s.refresh);
  const caps = useAiStore((s) => s.caps);
  const choice = useAiMode();
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const models = useAiStore((s) => s.models);

  useEffect(() => {
    void refresh();
    void getStorageStatus().then(setStorage, () => undefined);
  }, [refresh, models.handwriting.status, models.assistant.status]);

  const options: { value: AiModeSetting; label: string; description: string }[] = [
    { value: "auto", label: `Auto (${AI_MODES[choice.mode].label} here)`, description: setting === "auto" ? choice.reason : "Picks the mode this device can comfortably run." },
    ...(["standard", "lite", "advanced"] as const).map((mode) => ({ value: mode, label: AI_MODES[mode].label, description: AI_MODES[mode].description })),
  ];

  return (
    <SectionCard icon={Bot} title="On-device AI" id="ai-heading">
      <p className="text-sm text-salin-muted">
        Optional models that read handwriting and suggest fixes, field matches and dataset actions. They run on this device only — your documents are never uploaded — and they only suggest: you approve every change. Everything else works without them.
      </p>

      <fieldset className="mt-5">
        <legend className="text-sm font-semibold text-salin-text">Mode</legend>
        <div className="mt-2 grid gap-2">
          {options.map((o) => (
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

      <h3 className="mt-5 text-sm font-semibold text-salin-text">Models</h3>
      <ul className="mt-2 space-y-3">
        {(Object.keys(AI_MODELS) as AiModelId[]).map((id) => (
          <ModelCard key={id} id={id} storage={storage} />
        ))}
      </ul>
      <p className="mt-3 text-xs text-salin-muted">
        Model files download only from {new URL(AI_MODEL_HOST).host}, at the exact versions e-Vet was tested with, and are checked for size before use. {caps ? `This device: WebGPU ${caps.webGpu === "available" ? `available${caps.webGpuF16 ? " (16-bit)" : ""}` : "not available"} · memory ${caps.deviceMemoryGb ? `about ${caps.deviceMemoryGb} GB` : "not reported"}.` : ""}
      </p>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-semibold text-salin-text">AI benchmark</summary>
        <div className="mt-3">
          <AiBenchmark />
        </div>
      </details>
    </SectionCard>
  );
}
