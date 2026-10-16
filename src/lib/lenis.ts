import type Lenis from "lenis";

/**
 * Module-level handle to the app's single Lenis instance so any component can
 * scroll programmatically or pause smooth scrolling (e.g. while an overlay is
 * open). `null` when reduced motion is on and native scrolling is used.
 */
let instance: Lenis | null = null;
let locks = 0;

export function setLenis(lenis: Lenis | null) {
  instance = lenis;
  if (instance && locks > 0) instance.stop();
}

export function getLenis() {
  return instance;
}

export function scrollToY(target: number | HTMLElement, options: { immediate?: boolean; offset?: number } = {}) {
  const offset = options.offset ?? 0;
  if (instance) {
    instance.scrollTo(target, { immediate: options.immediate, offset, force: true });
    return;
  }
  const top = typeof target === "number" ? target : target.getBoundingClientRect().top + window.scrollY + offset;
  window.scrollTo({ top, behavior: options.immediate ? "instant" : "smooth" });
}

/** Pause/resume smooth scroll while modal UI is open. Calls are reference-counted. */
export function lockScroll(locked: boolean) {
  locks = Math.max(0, locks + (locked ? 1 : -1));
  if (!instance) return;
  if (locks > 0) instance.stop();
  else instance.start();
}
