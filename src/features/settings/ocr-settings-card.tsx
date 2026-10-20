/**
 * Text Recognition Settings
 * Settings → Text recognition: whether the OCR files are on this device
 * (download with size and progress, ready offline, remove safely), which
 * languages to read, the processing profile (Auto picks Standard or
 * Accurate for this device), what this device supports (WebAssembly and
 * SIMD, WebGPU, memory, CPU cores, workers), and a benchmark that measures
 * speed, memory and accuracy here — with results to copy for documenting
 * the Android device tests.
 */

import { useEffect, useState } from "react";
import { Copy, Gauge, LoaderCircle, ScanText, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ocrRuntime } from "@/core/ocr/engine/ocr-runtime";
import { OCR_PROFILES } from "@/core/ocr/models/capabilities";
import { MODEL_ASSETS, OCR_LANGUAGES } from "@/core/ocr/models/model-assets";
import { errorMessage } from "@/core/storage/errors";
import { listBenchmarks, saveBenchmark } from "@/core/storage/repositories/ocr.repository";
import { ModelStatus } from "@/features/ocr/components/model-status";
import { reportToMarkdown, runBenchmark, type BenchmarkReport } from "@/features/ocr/benchmark";
import { SectionCard } from "@/features/settings/section-card";
import { formatBytes } from "@/features/workspace/query";
import { useOcrStore, useProfileChoice, type ProfileSetting } from "@/stores/ocr-store";
import { toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils";

const button = "press inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold ring-1 ring-salin-border hover:bg-salin-tile disabled:opacity-50";

function DeviceFacts() {
  const caps = useOcrStore((s) => s.caps);
  if (!caps) return <p className="text-sm text-salin-muted">Checking this device…</p>;
  const yes = (v: boolean) => (v ? "Yes" : "No");
  const facts: [string, string][] = [
    ["WebAssembly", caps.webAssembly ? `Yes${caps.wasmRelaxedSimd ? " · relaxed SIMD" : caps.wasmSimd ? " · SIMD" : " · no SIMD (slower)"}` : "No — text recognition can't run"],
    ["WebGPU", caps.webGpu === "available" ? "Available (not needed by the current engine)" : caps.webGpu === "no-adapter" ? "Present, no GPU adapter" : "Not supported — the CPU engine is used"],
    ["Memory", caps.deviceMemoryGb ? `About ${caps.deviceMemoryGb} GB${caps.deviceMemoryGb >= 8 ? " or more" : ""}` : "Not reported by this browser"],
    ["CPU cores", caps.cpuCores ? String(caps.cpuCores) : "Not reported"],
    ["Background workers", yes(caps.workers && caps.offscreenCanvas) + (caps.workers && !caps.offscreenCanvas ? " (image prep runs on the main thread)" : "")],
    ["Camera", caps.camera && caps.secureContext ? "Available" : caps.secureContext ? "Not available" : "Needs HTTPS"],
  ];
  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[10rem_1fr]">
      {facts.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-salin-muted">{k}</dt>
          <dd className="text-salin-text">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Benchmark() {
  const caps = useOcrStore((s) => s.caps);
  const languages = useOcrStore((s) => s.languages);
  const choice = useProfileChoice();
  const setBenchmarkSeconds = useOcrStore((s) => s.setBenchmarkSeconds);
  const refresh = useOcrStore((s) => s.refresh);
  const unsupported = useOcrStore((s) => s.model.status === "unsupported");
  const [step, setStep] = useState<string | null>(null);
  const [reports, setReports] = useState<BenchmarkReport[]>([]);

  useEffect(() => {
    void listBenchmarks().then((rows) => {
      const list = rows.map((r) => r.report as BenchmarkReport).filter((r) => r?.version === 1 && "profile" in r);
      setReports(list);
      const standard = list.find((r) => r.profile === "standard");
      if (standard) setBenchmarkSeconds(standard.readMs[1] / 1000);
    });
  }, [setBenchmarkSeconds]);

  async function run() {
    if (!caps) return;
    setStep("Starting");
    try {
      const report = await runBenchmark(caps, choice.profile, languages, setStep);
      await saveBenchmark(report);
      setReports((r) => [report, ...r]);
      if (report.profile === "standard") setBenchmarkSeconds(report.readMs[1] / 1000);
      void refresh();
    } catch (e) {
      toast(errorMessage(e, e instanceof Error ? e.message : "The benchmark didn't finish."));
    } finally {
      setStep(null);
    }
  }

  async function copy(report: BenchmarkReport) {
    const text = `${reportToMarkdown(report)}\n\n<details><summary>JSON</summary>\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n</details>\n`;
    try {
      await navigator.clipboard.writeText(text);
      toast("Benchmark results copied.");
    } catch {
      toast("Copying isn't allowed here — select the results and copy them instead.");
    }
  }

  const latest = reports[0];
  return (
    <div>
      <p className="text-sm text-salin-muted">Reads a built-in test form with the {OCR_PROFILES[choice.profile].label} profile and measures speed, memory and accuracy on this device. Run it on your Android phone to document real-device results.</p>
      <button type="button" onClick={() => void run()} disabled={step !== null || !caps || unsupported} className={cn(button, "mt-3")}>
        {step ? <LoaderCircle className="size-4 animate-spin" /> : <Gauge className="size-4" />} {step ? `${step}…` : "Test this device"}
      </button>
      {latest && (
        <div className="mt-4 overflow-x-auto rounded-xl ring-1 ring-salin-border" data-lenis-prevent-horizontal="">
          <table aria-label="Latest benchmark" className="w-full text-left text-sm">
            <tbody className="divide-y divide-salin-border">
              {(
                [
                  ["Date", new Date(latest.date).toLocaleString()],
                  ["Profile", `${OCR_PROFILES[latest.profile].label} · ${latest.engineBuild}`],
                  ["Engine start", `${(latest.initMs / 1000).toFixed(2)} s`],
                  ["Prepare page", `${(latest.prepareMs / 1000).toFixed(2)} s`],
                  ["Read page", `${(latest.readMs[0] / 1000).toFixed(2)} s first, ${(latest.readMs[1] / 1000).toFixed(2)} s after`],
                  ["Memory (JS heap)", latest.heapMb === null ? "Not reported by this browser" : `${latest.heapMb} MB`],
                  ["Characters wrong (CER)", `${(latest.accuracy.cer * 100).toFixed(1)}%`],
                  ["Words wrong (WER)", `${(latest.accuracy.wer * 100).toFixed(1)}%`],
                  ["Fields correct", `${latest.accuracy.fieldsCorrect} of ${latest.accuracy.fieldsTotal}`],
                ] as const
              ).map(([k, v]) => (
                <tr key={k}>
                  <th scope="row" className="px-3 py-2 font-medium whitespace-nowrap text-salin-muted">
                    {k}
                  </th>
                  <td className="px-3 py-2 text-salin-text">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {latest && (
        <button type="button" onClick={() => void copy(latest)} className={cn(button, "mt-3")}>
          <Copy className="size-4" /> Copy results
        </button>
      )}
      {reports.length > 1 && <p className="mt-2 text-xs text-salin-muted">{reports.length} runs saved on this device.</p>}
    </div>
  );
}

export function OcrSettingsCard() {
  const profile = useOcrStore((s) => s.profile);
  const setProfile = useOcrStore((s) => s.setProfile);
  const languages = useOcrStore((s) => s.languages);
  const setLanguages = useOcrStore((s) => s.setLanguages);
  const stored = useOcrStore((s) => s.storedBytes);
  const removeModels = useOcrStore((s) => s.removeModels);
  const choice = useProfileChoice();
  const [removing, setRemoving] = useState(false);

  const options: { value: ProfileSetting; label: string; description: string }[] = [
    { value: "auto", label: `Auto (${OCR_PROFILES[choice.profile].label} here)`, description: profile === "auto" ? choice.reason : "Picks the best profile for this device." },
    { value: "standard", label: OCR_PROFILES.standard.label, description: OCR_PROFILES.standard.description },
    { value: "accurate", label: OCR_PROFILES.accurate.label, description: OCR_PROFILES.accurate.description },
  ];

  return (
    <SectionCard icon={ScanText} title="Text recognition" id="ocr-heading">
      <p className="text-sm text-salin-muted">Read photos and scanned PDFs on this device. Pages and their text never leave it — there's no cloud OCR.</p>
      <div className="mt-4">
        <ModelStatus compact />
      </div>

      <fieldset className="mt-5">
        <legend className="text-sm font-semibold text-salin-text">Languages</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {OCR_LANGUAGES.map((l) => (
            <label key={l.code} className={cn("inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1", languages.includes(l.code) ? "bg-salin-primary-soft ring-salin-primary" : "ring-salin-border")}>
              <input
                type="checkbox"
                checked={languages.includes(l.code)}
                disabled={l.required}
                onChange={(e) => setLanguages(e.target.checked ? [...languages, l.code] : languages.filter((c) => c !== l.code))}
                className="size-4 accent-salin-primary"
              />
              {l.label} <span className="text-xs text-salin-muted">{formatBytes(MODEL_ASSETS[l.assetId].bytes)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="text-sm font-semibold text-salin-text">Profile</legend>
        <div className="mt-2 grid gap-2">
          {options.map((o) => (
            <label key={o.value} className={cn("flex cursor-pointer gap-3 rounded-xl p-3 ring-1", profile === o.value ? "bg-salin-primary-soft ring-salin-primary" : "ring-salin-border hover:bg-salin-tile")}>
              <input type="radio" name="ocr-profile" checked={profile === o.value} onChange={() => setProfile(o.value)} className="mt-0.5 size-4 accent-salin-primary" />
              <span>
                <span className="block text-sm font-medium text-salin-text">{o.label}</span>
                <span className="block text-xs text-salin-muted">{o.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <details className="mt-5">
        <summary className="cursor-pointer text-sm font-semibold text-salin-text">This device</summary>
        <div className="mt-3">
          <DeviceFacts />
        </div>
      </details>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-semibold text-salin-text">Benchmark</summary>
        <div className="mt-3">
          <Benchmark />
        </div>
      </details>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-salin-border pt-4">
        <p className="min-w-0 flex-1 text-sm text-salin-muted">Recognition files on this device: {formatBytes(stored)}</p>
        <button type="button" onClick={() => setRemoving(true)} disabled={stored === 0} className={cn(button, "text-destructive hover:bg-destructive/10")}>
          <Trash2 className="size-4" /> Remove files
        </button>
      </div>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove the text-recognition files?"
        description="They're deleted from this device to free space. Your scans and datasets stay. You'll need to download the files again (while online) to read more pages."
        confirmLabel="Remove files"
        destructive
        onConfirm={async () => {
          if (ocrRuntime.isBusy()) {
            toast("A page is being read right now. Wait for it to finish, then remove the files.");
            return;
          }
          await removeModels();
          toast("Text-recognition files removed.");
        }}
      />
    </SectionCard>
  );
}
