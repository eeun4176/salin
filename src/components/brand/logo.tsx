/**
 * e-Vet Logo
 * The City Veterinary Office seal beside the app's name, e-Vet, with its
 * "Field" tag and, below it, the city ("City of San Jose del Monte"); the
 * two lines are as tall as the seal. Links back to the home screen. Where
 * space is tight the city line can be hidden.
 */

import { Link } from "react-router";

import sealUrl from "@/assets/brand/cityvet-logo.png";
import { cn } from "@/lib/utils";

export const APP_NAME = "e-Vet";
export const APP_EDITION = "Field";
export const APP_SUBTITLE = "City of San Jose del Monte";

export function Logo({ className, subtitleClassName }: { className?: string; subtitleClassName?: string }) {
  return (
    <Link to="/" aria-label={`${APP_NAME} home`} className={cn("inline-flex max-w-full min-w-0 items-center gap-2.5 rounded-md", className)}>
      <img src={sealUrl} alt="" className="size-9 shrink-0" />
      <span aria-hidden="true" className="flex h-9 min-w-0 flex-col justify-center">
        <span className="flex items-center gap-1.5 text-[18px] leading-5 font-extrabold whitespace-nowrap tracking-[-0.02em] text-salin-text">
          {APP_NAME}
          <span className="rounded-md bg-salin-primary-soft px-1.5 text-[10px] leading-4 font-bold tracking-wide text-salin-primary-ink uppercase">{APP_EDITION}</span>
        </span>
        <span className={cn("block truncate text-[10.5px] leading-[14px] font-medium text-salin-muted", subtitleClassName)}>{APP_SUBTITLE}</span>
      </span>
    </Link>
  );
}
