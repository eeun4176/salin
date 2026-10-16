import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { SpotlightGrid } from "@/components/brand/spotlight-grid";
import { cn } from "@/lib/utils";

interface PageFrameProps {
  title: string;
  description?: string;
  /** Extra content on the right of the title row (badges, actions). */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Shared frame for Scan, Import, AI Studio and Settings: a compact version of
 * the hero band with the same spotlight grid, then the white card overlay.
 */
export function PageFrame({ title, description, aside, children, className }: PageFrameProps) {
  return (
    <>
      <section className="relative isolate overflow-hidden bg-salin-canvas">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(1_168_90/0.16)_0%,rgb(1_168_90/0.06)_50%,transparent_92%)]"
        />
        <SpotlightGrid />
        <div className="relative mx-auto max-w-5xl px-4 pt-5 pb-16 sm:px-6 md:pt-7 md:pb-20">
          <AppHeader />
          <div className="mt-8 flex flex-wrap items-end justify-between gap-4 md:mt-10">
            <div>
              <Link
                to="/"
                className="mb-3 inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-salin-muted hover:text-salin-text"
              >
                <ArrowLeft className="size-4" />
                Workspace
              </Link>
              <h1 className="text-[clamp(1.75rem,5vw,2.4rem)] leading-tight font-bold tracking-[-0.03em] text-salin-text">{title}</h1>
              {description && <p className="mt-1.5 max-w-xl text-[15px] text-salin-muted">{description}</p>}
            </div>
            {aside}
          </div>
        </div>
      </section>

      <div className="pb-mobile-nav relative z-10 mx-auto -mt-10 max-w-5xl px-3 sm:px-6">
        <main
          id="main"
          className={cn(
            "rounded-[28px] bg-white p-4 shadow-[0_1px_2px_rgb(16_40_28/0.04),0_24px_48px_-28px_rgb(16_40_28/0.18)] ring-1 ring-salin-border/70 sm:p-6 md:p-7",
            className,
          )}
        >
          {children}
        </main>
      </div>
    </>
  );
}
