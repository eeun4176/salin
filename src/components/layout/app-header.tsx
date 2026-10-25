/**
 * App Header
 * The phone top bar, matching the desktop sidebar's footer: the e-Vet logo
 * (its subtitle hidden on narrow phones), changes waiting to go to City Vet
 * (sync-status.tsx), how much e-Vet stores on this device ("12.4 MB Local", links to Settings; on the
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
      {/* The logo keeps its size; the storage badge is what shortens when large text leaves no room. */}
      <Logo className="shrink-0" subtitleClassName="max-[520px]:hidden" />
      <div className="group/bar flex min-w-0 items-center gap-2">
        <SyncStatus className="h-8 max-w-40 rounded-full bg-salin-surface" />
        <StorageBadge className="h-8 min-w-0 rounded-full bg-salin-surface max-[400px]:group-has-[[data-sync-status]]/bar:hidden" />
        <AccountMenu compact />
      </div>
    </header>
  );
}
