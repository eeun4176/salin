/**
 * Home Layout
 * The workspace frame. On phones: the hero banner on top and the rounded
 * white workspace card below it. From 760px wide: the dashboard's list pane
 * (search, then the open tab or folder) beside the detail pane, which shows
 * the selected file — or, on Datasets, the selected dataset.
 */

import { Outlet, useLocation } from "react-router";

import { Hero } from "@/features/home/hero";
import { DatasetDetail } from "@/features/processing/components/dataset-detail";
import { FileDetail } from "@/features/workspace/components/file-detail";
import { WorkspaceToolbar } from "@/features/workspace/components/workspace-toolbar";
import { DATASETS_LINK } from "@/features/workspace/section-links";
import { useDesktopLayout } from "@/hooks/use-desktop-layout";

/**
 * The tab content (Workspace, Recents, Favorites, Trash, Datasets) renders
 * in the outlet, so the hero (phones) or the panes (desktop) don't restart
 * when switching tabs. `@container`: the list adapts to its pane's width,
 * not the screen's.
 */
export function HomeLayout() {
  const desktop = useDesktopLayout();
  const onDatasets = useLocation().pathname === DATASETS_LINK.to;

  if (desktop) {
    return (
      <div className="grid min-h-dvh grid-cols-[340px_minmax(0,1fr)]">
        <main id="main" className="@container sticky top-0 h-dvh overflow-y-auto border-r border-salin-border bg-salin-surface px-4 pt-4 pb-8" data-lenis-prevent="">
          <WorkspaceToolbar />
          <Outlet />
        </main>
        {onDatasets ? <DatasetDetail /> : <FileDetail />}
      </div>
    );
  }

  return (
    <>
      <Hero />
      <div className="pb-mobile-nav relative z-10 mx-auto -mt-8 max-w-5xl px-3 sm:px-6">
        <main
          id="main"
          className="@container min-h-[24rem] rounded-[28px] bg-salin-surface p-4 shadow-[0_1px_2px_rgb(16_40_28/0.04),0_24px_48px_-28px_rgb(16_40_28/0.18)] ring-1 ring-salin-border/70 sm:p-6"
        >
          <WorkspaceToolbar />
          <Outlet />
        </main>
      </div>
    </>
  );
}
