import { Folder, Heart } from "lucide-react";

import { DocThumbnail } from "@/components/brand/doc-thumbnail";
import { FILE_KIND_META } from "@/components/brand/file-kinds";
import { FileTypeIcon } from "@/components/brand/file-type-icon";
import { ItemActions } from "@/features/workspace/components/item-actions";
import { formatBytes, formatDate, sectionTime } from "@/features/workspace/query";
import type { WorkspaceItem, WorkspaceSection } from "@/features/workspace/types";
import { toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils";

// Names wrap to two lines on phones instead of truncating after a few letters.
const nameClass = "line-clamp-2 text-[13px] leading-snug font-medium break-words text-salin-text sm:line-clamp-none sm:truncate sm:text-sm";

const tileBase =
  "group relative rounded-2xl bg-salin-tile transition-[background-color,box-shadow] duration-200 hover:bg-salin-tile-hover has-[[data-open-target]:focus-visible]:ring-2 has-[[data-open-target]:focus-visible]:ring-salin-primary";

function openItem(item: WorkspaceItem) {
  if (item.deletedAt !== null) {
    toast("Restore this item to open it.");
    return;
  }
  toast(item.kind === "folder" ? "Opening folders arrives with nested folders in Phase 2." : "File previews arrive with local storage in Phase 2.");
}

/**
 * Stretched invisible button that opens the item; sits under the overflow
 * menu so both stay independently focusable.
 */
function OpenTarget({ item }: { item: WorkspaceItem }) {
  return (
    <button
      type="button"
      data-open-target=""
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
    <div className={cn(tileBase, "flex min-h-14 items-center gap-2.5 py-2 pr-1 pl-3 sm:gap-3 sm:pr-1.5 sm:pl-4")}>
      <OpenTarget item={item} />
      <Folder aria-hidden="true" className="pointer-events-none relative size-5 shrink-0 text-salin-text sm:size-[22px]" strokeWidth={1.8} />
      <span className={cn("pointer-events-none relative min-w-0 flex-1", nameClass)} title={item.name}>
        {item.name}
      </span>
      <FavoriteMark item={item} />
      <ItemActions item={item} className="relative" />
    </div>
  );
}

/** Thumbnail card for files (and for folders when mixed with files). */
export function FileCard({ item }: { item: WorkspaceItem }) {
  const isFolder = item.kind === "folder";
  return (
    <div className={cn(tileBase, "flex flex-col p-2")}>
      <OpenTarget item={item} />
      <div className="pointer-events-none relative aspect-[5/4] overflow-hidden rounded-xl bg-white">
        {isFolder ? (
          <div className="grid h-full place-items-center bg-white">
            <Folder aria-hidden="true" className="size-12 text-salin-subtle" strokeWidth={1.4} />
          </div>
        ) : (
          <DocThumbnail kind={item.fileType} className="h-full p-1.5 transition-transform duration-300 ease-out-soft group-hover:scale-[1.02]" />
        )}
      </div>
      <div className="pointer-events-none relative flex items-center gap-1.5 pt-2.5 pb-0.5 pl-1 sm:gap-2 sm:pl-1.5">
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
  return (
    <div role="row" className="group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-salin-tile has-[[data-open-target]:focus-visible]:ring-2 has-[[data-open-target]:focus-visible]:ring-salin-primary sm:grid-cols-[minmax(0,1fr)_9rem_6rem_auto]">
      <OpenTarget item={item} />
      <div role="cell" className="pointer-events-none relative flex min-w-0 items-center gap-3">
        {item.kind === "folder" ? (
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-salin-tile group-hover:bg-white">
            <Folder className="size-[18px]" strokeWidth={1.9} />
          </span>
        ) : (
          <FileTypeIcon kind={item.fileType ?? "pdf"} showLabel={false} className="size-9" />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-salin-text">{item.name}</p>
          <p className="truncate text-xs text-salin-muted sm:hidden">
            {typeName} · {formatDate(time)}
          </p>
        </div>
        <FavoriteMark item={item} />
      </div>
      <div role="cell" className="pointer-events-none relative hidden text-[13px] text-salin-muted sm:block">
        {formatDate(time)}
      </div>
      <div role="cell" className="pointer-events-none relative hidden text-[13px] text-salin-muted sm:block">
        {item.size ? formatBytes(item.size) : "—"}
      </div>
      <div role="cell" className="relative">
        <ItemActions item={item} />
      </div>
    </div>
  );
}
