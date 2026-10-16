import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router";

import { Toaster } from "@/components/common/toaster";
import { MobileNav } from "@/components/layout/mobile-nav";
import { useSmoothScroll } from "@/hooks/use-smooth-scroll";
import { scrollToY } from "@/lib/lenis";

const HOME_TABS = new Set(["/", "/recents", "/favorites", "/trash"]);

/** Jump to the top between pages, but keep position when switching workspace tabs. */
function useScrollReset() {
  const { pathname } = useLocation();
  const previous = useRef(pathname);

  useEffect(() => {
    const from = previous.current;
    previous.current = pathname;
    if (from === pathname) return;
    if (HOME_TABS.has(from) && HOME_TABS.has(pathname)) return;
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
        className="sr-only z-[100] rounded-lg bg-white px-3 py-2 text-sm font-semibold text-salin-primary shadow focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Outlet />
      <MobileNav />
      <Toaster />
    </div>
  );
}
