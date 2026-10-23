/**
 * App Header
 * The phone top bar, matching the desktop sidebar's footer: the Salin AI
 * wordmark, how much Salin stores on this device ("12.4 MB Local", links to
 * Settings) and the account menu (Census, AI Studio, Settings, install,
 * sign out).
 */

import { Logo } from "@/components/brand/logo";
import { AccountMenu, StorageBadge } from "@/components/layout/sidebar";
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
      <div className="flex min-w-0 items-center gap-2">
        <StorageBadge className="h-8 rounded-full bg-salin-surface" />
        <AccountMenu compact />
      </div>
    </header>
  );
}
