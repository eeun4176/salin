import { useEffect } from "react";
import Lenis from "lenis";

import { setLenis } from "@/lib/lenis";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * Boots Lenis on the window. Wheel/trackpad input gets smoothed; touch keeps
 * the platform's native momentum (Lenis' default), which feels right on phones.
 * Under prefers-reduced-motion Lenis is not created at all.
 */
export function useSmoothScroll() {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;

    const lenis = new Lenis({
      autoRaf: true,
      lerp: 0.1,
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1,
      anchors: true,
      // Let menus, dialogs and other scrollable overlays scroll natively.
      prevent: (node) =>
        node.closest("[data-radix-popper-content-wrapper], [role='dialog'], [data-lenis-prevent]") !== null,
    });
    setLenis(lenis);

    return () => {
      setLenis(null);
      lenis.destroy();
    };
  }, [reduced]);
}
