/**
 * Reading Scanned Pages Settings
 * Settings → Reading scanned pages, in plain words: whether the reading
 * files are on this device (download with progress, ready offline, remove
 * safely), which languages to read, and how carefully to read (Automatic,
 * Faster or More careful). Device details and benchmarks are left out.
 */

import { useState } from "react";
import { ScanText, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ocrRuntime } from "@/core/ocr/engine/ocr-runtime";
import { OCR_LANGUAGES } from "@/core/ocr/models/model-assets";
import { ModelStatus } from "@/features/ocr/components/model-status";
import { SectionCard } from "@/features/settings/section-card";
import { formatBytes } from "@/features/workspace/query";
import { useOcrStore, type ProfileSetting } from "@/stores/ocr-store";
import { toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils";

const button = "press inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold ring-1 ring-salin-border hover:bg-salin-tile disabled:opacity-50";

const PROFILE_OPTIONS: { value: ProfileSetting; label: string; description: string }[] = [
  { value: "auto", label: "Automatic (recommended)", description: "e-Vet picks the best setting for this device." },
  { value: "standard", label: "Faster", description: "Reads pages quickly. Best for most phones." },
  { value: "accurate", label: "More careful", description: "Takes longer and reads hard pages again. Needs a stronger device." },
];

export function OcrSettingsCard() {
  const profile = useOcrStore((s) => s.profile);
  const setProfile = useOcrStore((s) => s.setProfile);
  const languages = useOcrStore((s) => s.languages);
  const setLanguages = useOcrStore((s) => s.setLanguages);
  const stored = useOcrStore((s) => s.storedBytes);
  const removeModels = useOcrStore((s) => s.removeModels);
  const [removing, setRemoving] = useState(false);

  return (
    <SectionCard icon={ScanText} title="Reading scanned pages" id="ocr-heading">
      <p className="text-sm text-salin-muted">e-Vet reads the text on your photos and scanned forms right on this phone. Your pages are never uploaded.</p>
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
              {l.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="text-sm font-semibold text-salin-text">How carefully to read</legend>
        <div className="mt-2 grid gap-2">
          {PROFILE_OPTIONS.map((o) => (
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

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-salin-border pt-4">
        <p className="min-w-0 flex-1 text-sm text-salin-muted">Reading files saved on this device: {formatBytes(stored)}</p>
        <button type="button" onClick={() => setRemoving(true)} disabled={stored === 0} className={cn(button, "text-destructive hover:bg-destructive/10")}>
          <Trash2 className="size-4" /> Remove files
        </button>
      </div>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove the reading files?"
        description="They're deleted from this device to free space. Your scans and datasets stay. You'll need to download the files again (while online) to read more pages."
        confirmLabel="Remove files"
        destructive
        onConfirm={async () => {
          if (ocrRuntime.isBusy()) {
            toast("A page is being read right now. Wait for it to finish, then remove the files.");
            return;
          }
          await removeModels();
          toast("Reading files removed.");
        }}
      />
    </SectionCard>
  );
}
