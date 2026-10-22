/**
 * Item Cards & Rows
 * How a folder or file looks in the workspace: compact folder pills, file
 * cards previewing the file's real content for grid view, and rows for list
 * view. Clicking anywhere
 * on one opens it; the ⋮ button opens its actions menu. On desktop the file
 * showing in the detail pane is highlighted.
 */

import { useSearchParams } from "react-router";
import { Folder, Heart } from "lucide-react";

import { DocThumbnail } from "@/components/brand/doc-thumbnail";
import { FILE_KIND_META } from "@/components/brand/file-kinds";
import { FileTypeIcon } from "@/components/brand/file-type-icon";
import { FileThumbnail } from "@/features/workspace/components/file-thumbnail";
import { ItemActions } from "@/features/workspace/components/item-actions";
import { formatBytes, formatDate, sectionTime } from "@/features/workspace/query";
import type { WorkspaceItem, WorkspaceSection } from "@/features/workspace/types";
import { PREVIEW_PARAM, useOpenItem } from "@/features/workspace/use-open-item";
import { useDesktopLayout } from "@/hooks/use-desktop-layout";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";

// Names wrap to two lines on phones instead of truncating after a few letters.
const nameClass = "line-clamp-2 text-[13px] leading-snug font-medium break-words text-salin-text @xl:line-clamp-none @xl:truncate @xl:text-sm";

const tileBase =
  "group relative rounded-2xl bg-salin-tile transition-[background-color,box-shadow] duration-300 ease-spring hover:bg-salin-tile-hover has-[[data-open-target]:focus-visible]:ring-2 has-[[data-open-target]:focus-visible]:ring-salin-primary";

const selectedClass = "bg-salin-primary/8 shadow-[inset_0_0_0_1px_var(--color-salin-primary)] hover:bg-salin-primary/10";

/** True for the file open in the desktop detail pane. */
function useSelected(item: WorkspaceItem) {
  const desktop = useDesktopLayout();
  const [params] = useSearchParams();
  return desktop && item.kind === "file" && params.get(PREVIEW_PARAM) === item.id;
}

/**
 * Stretched invisible button that opens the item; sits under the overflow
 * menu so both stay independently focusable.
 */
function OpenTarget({ item }: { item: WorkspaceItem }) {
  const openItem = useOpenItem();
  return (
    <button
      type="button"
      data-open-target=""
      data-item-name={item.name}
      onClick={() => openItem(item)}
      className="absolute inset-0 rounded-[inherit] outline-none"
      aria-label={`Open ${item.kind === "folder" ? "folder" : FILE_KIND_META[item.fileType ?? "pdf"].name} ${item.name}`}
    />
  );
}

function FavoriteMark({ item }: { item: WorkspaceItem }) {
  if (!item.isFavorite || item.deletedAt !== null) return null;
  return <Heart aria-label="Favorite" className="size-3.5 shrink-0 fill-salin-primary text-salin-primary" />;
}

/** Compact folder pill — used when folders sit on top of the files. */
export function FolderCard({ item }: { item: WorkspaceItem }) {
  return (
    <div className={cn(tileBase, "flex min-h-14 items-center gap-2.5 py-2 pr-1 pl-3 @xl:gap-3 @xl:pr-1.5 @xl:pl-4")}>
      <OpenTarget item={item} />
      <Folder aria-hidden="true" className="pointer-events-none relative size-5 shrink-0 text-salin-text @xl:size-[22px]" strokeWidth={1.8} />
      <span className={cn("pointer-events-none relative min-w-0 flex-1", nameClass)} title={item.name}>
        {item.name}
      </span>
      <FavoriteMark item={item} />
      <ItemActions item={item} className="relative" />
    </div>
  );
}

/** The file's real content as a preview (see file-thumbnail.tsx). */
function CardThumbnail({ item }: { item: WorkspaceItem }) {
  const file = useWorkspaceStore((s) => s.files.find((f) => f.id === item.id));
  const className = "transition-transform duration-300 ease-out-soft group-hover:scale-[1.02]";
  return file ? <FileThumbnail file={file} className={className} /> : <DocThumbnail kind={item.fileType} className={cn("h-full p-1.5", className)} />;
}

/** Thumbnail card for files (and for folders when mixed with files). */
export function FileCard({ item }: { item: WorkspaceItem }) {
  const isFolder = item.kind === "folder";
  const selected = useSelected(item);
  return (
    <div className={cn(tileBase, "flex flex-col p-2", selected && selectedClass)} data-selected={selected || undefined}>
      <OpenTarget item={item} />
      <div className="pointer-events-none relative aspect-[5/4] overflow-hidden rounded-xl bg-salin-surface">
        {isFolder ? (
          <div className="grid h-full place-items-center bg-salin-surface">
            <Folder aria-hidden="true" className="size-12 text-salin-subtle" strokeWidth={1.4} />
          </div>
        ) : (
          <CardThumbnail item={item} />
        )}
      </div>
      <div className="pointer-events-none relative flex items-center gap-1.5 pt-2.5 pb-0.5 pl-1 @xl:gap-2 @xl:pl-1.5">
        {isFolder ? (
          <Folder aria-hidden="true" className="pointer-events-none size-4 shrink-0" strokeWidth={2} />
        ) : (
          <FileTypeIcon kind={item.fileType ?? "pdf"} showLabel={false} className="pointer-events-none size-[18px]" />
        )}
        <span className={cn("pointer-events-none min-w-0 flex-1", nameClass)} title={item.name}>
          {item.name}
        </span>
        <FavoriteMark item={item} />
        <ItemActions item={item} />
      </div>
    </div>
  );
}

/** Row for list view. */
export function ItemRow({ item, section }: { item: WorkspaceItem; section: WorkspaceSection }) {
  const time = sectionTime(item, section);
  const typeName = item.kind === "folder" ? "Folder" : FILE_KIND_META[item.fileType ?? "pdf"].name;
  const selected = useSelected(item);
  return (
    <div role="row" data-selected={selected || undefined} className={cn("group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-salin-tile has-[[data-open-target]:focus-visible]:ring-2 has-[[data-open-target]:focus-visible]:ring-salin-primary @xl:grid-cols-[minmax(0,1fr)_9rem_6rem_auto]", selected && selectedClass)}>
      <OpenTarget item={item} />
      <div role="cell" className="pointer-events-none relative flex min-w-0 items-center gap-3">
        {item.kind === "folder" ? (
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-salin-tile group-hover:bg-salin-surface">
            <Folder className="size-[18px]" strokeWidth={1.9} />
          </span>
        ) : (
          <FileTypeIcon kind={item.fileType ?? "pdf"} showLabel={false} className="size-9" />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-salin-text">{item.name}</p>
          <p className="truncate text-xs text-salin-muted @xl:hidden">
            {typeName} · {formatDate(time)}
          </p>
        </div>
        <FavoriteMark item={item} />
      </div>
      <div role="cell" className="pointer-events-none relative hidden text-[13px] text-salin-muted @xl:block">
        {formatDate(time)}
      </div>
      <div role="cell" className="pointer-events-none relative hidden text-[13px] text-salin-muted @xl:block">
        {item.size ? formatBytes(item.size) : "—"}
      </div>
      <div role="cell" className="relative">
        <ItemActions item={item} />
      </div>
    </div>
  );
}
