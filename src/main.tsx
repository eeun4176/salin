/**
 * App Entry Point
 * Boots Salin: loads fonts and global styles, starts live syncing of the
 * workspace from IndexedDB, registers the offline service worker, and
 * renders the router.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router/dom";

import { registerServiceWorker } from "@/app/pwa";
import { router } from "@/app/router";
import { startWorkspaceSync } from "@/stores/workspace-store";

import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";

import "./index.css";

startWorkspaceSync();
registerServiceWorker();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
