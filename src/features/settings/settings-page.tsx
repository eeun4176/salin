/**
 * Settings Page (/settings)
 * Device storage (usage, quota, low-space warning, persistent storage
 * request), workspace backup & restore, privacy controls (delete all data
 * on this device), and placeholders for later-phase settings.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArchiveRestore, Cpu, Download, HardDrive, Palette, ShieldCheck, Trash, TriangleAlert, type LucideIcon } from "lucide-react";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { PageFrame } from "@/components/layout/page-frame";
import { getStorageStatus, isStorageLow, requestPersistentStorage, type StorageStatus } from "@/core/storage/storage-health";
import { deleteAllWorkspaceData, exportWorkspaceBackup } from "@/features/backup/backup-actions";
import { useRestoreBackup } from "@/features/backup/use-restore-backup";
import { formatBytes } from "@/features/workspace/query";
import { toast } from "@/stores/toast-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { cn } from "@/lib/utils";

const LATER: { icon: LucideIcon; title: string; body: string; phase: string }[] = [
  { icon: Palette, title: "Appearance", body: "Theme and density preferences.", phase: "Later" },
  { icon: Cpu, title: "Offline models", body: "Download and manage on-device OCR models.", phase: "Phase 4" },
];

const button =
  "press inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold ring-1 ring-salin-border hover:bg-salin-tile disabled:opacity-50";

function SectionCard({ icon: Icon, title, id, children }: { icon: LucideIcon; title: string; id: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-2xl p-5 ring-1 ring-salin-border">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-salin-tile text-salin-primary">
          <Icon className="size-5" />
        </span>
        <h2 id={id} className="font-semibold">
          {title}
        </h2>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

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
        ? "Storage is now protected. The browser won't clear Salin's data to save space."
        : "The browser didn't allow protected storage yet. Installing Salin usually allows it — and keep regular backups.",
    );
    void refresh();
  }

  const pct = status?.supported && status.quota ? Math.min(100, (status.usage / status.quota) * 100) : 0;
  const low = status ? isStorageLow(status) : false;

  return (
    <section aria-labelledby="storage-heading" className="rounded-2xl bg-salin-tile p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-white text-salin-primary">
          <HardDrive className="size-5" />
        </span>
        <div>
          <h2 id="storage-heading" className="font-semibold">
            Local storage
          </h2>
          <p className="text-sm text-salin-muted" data-testid="storage-usage">
            {!status
              ? "Checking storage…"
              : status.supported
                ? `${formatBytes(status.usage)} used of ${formatBytes(status.quota)} available to Salin`
                : "This browser doesn't report storage usage."}
          </p>
        </div>
      </div>
      {status?.supported && (
        <div
          className="mt-4 h-2 overflow-hidden rounded-full bg-white"
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
        <p role="alert" className="mt-3 flex items-start gap-2 text-sm font-medium text-[#B4232A]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" /> Storage is almost full. Back up your workspace, then empty Trash or delete files you no longer need.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-salin-border pt-4">
        <p className="max-w-md text-sm text-salin-muted">
          {status?.persisted
            ? "Protected storage is on: the browser won't clear Salin's data automatically."
            : "Browsers may clear site data when the device runs low on space. Protect it, and keep regular backups."}
        </p>
        {status?.persisted === false && (
          <button type="button" onClick={persist} disabled={requesting} className={cn(button, "bg-white")}>
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
        A backup is one .zip file with every folder and original document. Restoring checks every file before replacing your workspace.
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
          className={cn(button, "bg-salin-primary text-white ring-0 hover:bg-[#019A53]")}
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

function PrivacyCard() {
  const [confirming, setConfirming] = useState(false);
  const count = useWorkspaceStore((s) => s.items.length);

  return (
    <SectionCard icon={ShieldCheck} title="Privacy" id="privacy-heading">
      <ul className="space-y-1.5 text-sm text-salin-muted">
        <li>Your documents are stored only in this browser on this device. Nothing is uploaded.</li>
        <li>Anyone using this browser profile can open them. On a shared device, delete your data when you're done.</li>
      </ul>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={count === 0}
        className={cn(button, "mt-4 text-destructive hover:bg-destructive/10")}
      >
        <Trash className="size-4" /> Delete all workspace data
      </button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete all workspace data?"
        description={`Every folder and file (${count} item${count === 1 ? "" : "s"}), including Trash, will be permanently removed from this device. Back up first if you might need them. This can't be undone.`}
        confirmLabel="Delete everything"
        destructive
        onConfirm={deleteAllWorkspaceData}
      />
    </SectionCard>
  );
}

export function SettingsPage() {
  return (
    <PageFrame title="Settings" description="Storage, backups and privacy for this device.">
      <div className="space-y-5">
        <StorageCard />
        <BackupCard />
        <PrivacyCard />
        <ul className="divide-y divide-salin-border rounded-2xl ring-1 ring-salin-border">
          {LATER.map(({ icon: Icon, title, body, phase }) => (
            <li key={title} className="flex items-center gap-4 px-4 py-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-salin-tile text-salin-text">
                <Icon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{title}</p>
                <p className="text-sm text-salin-muted">{body}</p>
              </div>
              <span className="shrink-0 rounded-md bg-salin-tile px-2 py-1 text-[11px] font-semibold text-salin-muted">{phase}</span>
            </li>
          ))}
        </ul>
      </div>
    </PageFrame>
  );
}
