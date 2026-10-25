/**
 * Segmented Thumbs
 * Makes every segmented switcher (an element with the `seg-track` class)
 * glide: the raised pill behind the chosen tab or option slides to the new
 * one instead of blinking. It measures the chosen child (aria-selected,
 * aria-checked or aria-current) and hands its box to the track's ::before
 * through CSS variables (styles in index.css). Watches the page for changes,
 * so no component needs to call it.
 */

const CHOSEN = ':scope > [aria-selected="true"], :scope > [aria-checked="true"], :scope > [aria-current="page"]';

export function startSegmentedThumbs(root: HTMLElement = document.body) {
  let frame = 0;
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(sync);
  };
  const resized = new ResizeObserver(schedule);
  const watched = new WeakSet<Element>();

  function sync() {
    frame = 0;
    for (const track of root.querySelectorAll<HTMLElement>(".seg-track")) {
      if (!watched.has(track)) {
        watched.add(track);
        resized.observe(track);
      }
      const chosen = track.querySelector<HTMLElement>(CHOSEN);
      if (!chosen || !chosen.offsetWidth) {
        track.removeAttribute("data-thumb");
        continue;
      }
      const place = `${chosen.offsetLeft}|${chosen.offsetTop}|${chosen.offsetWidth}|${chosen.offsetHeight}`;
      if (track.dataset.place === place) continue;
      track.dataset.place = place;
      track.style.setProperty("--thumb-x", `${chosen.offsetLeft}px`);
      track.style.setProperty("--thumb-y", `${chosen.offsetTop}px`);
      track.style.setProperty("--thumb-w", `${chosen.offsetWidth}px`);
      track.style.setProperty("--thumb-h", `${chosen.offsetHeight}px`);
      track.style.setProperty("--thumb-r", getComputedStyle(chosen).borderRadius);
      // The first placement jumps into place; later ones slide.
      if (!track.hasAttribute("data-thumb")) {
        track.setAttribute("data-thumb", "");
        requestAnimationFrame(() => track.setAttribute("data-thumb", "on"));
      }
    }
  }

  const observer = new MutationObserver(schedule);
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-selected", "aria-checked", "aria-current", "class"] });
  window.addEventListener("resize", schedule);
  void document.fonts?.ready.then(schedule);
  schedule();
  return () => {
    observer.disconnect();
    resized.disconnect();
    window.removeEventListener("resize", schedule);
    cancelAnimationFrame(frame);
  };
}
