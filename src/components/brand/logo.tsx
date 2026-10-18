/**
 * Salin Logo
 * The "≡Salin" wordmark that links back to the home screen.
 */

import { Link } from "react-router";

import { cn } from "@/lib/utils";

/** "≡Salin" wordmark: speed lines feeding into the green S. */
export function Logo({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      aria-label="Salin home"
      className={cn("inline-flex items-center rounded-md text-[26px] leading-none font-extrabold tracking-[-0.04em] text-salin-text", className)}
    >
      <span aria-hidden="true" className="mr-[3px] flex flex-col items-end gap-[3.5px] pt-[2px]">
        <span className="h-[3px] w-[15px] rounded-full bg-salin-text" />
        <span className="h-[3px] w-[10px] rounded-full bg-salin-text" />
        <span className="h-[3px] w-[15px] rounded-full bg-salin-text" />
      </span>
      <span aria-hidden="true" className="text-salin-primary">S</span>
      <span aria-hidden="true">alin</span>
    </Link>
  );
}
