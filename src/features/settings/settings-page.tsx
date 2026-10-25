/**
 * Settings Page (/settings)
 * Device storage (usage, quota, low-space warning, persistent storage
 * request), workspace backup & restore, privacy controls (delete all data
 * on this device), appearance (light / dark / match device theme,
 * comfortable / compact density), reading scanned pages (files, languages,
 * how carefully to read) and the optional AI helpers — all in plain words,
 * without device details or benchmarks.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ArchiveRestore,
  Download,
  HardDrive,
  Monitor,
  Moon,
  Palette,
  Rows3,
  Rows4,
  ShieldCheck,
  Sun,
  Trash,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { AiSettingsCard } from "@/features/settings/ai-settings-card";
import { OcrSettingsCard } from "@/features/settings/ocr-settings-card";
import { SectionCard } from "@/features/settings/section-card";
import { PageFrame } from "@/components/layout/page-frame";
import { getStorageStatus, isStorageLow, requestPersistentStorage, type StorageStatus } from "@/core/storage/storage-health";
import { deleteAllWorkspaceData, exportWorkspaceBackup } from "@/features/backup/backup-actions";
import { useDatasets } from "@/features/processing/hooks/use-datasets";
import { useRestoreBackup } from "@/features/backup/use-restore-backup";
import { formatBytes } from "@/features/workspace/query";
import { useAppearanceStore, type Density, type Theme } from "@/stores/appearance-store";
import { toast } from "@/stores/toast-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { cn } from "@/lib/utils";

const button =
  "press inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold ring-1 ring-salin-border hover:bg-salin-tile disabled:opacity-50";

function StorageCard() {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [requesting, setRequesting] = useState(false);
  // Re-estimate whenever the workspace changes.
  const items = useWorkspaceStore((s) => s.items);

  const refresh = useCallback(() => getStorageStatus().then(setStatus, () => undefined), []);
  useEffect(() => {
    void refresh();
  }, [refresh, items]);

  async function persist() {
    setRequesting(true);
    const granted = await requestPersistentStorage();
    setRequesting(false);
    toast(
      granted
        ? "Storage is now protected. The browser won't clear e-Vet's data to save space."
        : "The browser didn't allow protected storage yet. Installing e-Vet usually allows it — and keep regular backups.",
    );
    void refresh();
  }

  const pct = status?.supported && status.quota ? Math.min(100, (status.usage / status.quota) * 100) : 0;
  const low = status ? isStorageLow(status) : false;

  return (
    <section aria-labelledby="storage-heading" className="rounded-2xl bg-salin-tile p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-salin-surface text-salin-primary">
          <HardDrive className="size-5" />
        </span>
        <div>
          <h2 id="storage-heading" className="font-semibold">
            Storage on this device
          </h2>
          <p className="text-sm text-salin-muted" data-testid="storage-usage">
            {!status
              ? "Checking storage…"
              : status.supported
                ? `${formatBytes(status.usage)} used of ${formatBytes(status.quota)} available to e-Vet`
                : "This browser doesn't report storage usage."}
          </p>
        </div>
      </div>
      {status?.supported && (
        <div
          className="mt-4 h-2 overflow-hidden rounded-full bg-salin-surface"
          role="progressbar"
          aria-label="Storage used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <div className={cn("h-full rounded-full", low ? "bg-[#E5484D]" : "bg-salin-primary")} style={{ width: `${Math.max(pct, 1)}%` }} />
        </div>
      )}
      {low && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-sm font-medium text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" /> Storage is almost full. Back up your workspace, then empty Trash or delete files you no longer need.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-salin-border pt-4">
        <p className="max-w-md text-sm text-salin-muted">
          {status?.persisted
            ? "Protected storage is on: the browser won't clear e-Vet's data automatically."
            : "Browsers may clear site data when the device runs low on space. Protect it, and keep regular backups."}
        </p>
        {status?.persisted === false && (
          <button type="button" onClick={persist} disabled={requesting} className={cn(button, "bg-salin-surface")}>
            <ShieldCheck className="size-4 text-salin-primary" /> Protect my data
          </button>
        )}
      </div>
    </section>
  );
}

function BackupCard() {
  const restore = useRestoreBackup();
  const [busy, setBusy] = useState(false);

  return (
    <SectionCard icon={ArchiveRestore} title="Backup & restore" id="backup-heading">
      {restore.elements}
      <p className="text-sm text-salin-muted">
        A backup is one .zip file with every folder, original document and dataset. Restoring checks every file before replacing your workspace.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await exportWorkspaceBackup();
            setBusy(false);
          }}
          className={cn(button, "bg-salin-primary text-white ring-0 hover:bg-salin-primary-strong")}
        >
          <Download className="size-4" /> {busy ? "Preparing…" : "Back up workspace"}
        </button>
        <button type="button" onClick={restore.pick} className={button}>
          <ArchiveRestore className="size-4" /> Restore from backup…
        </button>
      </div>
    </SectionCard>
  );
}

/** A row of mutually exclusive choices, styled like the workspace tab switcher. */
function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; icon: LucideIcon }[]; onChange: (value: T) => void }) {
  return (
    <div>
      <p id={`${label}-label`} className="mb-2 text-sm font-medium text-salin-text">
        {label}
      </p>
      <div role="radiogroup" aria-labelledby={`${label}-label`} className="seg-track inline-flex flex-wrap gap-1 rounded-xl bg-salin-tile p-1">
        {options.map(({ value: option, label: text, icon: Icon }) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            onClick={() => onChange(option)}
            className={cn(
              "press inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium",
              value === option ? "bg-salin-surface text-salin-primary shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-salin-muted hover:text-salin-text",
            )}
          >
            <Icon className="size-4" /> {text}
          </button>
        ))}
      </div>
    </div>
  );
}

const THEMES: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Match device", icon: Monitor },
];

const DENSITIES: { value: Density; label: string; icon: LucideIcon }[] = [
  { value: "comfortable", label: "Comfortable", icon: Rows3 },
  { value: "compact", label: "Compact", icon: Rows4 },
];

function AppearanceCard() {
  const theme = useAppearanceStore((s) => s.theme);
  const density = useAppearanceStore((s) => s.density);
  const setTheme = useAppearanceStore((s) => s.setTheme);
  const setDensity = useAppearanceStore((s) => s.setDensity);

  return (
    <SectionCard icon={Palette} title="Appearance" id="appearance-heading">
      <p className="text-sm text-salin-muted">Saved in this browser only.</p>
      <div className="mt-4 flex flex-wrap gap-x-8 gap-y-4">
        <Segmented label="Theme" value={theme} options={THEMES} onChange={setTheme} />
        <Segmented label="Density" value={density} options={DENSITIES} onChange={setDensity} />
      </div>
    </SectionCard>
  );
}

function PrivacyCard() {
  const [confirming, setConfirming] = useState(false);
  const count = useWorkspaceStore((s) => s.items.length);
  const datasets = useDatasets();
  const datasetCount = datasets.status === "ready" ? datasets.datasets.length : 0;

  return (
    <SectionCard icon={ShieldCheck} title="Privacy" id="privacy-heading">
      <ul className="space-y-1.5 text-sm text-salin-muted">
        <li>Your documents, scans and photos are stored only in this browser on this device. They're never uploaded.</li>
        <li>e-Vet sends the City Veterinary Office only what you choose to send: program request lists, stub and program-day updates, and census records (the values, not the scans).</li>
        <li>Anyone using this browser profile can open them. On a shared device, delete your data when you're done.</li>
      </ul>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={count + datasetCount === 0}
        className={cn(button, "mt-4 text-destructive hover:bg-destructive/10")}
      >
        <Trash className="size-4" /> Delete all workspace data
      </button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete all workspace data?"
        description={`Every folder and file (${count} item${count === 1 ? "" : "s"}), including Trash, and every dataset (${datasetCount}) will be permanently removed from this device. Back up first if you might need them. This can't be undone.`}
        confirmLabel="Delete everything"
        destructive
        onConfirm={deleteAllWorkspaceData}
      />
    </SectionCard>
  );
}

export function SettingsPage() {
  return (
    <PageFrame title="Settings" description="Storage, reading scanned pages, backups, privacy and how e-Vet looks on this device.">
      <div className="space-y-5">
        <StorageCard />
        <OcrSettingsCard />
        <AiSettingsCard />
        <BackupCard />
        <PrivacyCard />
        <AppearanceCard />
      </div>
    </PageFrame>
  );
}
