/**
 * Workspace Tab Links
 * The four workspace tabs (label, URL, icon) shared by the desktop tab
 * switcher and the mobile bottom bar, the extra Datasets tab (desktop tabs;
 * phones reach it from the workspace), and the rule for which tab is active
 * (Workspace stays active while a folder is open).
 */

import { BriefcaseBusiness, Heart, RotateCcwClock, Table2, Trash, type LucideIcon } from "lucide-react";

export const SECTION_LINKS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/", label: "Workspace", icon: BriefcaseBusiness },
  { to: "/recents", label: "Recents", icon: RotateCcwClock },
  { to: "/favorites", label: "Favorites", icon: Heart },
  { to: "/trash", label: "Trash", icon: Trash },
];

export const DATASETS_LINK = { to: "/datasets", label: "Datasets", icon: Table2 };

/** Tabs in the workspace card's toolbar (desktop): Datasets sits right after Workspace. */
export const TOOLBAR_LINKS = [SECTION_LINKS[0], DATASETS_LINK, ...SECTION_LINKS.slice(1)];

/** True when `pathname` belongs to the tab at `to` — Workspace also owns /folders/*. */
export function isSectionActive(to: string, pathname: string) {
  if (to === "/") return pathname === "/" || pathname.startsWith("/folders/");
  return pathname === to;
}

/** Workspace tab routes: switching between them keeps the scroll position. */
export function isWorkspaceRoute(pathname: string) {
  return TOOLBAR_LINKS.some((link) => isSectionActive(link.to, pathname));
}
