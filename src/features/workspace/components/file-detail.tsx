/**
 * File Detail Pane
 * The dashboard's right pane on screens 760px and wider: the file picked in
 * the list (the `?preview=` URL parameter) with a toolbar (Favorite, Share,
 * more actions), its type and folder tags, name and details, the Extract
 * data / Read text / Download actions and the preview itself. It slides in
 * on each new selection. With nothing picked it offers Scan and Import.
 */

import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Camera, Folder, Heart, Share2, Upload, X } from "lucide-react";

import { FILE_KIND_META } from "@/components/brand/file-kinds";
import { FileTypeIcon } from "@/components/brand/file-type-icon";
import { getFileWithBlob } from "@/core/storage/repositories/file-repository";
import { ItemActions } from "@/features/workspace/components/item-actions";
import { FileActions, PreviewBody } from "@/features/workspace/components/file-preview";
import { fileToItem } from "@/features/workspace/mappers";
import { formatBytes, formatDate } from "@/features/workspace/query";
import { PREVIEW_PARAM, useClosePreview } from "@/features/workspace/use-open-item";
import { toggleFavorite } from "@/features/workspace/workspace-actions";
import { cn } from "@/lib/utils";
import { toast } from "@/stores/toast-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { WorkspaceFile } from "@/types/domain";

const toolButton = "press grid size-9 shrink-0 place-items-center rounded-lg text-salin-muted hover:bg-salin-tile hover:text-salin-text";

// Sharing hands the file to the device's own share sheet; nothing is uploaded by Salin.
const canShareFiles = typeof navigator !== "undefined" && typeof navigator.canShare === "function";

async function shareFile(file: WorkspaceFile) {
  try {
    const { blob } = await getFileWithBlob(file.id);
    const shared = new File([blob], file.name, { type: blob.type || file.mimeType });
    if (!navigator.canShare({ files: [shared] })) {
      toast("This device can't share this kind of file. Use Download instead.");
      return;
    }
    await navigator.share({ files: [shared], title: file.name });
  } catch (error) {
    if ((error as Error).name !== "AbortError") toast("The file couldn't be shared.");
  }
}

function EmptyDetail() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-salin-primary-soft text-salin-primary">
        <Folder className="size-6" />
      </span>
      <p className="mt-4 font-semibold text-salin-text">Select a document</p>
      <p className="mt-1 max-w-xs text-sm text-salin-muted">Pick a file from the list to preview it here, or add a new one.</p>
      <div className="mt-5 flex gap-2">
        <Link to="/scan" className="press inline-flex h-10 items-center gap-2 rounded-xl bg-salin-primary px-4 text-sm font-semibold text-white hover:bg-salin-primary-strong">
          <Camera className="size-4" /> Scan
        </Link>
        <Link to="/import" className="press inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-salin-text ring-1 ring-salin-border hover:bg-salin-tile">
          <Upload className="size-4" /> Import
        </Link>
      </div>
    </div>
  );
}

function FileDetailView({ file }: { file: WorkspaceFile }) {
  const closePreview = useClosePreview();
  const folderName = useWorkspaceStore((s) => (file.folderId ? s.folderById.get(file.folderId)?.name : undefined));
  const [sharing, setSharing] = useState(false);
  const item = fileToItem(file);
  const live = file.deletedAt === null;

  return (
    <div className="flex h-full flex-col motion-safe:animate-detail-in">
      <div className="flex h-[60px] shrink-0 items-center gap-1 border-b border-salin-border px-3">
        <button type="button" aria-label="Close preview" onClick={closePreview} className={toolButton}>
          <X className="size-5" />
        </button>
        <span className="flex-1" />
        {live && (
          <button
            type="button"
            aria-pressed={file.isFavorite}
            aria-label={file.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
            onClick={() => void toggleFavorite(item)}
            className={toolButton}
          >
            <Heart className={cn("size-[18px]", file.isFavorite && "fill-salin-primary text-salin-primary")} />
          </button>
        )}
        {live && canShareFiles && (
          <button
            type="button"
            aria-label="Share"
            disabled={sharing}
            onClick={() => {
              setSharing(true);
              void shareFile(file).finally(() => setSharing(false));
            }}
            className={toolButton}
          >
            <Share2 className="size-[18px]" />
          </button>
        )}
        <ItemActions item={item} className="size-9 text-salin-muted" />
      </div>

      <div className="shrink-0 px-6 pt-5 pb-4">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
          <span className="inline-flex items-center gap-1 rounded-full bg-salin-tile px-2 py-0.5 text-salin-muted">{FILE_KIND_META[file.kind].name}</span>
          {folderName && (
            <span className="inline-flex items-center gap-1 rounded-full bg-salin-tile px-2 py-0.5 text-salin-muted">
              <Folder className="size-3" /> {folderName}
            </span>
          )}
          {file.isFavorite && live && <span className="rounded-full bg-salin-primary-soft px-2 py-0.5 text-salin-primary-ink">Favorite</span>}
          {!live && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-destructive">In Trash</span>}
        </div>
        <div className="mt-2.5 flex items-start gap-3">
          <FileTypeIcon kind={file.kind} showLabel={false} className="size-10" />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold tracking-[-0.01em] break-words text-salin-text">{file.name}</h2>
            <p className="mt-0.5 text-xs text-salin-muted">
              {formatBytes(file.size)} · Modified {formatDate(file.updatedAt)} · Added {formatDate(file.createdAt)}
            </p>
          </div>
        </div>
        {live && (
          <div className="mt-4 flex flex-wrap gap-2">
            <FileActions file={file} />
          </div>
        )}
      </div>

      <div className="mx-6 mb-6 min-h-0 flex-1 overflow-hidden rounded-2xl ring-1 ring-salin-border">
        <PreviewBody file={file} />
      </div>
    </div>
  );
}

/** The right-hand pane: the selected file (keyed so each new pick slides in), or an empty state. */
export function FileDetail() {
  const [params] = useSearchParams();
  const previewId = params.get(PREVIEW_PARAM);
  const file = useWorkspaceStore((s) => (previewId ? s.files.find((f) => f.id === previewId) : undefined));

  return (
    <section aria-label="Document details" className="sticky top-0 h-dvh min-w-0 bg-salin-surface">
      {file ? (
        <FileDetailView key={file.id} file={file} />
      ) : previewId ? (
        <PreviewBody file={undefined} />
      ) : (
        <EmptyDetail />
      )}
    </section>
  );
}
