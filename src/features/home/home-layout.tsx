/**
 * Home Layout
 * The home screen frame: the hero banner on top and the rounded white
 * workspace card below it. The active tab or folder renders inside the card,
 * and the file preview opens on top of it.
 */

import { Outlet } from "react-router";

import { Hero } from "@/features/home/hero";
import { FilePreview } from "@/features/workspace/components/file-preview";
import { WorkspaceToolbar } from "@/features/workspace/components/workspace-toolbar";

/**
 * Hero + the rounded white workspace card. The tab content (Workspace,
 * Recents, Favorites, Trash) renders in the outlet, so the hero and its
 * typewriter don't restart when switching tabs.
 */
export function HomeLayout() {
  return (
    <>
      <Hero />
      <div className="pb-mobile-nav relative z-10 mx-auto -mt-8 max-w-5xl px-3 sm:px-6 md:-mt-10">
        <main
          id="main"
          className="min-h-[24rem] rounded-[28px] bg-white p-4 shadow-[0_1px_2px_rgb(16_40_28/0.04),0_24px_48px_-28px_rgb(16_40_28/0.18)] ring-1 ring-salin-border/70 sm:p-6 md:p-7"
        >
          <WorkspaceToolbar />
          <Outlet />
        </main>
      </div>
      <FilePreview />
    </>
  );
}
