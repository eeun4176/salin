/**
 * Sync Status
 * The dot-and-words badge beside the storage badge (phone top bar, sidebar)
 * for changes waiting to go to the City Veterinary Office: "3 waiting to
 * send", "Sending…", "Offline · 3 waiting", or "1 needs attention". Hidden
 * when nothing is waiting. Its menu lists the changes, sends now, and lets the
 * user retry or discard one the server refused.
 */

import { liveQuery } from "dexie";
import { useEffect, useState } from "react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { discardItem, listOutbox, retryItem } from "@/core/sync/outbox";
import { useOnline } from "@/hooks/use-online";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { syncNow, useSyncStore } from "@/stores/sync-store";
import type { OutboxItem } from "@/types/sync";

export function SyncStatus({ className }: { className?: string }) {
  const account = useAuthStore((state) => state.session?.key);
  const syncing = useSyncStore((state) => state.syncing);
  const online = useOnline();
  const [items, setItems] = useState<OutboxItem[]>([]);

  useEffect(() => {
    const subscription = liveQuery(listOutbox).subscribe({
      next: (all) => setItems(all.filter((item) => item.account === account)),
      error: (failure: unknown) => console.error(failure),
    });
    return () => subscription.unsubscribe();
  }, [account]);

  if (!items.length) return null;
  const attention = items.filter((item) => item.status === "attention");
  const waiting = items.length - attention.length;
  const [dot, label] = attention.length
    ? ["bg-amber-500", `${attention.length} need${attention.length === 1 ? "s" : ""} attention`]
    : syncing
      ? ["bg-salin-primary motion-safe:animate-pulse", "Sending…"]
      : !online
        ? ["bg-salin-subtle", `Offline · ${waiting} waiting`]
        : ["bg-salin-primary", `${waiting} waiting to send`];

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger data-sync-status="" className={cn("flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-medium text-salin-text ring-1 ring-salin-border outline-none hover:bg-salin-tile focus-visible:ring-2 focus-visible:ring-salin-primary", className)}>
        <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", dot)} />
        <span className="truncate">{label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 rounded-xl p-1.5">
        <DropdownMenuLabel>Changes for City Vet</DropdownMenuLabel>
        <ul className="max-h-64 space-y-1 overflow-y-auto px-1.5 pb-1 text-xs">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg bg-salin-tile px-2.5 py-2">
              <p className="font-medium text-salin-text">{item.label}</p>
              <p className={item.status === "attention" ? "text-amber-800 dark:text-amber-300" : "text-salin-muted"}>{item.status === "attention" ? (item.lastError?.message ?? "The server refused this change.") : "Waiting to send"}</p>
            </li>
          ))}
        </ul>
        {attention.map((item) => [
          <DropdownMenuItem key={`${item.id}-retry`} className="py-2" onSelect={() => void retryItem(item.id).then(syncNow)}>
            Try again: {item.label}
          </DropdownMenuItem>,
          <DropdownMenuItem key={`${item.id}-discard`} className="py-2 text-destructive" onSelect={() => void discardItem(item.id)}>
            Discard: {item.label}
          </DropdownMenuItem>,
        ])}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="py-2" disabled={!online || syncing} onSelect={() => void syncNow()}>
          {online ? "Send now" : "Sends when you're back online"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
