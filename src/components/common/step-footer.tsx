/**
 * Step Footer
 * The bar at the bottom of each step in a guided flow (Extract from Excel,
 * Read text): a short status or validation message and the Back / Next
 * buttons, kept in view while scrolling (above the phone's bottom bar).
 * Also the shared button styles for those flows.
 */

import type { ReactNode } from "react";

export const primaryButton =
  "press inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-salin-primary px-5 text-sm font-semibold text-white hover:bg-salin-primary-strong disabled:opacity-50";
export const secondaryButton = "press inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-salin-text ring-1 ring-salin-border hover:bg-salin-tile";

export function StepFooter({ children, message }: { children: ReactNode; message?: ReactNode }) {
  return (
    <div className="sticky bottom-[calc(var(--mobile-nav-h)+env(safe-area-inset-bottom)+12px)] z-10 mt-6 rounded-2xl bg-salin-surface p-3 shadow-[0_-8px_24px_-16px_rgb(16_40_28/0.25)] ring-1 ring-salin-border md:bottom-4">
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
        {message && <div className="min-w-0 flex-1 basis-56 px-1 text-sm">{message}</div>}
        <div className="flex gap-2">{children}</div>
      </div>
    </div>
  );
}
