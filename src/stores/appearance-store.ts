/**
 * Appearance Store
 * The Settings → Appearance choices: theme (light, dark, or follow the
 * device) and density (comfortable or compact). Saved in this browser and
 * applied to <html> as the `dark` class and a `data-density` attribute.
 * index.html applies the saved choice before the first paint, so the page
 * never flashes the wrong theme.
 */

import { create } from "zustand";

export type Theme = "light" | "dark" | "system";
export type Density = "comfortable" | "compact";

interface Appearance {
  theme: Theme;
  density: Density;
}

interface AppearanceState extends Appearance {
  setTheme: (theme: Theme) => void;
  setDensity: (density: Density) => void;
}

/** Keep in sync with the inline script in index.html. */
export const APPEARANCE_KEY = "salin.appearance";
const DEFAULTS: Appearance = { theme: "light", density: "comfortable" };
const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

function read(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? "{}") as Partial<Appearance>;
    return {
      theme: saved.theme === "dark" || saved.theme === "system" ? saved.theme : DEFAULTS.theme,
      density: saved.density === "compact" ? "compact" : DEFAULTS.density,
    };
  } catch {
    return DEFAULTS;
  }
}

function save(appearance: Appearance) {
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
  } catch {
    // Private mode or storage blocked: the choice still applies for this visit.
  }
}

function apply({ theme, density }: Appearance) {
  const dark = theme === "dark" || (theme === "system" && darkQuery().matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  if (density === "compact") root.dataset.density = "compact";
  else delete root.dataset.density;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0E1311" : "#F8FAF9");
}

export const useAppearanceStore = create<AppearanceState>()((set, get) => ({
  ...read(),
  setTheme: (theme) => {
    set({ theme });
    const { density } = get();
    save({ theme, density });
    apply({ theme, density });
  },
  setDensity: (density) => {
    set({ density });
    const { theme } = get();
    save({ theme, density });
    apply({ theme, density });
  },
}));

/** Applies the saved appearance and follows the device theme while "system" is chosen. */
export function startAppearance() {
  const current = () => {
    const { theme, density } = useAppearanceStore.getState();
    return { theme, density };
  };
  apply(current());
  darkQuery().addEventListener("change", () => {
    if (useAppearanceStore.getState().theme === "system") apply(current());
  });
  // Another tab changed it.
  window.addEventListener("storage", (event) => {
    if (event.key !== APPEARANCE_KEY) return;
    useAppearanceStore.setState(read());
    apply(current());
  });
}
