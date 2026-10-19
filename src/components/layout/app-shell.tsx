/**
 * App Shell
 * The frame around every screen: skip-to-content link, smooth scrolling,
 * scroll reset between pages, the file preview (so any screen can open a
 * document), the mobile bottom bar and the toast area.
 */

import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router";

import { Toaster } from "@/components/common/toaster";
import { MobileNav } from "@/components/layout/mobile-nav";
import { FilePreview } from "@/features/workspace/components/file-preview";
import { isWorkspaceRoute } from "@/features/workspace/section-links";
import { useSmoothScroll } from "@/hooks/use-smooth-scroll";
import { scrollToY } from "@/lib/lenis";

/** Jump to the top between pages, but keep position when switching workspace tabs or folders. */
function useScrollReset() {
  const { pathname } = useLocation();
  const previous = useRef(pathname);

  useEffect(() => {
    const from = previous.current;
    previous.current = pathname;
    if (from === pathname) return;
    if (isWorkspaceRoute(from) && isWorkspaceRoute(pathname)) return;
    scrollToY(0, { immediate: true });
  }, [pathname]);
}

export function AppShell() {
  useSmoothScroll();
  useScrollReset();

  return (
    <div className="min-h-dvh bg-salin-canvas">
      <a
        href="#main"
        className="sr-only z-[100] rounded-lg bg-salin-surface px-3 py-2 text-sm font-semibold text-salin-primary shadow focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Outlet />
      <FilePreview />
      <MobileNav />
      <Toaster />
    </div>
  );
}
