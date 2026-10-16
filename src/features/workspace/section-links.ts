import { BriefcaseBusiness, Heart, RotateCcwClock, Trash, type LucideIcon } from "lucide-react";

/** Workspace tabs, shared by the desktop segmented switcher and the mobile tab bar. */
export const SECTION_LINKS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/", label: "Workspace", icon: BriefcaseBusiness },
  { to: "/recents", label: "Recents", icon: RotateCcwClock },
  { to: "/favorites", label: "Favorites", icon: Heart },
  { to: "/trash", label: "Trash", icon: Trash },
];
