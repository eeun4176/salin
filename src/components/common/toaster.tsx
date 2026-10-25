/**
 * Toaster
 * Renders the toast notifications from the toast store at the bottom of the
 * screen, above the mobile tab bar. A thin green line along the bottom of each
 * toast shrinks over the time it stays.
 */

import type { CSSProperties } from "react";
import { X } from "lucide-react";

import { useToastStore } from "@/stores/toast-store";

/** Bottom-centre toasts, lifted above the mobile tab bar. */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--mobile-nav-h)+env(safe-area-inset-bottom)+44px)] z-[90] flex flex-col items-center gap-2 px-4 md:bottom-6"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={t.duration ? ({ "--toast-ms": `${t.duration}ms` } as CSSProperties) : undefined}
          className="pointer-events-auto relative flex max-w-md items-center gap-3 overflow-hidden rounded-xl bg-salin-toast px-4 py-3 text-sm text-white shadow-lg ring-white/10 dark:ring-1 animate-in fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none"
        >
          <span className="min-w-0 flex-1">{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action?.onClick();
                dismiss(t.id);
              }}
              className="shrink-0 rounded-md px-1.5 py-0.5 font-semibold text-[#5BE3A0] hover:bg-white/10"
            >
              {t.action.label}
            </button>
          )}
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="shrink-0 rounded-md p-0.5 text-white/60 hover:text-white">
            <X className="size-4" />
          </button>
          {t.duration && <span aria-hidden="true" className="toast-timer absolute inset-x-0 bottom-0 h-[3px] bg-[#5BE3A0]" />}
        </div>
      ))}
    </div>
  );
}
