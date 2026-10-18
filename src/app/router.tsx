/**
 * App Router
 * Maps every URL to a screen. The four workspace tabs (and open folders at
 * /folders/:folderId) share HomeLayout so the hero stays mounted while
 * switching between them; other screens render inside AppShell directly.
 */

import { createBrowserRouter, Navigate } from "react-router";

import { AppShell } from "@/components/layout/app-shell";
import { AiStudioPage } from "@/features/ai-studio/ai-studio-page";
import { ScanPage } from "@/features/capture/scan-page";
import { HomeLayout } from "@/features/home/home-layout";
import { ImportPage } from "@/features/import/import-page";
import { SettingsPage } from "@/features/settings/settings-page";
import { SectionView } from "@/features/workspace/section-view";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: AppShell,
    children: [
      {
        // Hero + workspace card stay mounted while switching tabs.
        Component: HomeLayout,
        children: [
          { index: true, element: <SectionView section="workspace" /> },
          { path: "folders/:folderId", element: <SectionView section="workspace" /> },
          { path: "recents", element: <SectionView section="recents" /> },
          { path: "favorites", element: <SectionView section="favorites" /> },
          { path: "trash", element: <SectionView section="trash" /> },
        ],
      },
      { path: "workspace", element: <Navigate to="/" replace /> },
      { path: "scan", Component: ScanPage },
      { path: "import", Component: ImportPage },
      { path: "ai-studio", Component: AiStudioPage },
      { path: "settings", Component: SettingsPage },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
