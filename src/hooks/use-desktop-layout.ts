/**
 * Desktop Layout Hook
 * Live flag for the sidebar dashboard: true from 760px wide (Tailwind's
 * `nav:` breakpoint), where files open in the detail pane beside the list;
 * below it the phone layout opens them full screen.
 */

import { useSyncExternalStore } from "react";

const QUERY = "(min-width: 47.5rem)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export function useDesktopLayout() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
