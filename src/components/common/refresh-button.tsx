/**
 * Refresh Button
 * Loads the newest records from City Vet: sends anything waiting in the
 * outbox, then every list that follows the sync (program requests, stubs,
 * program day, the inbox) loads again. While the page is open, visible and
 * online it also refreshes on its own every minute, so records other
 * paravets add show up without a tap.
 */

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";

import { useOnline } from "@/hooks/use-online";
import { cn } from "@/lib/utils";
import { syncNow, useSyncStore } from "@/stores/sync-store";

const EVERY_MS = 60_000;

export function RefreshButton() {
  const online = useOnline();
  const syncing = useSyncStore((state) => state.syncing);
  useEffect(() => {
    if (!online) return;
    const timer = setInterval(() => {
      if (!document.hidden) void syncNow();
    }, EVERY_MS);
    return () => clearInterval(timer);
  }, [online]);
  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      disabled={!online || syncing}
      aria-label={syncing ? "Refreshing" : "Refresh"}
      title={online ? "Load the newest records" : "Connect to the internet to refresh"}
      className="press inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-salin-text ring-1 ring-salin-border hover:bg-salin-tile disabled:opacity-50"
    >
      <RefreshCw aria-hidden="true" className={cn("size-4", syncing && "animate-spin motion-reduce:animate-none")} /> <span className="max-[400px]:sr-only">Refresh</span>
    </button>
  );
}
