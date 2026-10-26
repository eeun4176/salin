/**
 * More Details
 * A page's explanation kept out of the layout: an (i) beside the title shows
 * it on hover (mouse) or tap, and hides on Escape or when focus leaves. The
 * panel opens under the nearest positioned ancestor, so put this inside the
 * title block of a `relative` header.
 */

import { useState, type ReactNode } from "react";
import { Info } from "lucide-react";

export function MoreDetails({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const hover = (value: boolean) => (event: { pointerType: string }) => event.pointerType === "mouse" && setOpen(value);
  return (
    <span className="ml-1.5 inline-flex align-middle" onPointerEnter={hover(true)} onPointerLeave={hover(false)}>
      <button
        type="button"
        aria-label="More details"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
        className="grid size-7 place-items-center rounded-full text-salin-muted hover:bg-salin-tile hover:text-salin-text focus-visible:ring-2 focus-visible:ring-salin-primary focus-visible:outline-none"
      >
        <Info aria-hidden="true" className="size-4" />
      </button>
      {open && (
        <span role="tooltip" className="absolute top-full left-0 z-30 mt-1 w-[min(26rem,calc(100vw-3rem))] rounded-xl bg-salin-text px-3 py-2 text-[13px] leading-relaxed font-normal tracking-normal text-salin-surface shadow-lg">
          {children}
        </span>
      )}
    </span>
  );
}
