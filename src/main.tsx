/**
 * App Entry Point
 * Boots Salin: loads fonts and global styles, applies the saved appearance
 * (theme, density), starts the sliding pill of segmented switchers, starts sending queued City Vet changes, reads the signed-in session, starts live syncing of the workspace from IndexedDB,
 * marks processing jobs a closed tab left running as interrupted, drops
 * thumbnails of deleted files, registers the offline service worker, and
 * renders the router.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router/dom";

import { registerServiceWorker } from "@/app/pwa";
import { router } from "@/app/router";
import { failInterruptedJobs } from "@/core/storage/repositories/processing.repository";
import { pruneThumbnails } from "@/core/storage/repositories/thumbnail.repository";
import { startSegmentedThumbs } from "@/lib/segmented-thumbs";
import { startAppearance } from "@/stores/appearance-store";
import { startAuth } from "@/stores/auth-store";
import { startSync } from "@/stores/sync-store";
import { startWorkspaceSync } from "@/stores/workspace-store";

import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";

import "./index.css";

startAppearance();
startSegmentedThumbs();
startSync();
startAuth();
startWorkspaceSync();
failInterruptedJobs().catch((error: unknown) => console.error(error));
pruneThumbnails().catch((error: unknown) => console.error(error));
registerServiceWorker();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
