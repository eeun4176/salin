/**
 * e-Vet Logo
 * The City Veterinary Office seal with the app's name, e-Vet, and its
 * subtitle ("Field | City of San Jose del Monte"); links back to the home
 * screen. Where space is tight the subtitle can be hidden or shown on its
 * own line.
 */

import { Link } from "react-router";

import sealUrl from "@/assets/brand/cityvet-logo.png";
import { cn } from "@/lib/utils";

export const APP_NAME = "e-Vet";
export const APP_SUBTITLE = "Field | City of San Jose del Monte";

export function Logo({ className, subtitleClassName }: { className?: string; subtitleClassName?: string }) {
  return (
    <Link to="/" aria-label={`${APP_NAME} home`} className={cn("inline-flex max-w-full min-w-0 items-center gap-2.5 rounded-md", className)}>
      <img src={sealUrl} alt="" className="size-9 shrink-0" />
      <span aria-hidden="true" className="min-w-0 leading-tight">
        <span className="block text-[19px] font-extrabold tracking-[-0.02em] text-salin-text">{APP_NAME}</span>
        <span className={cn("block truncate text-[11px] font-medium text-salin-muted", subtitleClassName)}>{APP_SUBTITLE}</span>
      </span>
    </Link>
  );
}
