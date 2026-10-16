import { useEffect, useState } from "react";
import { Cpu, DatabaseBackup, HardDrive, Palette, ShieldCheck, type LucideIcon } from "lucide-react";

import { PageFrame } from "@/components/layout/page-frame";
import { formatBytes } from "@/features/workspace/query";

const SECTIONS: { icon: LucideIcon; title: string; body: string; phase: string }[] = [
  { icon: Palette, title: "Appearance", body: "Theme and density preferences.", phase: "Phase 2" },
  { icon: ShieldCheck, title: "Privacy", body: "Clear the workspace and review what's stored on this device.", phase: "Phase 2" },
  { icon: DatabaseBackup, title: "Backup & restore", body: "Export your workspace to a file and bring it back later.", phase: "Phase 2" },
  { icon: Cpu, title: "Offline models", body: "Download and manage on-device OCR models.", phase: "Phase 4" },
];

function StorageCard() {
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    navigator.storage
      ?.estimate?.()
      .then(({ usage = 0, quota = 0 }) => setEstimate({ usage, quota }))
      .catch(() => undefined);
  }, []);

  const pct = estimate && estimate.quota ? Math.min(100, (estimate.usage / estimate.quota) * 100) : 0;

  return (
    <section aria-labelledby="storage-heading" className="rounded-2xl bg-salin-tile p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-white text-salin-primary">
          <HardDrive className="size-5" />
        </span>
        <div>
          <h2 id="storage-heading" className="font-semibold">Local storage</h2>
          <p className="text-sm text-salin-muted">
            {estimate ? `${formatBytes(estimate.usage)} used of ${formatBytes(estimate.quota)} available to Salin` : "Checking storage…"}
          </p>
        </div>
      </div>
      <div
        className="mt-4 h-2 overflow-hidden rounded-full bg-white"
        role="progressbar"
        aria-label="Storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div className="h-full rounded-full bg-salin-primary" style={{ width: `${Math.max(pct, estimate ? 1 : 0)}%` }} />
      </div>
      <p className="mt-3 text-xs text-salin-muted">Browsers can clear site data. Back up your workspace regularly once backups arrive.</p>
    </section>
  );
}

export function SettingsPage() {
  return (
    <PageFrame title="Settings" description="Preferences, privacy and storage for this device.">
      <StorageCard />
      <ul className="mt-5 divide-y divide-salin-border rounded-2xl ring-1 ring-salin-border">
        {SECTIONS.map(({ icon: Icon, title, body, phase }) => (
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
    </PageFrame>
  );
}
