/**
 * File Thumbnail
 * The preview area of a file card, showing the file's actual content: the
 * photo or PDF page as an image, a mini table for CSV files and the main
 * table of an Excel workbook (with its title), or the first lines of a text
 * file. It starts loading when the card scrolls into view; until then (or if
 * no preview can be made) the drawn placeholder shows.
 */

import { useEffect, useRef, useState } from "react";

import { DocThumbnail } from "@/components/brand/doc-thumbnail";
import { cachedThumbnail, loadThumbnail, type ThumbnailView } from "@/features/workspace/thumbnails";
import { cn } from "@/lib/utils";
import type { WorkspaceFile } from "@/types/domain";

export function FileThumbnail({ file, className }: { file: WorkspaceFile; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<{ blobId: string; view: ThumbnailView } | null>(null);
  const view = cachedThumbnail(file.blobId) ?? (loaded?.blobId === file.blobId ? loaded.view : null);

  useEffect(() => {
    const element = ref.current;
    if (!element || cachedThumbnail(file.blobId)) return;
    let active = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        loadThumbnail(file)
          .then((next) => active && setLoaded({ blobId: file.blobId, view: next }))
          .catch(() => active && setLoaded({ blobId: file.blobId, view: { kind: "none" } }));
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [file]);

  return (
    <div ref={ref} data-thumbnail={view?.kind ?? "loading"} data-thumbnail-for={file.name} className={cn("h-full overflow-hidden rounded-lg", className)}>
      {!view || view.kind === "none" ? (
        <DocThumbnail kind={file.kind} className="h-full p-1.5" />
      ) : view.kind === "image" ? (
        <img
          src={view.url}
          alt=""
          draggable={false}
          className={cn("size-full", file.kind === "pdf" ? "bg-white object-cover object-top" : "object-cover")}
        />
      ) : view.kind === "table" ? (
        <div className="h-full bg-white p-1.5">
          {view.title && <p className="mb-1 truncate px-0.5 text-[9px] font-bold text-[#1D1F1E]">{view.title}</p>}
          <table className="w-full table-fixed border-collapse text-[8px] leading-tight text-[#3B403D]">
            <tbody>
              {view.rows.map((row, r) => (
                <tr key={r} className={r === 0 ? "bg-[#E3F3EA] font-semibold text-[#0B5A33]" : r % 2 === 0 ? "bg-[#F7F9F8]" : undefined}>
                  {row.map((cell, c) => (
                    <td key={c} className="truncate border border-[#D7DED9] px-1 py-[2px]">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="h-full bg-white p-2 font-mono text-[8px] leading-snug break-words whitespace-pre-wrap text-[#3B403D]">{view.text}</p>
      )}
    </div>
  );
}
