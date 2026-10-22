/**
 * Home Layout
 * The workspace frame. On phones: the hero banner on top and the rounded
 * white workspace card below it. From 760px wide: the dashboard's list pane
 * (search, then the open tab or folder) beside the detail pane, which shows
 * the selected file — or, on Datasets, the selected dataset. Dragging the
 * divider between them (or arrow keys on it) sets the list from 260 to 480px.
 */

import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { Outlet, useLocation } from "react-router";

import { Hero } from "@/features/home/hero";
import { DatasetDetail } from "@/features/processing/components/dataset-detail";
import { FileDetail } from "@/features/workspace/components/file-detail";
import { WorkspaceToolbar } from "@/features/workspace/components/workspace-toolbar";
import { DATASETS_LINK } from "@/features/workspace/section-links";
import { useDesktopLayout } from "@/hooks/use-desktop-layout";

const LIST_MIN = 260;
const LIST_MAX = 480;
const clampList = (px: number) => Math.round(Math.min(LIST_MAX, Math.max(LIST_MIN, px)));

/** The cursor-resizable line between the list and detail panes; a separator with arrow-key steps for keyboards. */
function PaneDivider({ width, onResize }: { width: number; onResize: (px: number) => void }) {
  const [drag, setDrag] = useState<{ x: number; from: number } | null>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowLeft: -16, ArrowRight: 16, Home: -Infinity, End: Infinity }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    onResize(clampList(width + step));
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the list"
      aria-valuemin={LIST_MIN}
      aria-valuemax={LIST_MAX}
      aria-valuenow={width}
      tabIndex={0}
      data-dragging={drag ? "" : undefined}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrag({ x: event.clientX, from: width });
      }}
      onPointerMove={(event: PointerEvent<HTMLDivElement>) => drag && onResize(clampList(drag.from + event.clientX - drag.x))}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      className="group/divider sticky top-0 z-10 h-dvh w-1.5 cursor-col-resize touch-none bg-salin-surface outline-none"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-salin-border transition-[background-color,box-shadow,width] duration-200 group-hover/divider:w-0.5 group-hover/divider:bg-salin-primary group-hover/divider:shadow-[0_0_10px_2px_rgb(1_168_90/0.45)] group-focus-visible/divider:w-0.5 group-focus-visible/divider:bg-salin-primary group-data-dragging/divider:w-0.5 group-data-dragging/divider:bg-salin-primary group-data-dragging/divider:shadow-[0_0_10px_2px_rgb(1_168_90/0.45)]"
      />
    </div>
  );
}

/**
 * The tab content (Workspace, Recents, Favorites, Trash, Datasets) renders
 * in the outlet, so the hero (phones) or the panes (desktop) don't restart
 * when switching tabs. `@container`: the list adapts to its pane's width,
 * not the screen's.
 */
export function HomeLayout() {
  const desktop = useDesktopLayout();
  const onDatasets = useLocation().pathname === DATASETS_LINK.to;
  const [listWidth, setListWidth] = useState(340);

  if (desktop) {
    return (
      <div className="grid min-h-dvh" style={{ gridTemplateColumns: `${listWidth}px 6px minmax(0,1fr)` }}>
        <main id="main" className="@container sticky top-0 h-dvh overflow-y-auto bg-salin-surface px-4 pt-4 pb-8" data-lenis-prevent="">
          <WorkspaceToolbar />
          <Outlet />
        </main>
        <PaneDivider width={listWidth} onResize={setListWidth} />
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
