/**
 * New Document Menu
 * The sidebar's create button. Opening it morphs the green "+ New Document"
 * button into a white panel headed "Create New" (the + turns into ×), and
 * Scan (documents and stub QR codes), Import Files and New Dataset fan out beneath it. A
 * drop-shadow filter on the wrapper follows the clip-path as it grows. In the
 * folded rail the panel also widens out of the 40px button. Escape, a click
 * outside or picking an option closes it and focus returns to the button;
 * ↑/↓ move between options, and S, I or D (with or without Ctrl/⌘) pick one.
 */

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { Camera, FileUp, Plus, Table2, type LucideIcon } from "lucide-react";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
const TRIGGER_H = 44;
const MORPH_MS = 587;
const ITEM_MS = 594;
const STAGGER_MS = 50;
const MORPH_EASE =
  "linear(0, 0.094 5.6%, 0.274 11.1%, 0.455 16.7%, 0.608 22.2%, 0.726 27.8%, 0.812 33.3%, 0.873 38.9%, 0.916 44.4%, 0.944 50%, 0.964 55.6%, 0.976 61.1%, 0.985 66.7%, 0.99 72.2%, 1 100%)";
// Critically damped spring, 1 − (1 + ωt)·e^(−ωt) with ωT = 8: no overshoot.
const SETTLE_EASE = "linear(0, 0.191 10%, 0.475 20%, 0.692 30%, 0.829 40%, 0.908 50%, 0.952 60%, 0.976 70%, 0.988 80%, 0.994 90%, 1)";

interface Option {
  label: string;
  icon: LucideIcon;
  key: "s" | "i" | "d";
  to: string;
  state?: unknown;
}

const OPTIONS: Option[] = [
  { label: "Scan", icon: Camera, key: "s", to: "/scan" },
  { label: "Import files", icon: FileUp, key: "i", to: "/import" },
  { label: "New dataset", icon: Table2, key: "d", to: "/datasets", state: { newDataset: true } },
];

export function NewDocumentMenu({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  function close(refocus = true) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  function pick(option: Option) {
    close();
    navigate(option.to, option.state ? { state: option.state } : undefined);
  }

  // Outside clicks close it without stealing focus from what was clicked.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = itemRefs.current.filter((el): el is HTMLButtonElement => el !== null);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const move = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[event.key];
    if (move !== undefined) {
      event.preventDefault();
      items[(move + items.length) % items.length]?.focus();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    const option = OPTIONS.find((o) => o.key === event.key.toLowerCase());
    if (option && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      pick(option);
    }
  }

  const time = (ms: number) => (reduced ? 0 : ms);
  const panelStyle: CSSProperties = {
    // Closed: just the button (in the rail, also just its 40px width). Open: the whole panel.
    clipPath: open ? "inset(0 0 0 0 round 14px)" : `inset(0 ${collapsed ? "calc(100% - 40px)" : "0"} calc(100% - ${TRIGGER_H}px) 0 round 14px)`,
    transition: `clip-path ${time(MORPH_MS)}ms ${MORPH_EASE}`,
  };

  return (
    <div ref={wrapperRef} className="relative z-30 h-11 shrink-0">
      {/* The filtered box covers the whole panel: only the button takes clicks while it's closed. */}
      <div className={cn("absolute top-0 left-0 [filter:drop-shadow(0_10px_15px_rgba(0,0,0,0.08))]", !open && "pointer-events-none")} style={{ width: collapsed ? 240 : "100%" }}>
        <div className="rounded-[14px] border border-salin-border bg-popover" style={panelStyle}>
          <button
            ref={triggerRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={menuId}
            aria-label="New document"
            title="New document"
            onClick={() => (open ? close() : setOpen(true))}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && !open) {
                event.preventDefault();
                setOpen(true);
              }
            }}
            className={cn(
              "group pointer-events-auto relative -m-px flex h-11 items-center gap-2 rounded-[14px] px-[12px] text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset",
              open ? "text-salin-text focus-visible:ring-salin-primary/50" : "text-white focus-visible:ring-white/80",
              // Closed in the rail, only 40px of the button shows; keep its hit area to that.
              collapsed && !open ? "w-[42px]" : "w-[calc(100%+2px)]",
            )}
            style={{ transition: `color ${time(MORPH_MS)}ms ${MORPH_EASE}` }}
          >
            {/* The green fades out so the button becomes the panel's white header. */}
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-[14px] bg-[linear-gradient(135deg,#01A85A,#018A4A)] shadow-[0_6px_16px_-8px_rgb(1_168_90/0.7)] group-hover:brightness-95"
              style={{ opacity: open ? 0 : 1, transition: `opacity ${time(MORPH_MS)}ms ${MORPH_EASE}` }}
            />
            <Plus
              aria-hidden="true"
              className="relative size-[18px] shrink-0"
              strokeWidth={2.2}
              style={{ transform: `rotate(${open ? 135 : 0}deg)`, transition: `transform ${time(ITEM_MS)}ms var(--ease-spring)` }}
            />
            <span aria-hidden="true" className="relative grid flex-1 text-left whitespace-nowrap" style={{ opacity: collapsed && !open ? 0 : 1 }}>
              <span className="col-start-1 row-start-1" style={{ opacity: open ? 0 : 1, transition: `opacity ${time(300)}ms ease` }}>
                New document
              </span>
              <span className="col-start-1 row-start-1" style={{ opacity: open ? 1 : 0, transition: `opacity ${time(300)}ms ease` }}>
                Create New
              </span>
            </span>
          </button>

          <div id={menuId} role="menu" aria-label="Create new" aria-hidden={!open} onKeyDown={onMenuKeyDown} className="px-1.5 pt-1 pb-1.5">
            {OPTIONS.map((option, index) => {
              const Icon = option.icon;
              const delay = time((open ? index : OPTIONS.length - 1 - index) * STAGGER_MS);
              return (
                <button
                  key={option.key}
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  aria-keyshortcuts={option.key.toUpperCase()}
                  onClick={() => pick(option)}
                  className="flex h-10 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-sm font-medium text-salin-text outline-none hover:bg-salin-tile focus-visible:bg-salin-tile"
                  style={{
                    transform: open ? "translateY(0) scale(1)" : `translateY(calc(${index} * -2.3em - 0.3em)) scale(0.94)`,
                    opacity: open ? 1 : 0,
                    visibility: open ? "visible" : "hidden",
                    transition: `transform ${time(ITEM_MS)}ms ${SETTLE_EASE} ${delay}ms, opacity ${time(ITEM_MS)}ms ${SETTLE_EASE} ${delay}ms, visibility 0ms linear ${open ? 0 : time(ITEM_MS) + delay}ms`,
                  }}
                >
                  <Icon aria-hidden="true" className="size-[18px] shrink-0 text-salin-primary" strokeWidth={1.9} />
                  <span className="flex-1 whitespace-nowrap">{option.label}</span>
                  <kbd className="rounded-md bg-salin-tile px-1.5 py-0.5 font-sans text-[11px] text-salin-subtle">
                    {IS_MAC ? `⌘${option.key.toUpperCase()}` : `Ctrl ${option.key.toUpperCase()}`}
                  </kbd>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
