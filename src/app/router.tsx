/**
 * App Router
 * Maps every URL to a screen. The workspace tabs (Workspace — with open
 * folders at /folders/:folderId and Datasets at /datasets — Recents,
 * Favorites, Trash) share HomeLayout so the hero stays mounted while
 * switching between them; other screens, including the guided Excel
 * extraction at /files/:fileId/tables, reading text from scans (OCR) at
 * /scans/:documentId and dataset review at /datasets/:datasetId, render
 * inside AppShell directly.
 */

import { createBrowserRouter, Navigate } from "react-router";

import { AppShell } from "@/components/layout/app-shell";
import { AiStudioPage } from "@/features/ai-studio/ai-studio-page";
import { ScanPage } from "@/features/capture/scan-page";
import { ScanWorkflowPage } from "@/features/ocr/scan-workflow-page";
import { HomeLayout } from "@/features/home/home-layout";
import { ImportPage } from "@/features/import/import-page";
import { ChooseTablesPage } from "@/features/processing/choose-tables-page";
import { DatasetReviewPage } from "@/features/processing/dataset-review-page";
import { DatasetsView } from "@/features/processing/datasets-view";
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
          { path: "datasets", Component: DatasetsView },
        ],
      },
      { path: "workspace", element: <Navigate to="/" replace /> },
      { path: "scan", Component: ScanPage },
      { path: "import", Component: ImportPage },
      { path: "files/:fileId/tables", Component: ChooseTablesPage },
      { path: "scans/:documentId", Component: ScanWorkflowPage },
      { path: "datasets/:datasetId", Component: DatasetReviewPage },
      { path: "ai-studio", Component: AiStudioPage },
      { path: "settings", Component: SettingsPage },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
