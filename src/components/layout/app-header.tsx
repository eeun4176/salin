/**
 * App Header
 * The phone top bar, matching the desktop sidebar's footer: the Salin AI
 * wordmark, changes waiting to go to City Vet (sync-status.tsx), how much
 * Salin stores on this device ("12.4 MB Local", links to Settings; on the
 * narrowest phones it gives way while changes are waiting) and the account
 * menu (Census, Programs, AI Studio, Settings, install, sign out).
 */

import { Logo } from "@/components/brand/logo";
import { AccountMenu, StorageBadge } from "@/components/layout/sidebar";
import { SyncStatus } from "@/components/layout/sync-status";
import { cn } from "@/lib/utils";

/** Logo + storage + account row at the top of phone screens. */
export function AppHeader({ className }: { className?: string }) {
  return (
    <header className={cn("relative z-10 flex items-center justify-between gap-3", className)}>
      <span className="inline-flex items-center gap-1.5">
        <Logo className="text-[24px]" />
        <span aria-hidden="true" className="rounded-md bg-salin-primary-soft px-1.5 py-0.5 text-[11px] leading-none font-bold tracking-wide text-salin-primary-ink">
          AI
        </span>
      </span>
      <div className="group/bar flex min-w-0 items-center gap-2">
        <SyncStatus className="h-8 max-w-40 rounded-full bg-salin-surface" />
        <StorageBadge className="h-8 rounded-full bg-salin-surface max-[400px]:group-has-[[data-sync-status]]/bar:hidden" />
        <AccountMenu compact />
      </div>
    </header>
  );
}
