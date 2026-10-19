/**
 * File Thumbnail
 * The preview area of a file card, showing the file's actual content: the
 * photo or PDF page as an image, a mini table for CSV files and the main
 * table of an Excel workbook (with its title), or the first lines of a text
 * file. A file that can't be previewed says why (damaged, password-protected,
 * empty, unsupported format) instead of showing a normal-looking drawing. It
 * starts loading when the card scrolls into view; until then (or if no
 * preview can be made) the drawn placeholder shows.
 */

import { useEffect, useRef, useState } from "react";
import { FileLock2, FileQuestion, FileWarning, FileX2, type LucideIcon } from "lucide-react";

import { DocThumbnail } from "@/components/brand/doc-thumbnail";
import { cachedThumbnail, loadThumbnail, type ThumbnailView } from "@/features/workspace/thumbnails";
import { cn } from "@/lib/utils";
import type { ThumbnailProblem, WorkspaceFile } from "@/types/domain";

const PROBLEMS: Record<ThumbnailProblem, { icon: LucideIcon; title: string; detail: string }> = {
  damaged: { icon: FileWarning, title: "Damaged file", detail: "It can't be opened" },
  locked: { icon: FileLock2, title: "Password-protected", detail: "Remove the password to preview" },
  empty: { icon: FileX2, title: "Empty file", detail: "It has no content" },
  unsupported: { icon: FileQuestion, title: "Can't preview", detail: "Unsupported format inside" },
};

function ProblemPreview({ problem, kind }: { problem: ThumbnailProblem; kind: WorkspaceFile["kind"] }) {
  const { icon: Icon, title, detail } = PROBLEMS[problem];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 bg-[#FBF7F2] px-2 text-center" title={`${title} — ${detail}`}>
      <span className="grid size-9 place-items-center rounded-xl bg-[#F6E7D6] text-[#9A5B12]">
        <Icon className="size-5" strokeWidth={1.8} />
      </span>
      <p className="text-[11px] leading-tight font-semibold text-[#5B3A10]">{title}</p>
      <p className="text-[9.5px] leading-tight text-[#8A6A45]">
        {detail} · {kind.toUpperCase()}
      </p>
    </div>
  );
}

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
    <div
      ref={ref}
      data-thumbnail={view?.kind ?? "loading"}
      data-thumbnail-problem={view?.kind === "problem" ? view.problem : undefined}
      data-thumbnail-for={file.name}
      className={cn("h-full overflow-hidden rounded-lg", className)}
    >
      {!view || view.kind === "none" ? (
        <DocThumbnail kind={file.kind} className="h-full p-1.5" />
      ) : view.kind === "problem" ? (
        <ProblemPreview problem={view.problem} kind={file.kind} />
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
