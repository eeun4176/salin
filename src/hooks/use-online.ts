/**
 * Online Hook
 * Live `navigator.onLine` flag, so screens can say when something needs the
 * internet (signing in, sending to the City Veterinary Office).
 */

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** False while the browser reports no network; true otherwise (including on the server render). */
export function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
