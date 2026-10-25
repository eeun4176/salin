/**
 * Loading Skeleton
 * Pulsing placeholder cards shown while a page or list loads, so the layout
 * doesn't jump when the content arrives. The label is what screen readers
 * hear ("Loading census records").
 */

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function LoadingSkeleton({ label, rows = 3, className }: { label: string; rows?: number; className?: string }) {
  return (
    <div role="status" aria-label={label} className={cn("space-y-3 py-2", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl p-4 ring-1 ring-salin-border" style={{ opacity: 1 - i * 0.22 }}>
          <Skeleton className="size-10 shrink-0 rounded-xl bg-salin-tile motion-reduce:animate-none" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5 bg-salin-tile motion-reduce:animate-none" />
            <Skeleton className="h-3 w-3/4 bg-salin-tile motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  );
}
