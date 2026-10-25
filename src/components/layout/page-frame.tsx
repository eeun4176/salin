/**
 * Page Frame
 * Shared layout for Scan, Import, Census, Programs, City Vet, Settings and
 * dataset review, matching the workspace: on phones the top bar and the
 * rounded white card below it; from 760px a full-height white pane beside
 * the sidebar, with the back link and title at the top and no card.
 */

import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { cn } from "@/lib/utils";

interface PageFrameProps {
  title: string;
  description?: string;
  /** Extra content on the right of the title row (badges, actions). */
  aside?: ReactNode;
  /** Where the back link goes (default: the workspace). */
  back?: { to: string; label: string };
  children: ReactNode;
  className?: string;
}

export function PageFrame({ title, description, aside, back = { to: "/", label: "Workspace" }, children, className }: PageFrameProps) {
  return (
    <div className="pb-mobile-nav mx-auto max-w-5xl px-3 pt-[calc(12px+env(safe-area-inset-top))] sm:px-6 nav:min-h-dvh nav:max-w-none nav:bg-salin-surface nav:px-8 nav:pt-6">
      <AppHeader className="mb-3 px-1 nav:hidden" />
      <main
        id="main"
        className={cn(
          "rounded-[28px] bg-salin-surface p-4 shadow-[0_1px_2px_rgb(16_40_28/0.04),0_24px_48px_-28px_rgb(16_40_28/0.18)] ring-1 ring-salin-border/70 sm:p-6 nav:rounded-none nav:p-0 nav:shadow-none nav:ring-0",
          className,
        )}
      >
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-salin-border pb-5">
          <div className="min-w-0">
            <Link to={back.to} className="mb-1 -ml-2 inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-salin-muted hover:text-salin-text">
              <ArrowLeft className="size-4" />
              {back.label}
            </Link>
            <h1 className="text-[clamp(1.5rem,4vw,2rem)] leading-tight font-bold tracking-[-0.03em] text-salin-text">{title}</h1>
            {description && <p className="mt-1 max-w-2xl text-[15px] text-salin-muted">{description}</p>}
          </div>
          {aside}
        </header>
        {children}
      </main>
    </div>
  );
}
