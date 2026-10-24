/**
 * Mobile Navigation
 * The phone-only floating bottom bar, in two pieces 10px above the screen
 * edge: a white pill with the four workspace tabs (Workspace · Recents ·
 * Favorites · Trash) and a glass lens that swells as it slides to the active
 * tab, and a separate green + circle beside it that fans out the Scan,
 * Import and AI Studio quick actions over a white scrim.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Camera, Plus, Sparkles, Upload, type LucideIcon } from "lucide-react";

import { SECTION_LINKS, isSectionActive } from "@/features/workspace/section-links";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { lockScroll } from "@/lib/lenis";
import { cn } from "@/lib/utils";

const SPRING = "var(--ease-spring)";
const SPRING_MS = 594;
const FADE_MS = 180;
const STAGGER_MS = 40;
const FAB = 56;
const ACTION = 58;
/** The lens swells while it travels, then settles back with a short spring. */
const SWELL_MS = 200;
const SETTLE_MS = 170;
const SETTLE_EASE = "linear(0, 0.457 16.7%, 0.876 33.3%, 1.008 50%, 1.02 61.1%, 1)";

// Offsets from the compose circle's centre: a quarter arc (radius 126px, 30° apart) up and to the left,
// clear of the tabs pill, since the circle sits at the right edge.
const ACTIONS: { label: string; to: string; icon: LucideIcon; x: number; y: number }[] = [
  { label: "Scan", to: "/scan", icon: Camera, x: -109, y: -63 },
  { label: "Import", to: "/import", icon: Upload, x: -63, y: -109 },
  { label: "AI Studio", to: "/ai-studio", icon: Sparkles, x: 0, y: -126 },
];

function TabLink({ to, label, icon: Icon, active }: (typeof SECTION_LINKS)[number] & { active: boolean }) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative z-10 flex flex-col items-center justify-center gap-0.5 rounded-full text-[10.5px] font-medium transition-colors duration-200",
        active ? "text-salin-primary" : "text-salin-muted active:text-salin-text",
      )}
    >
      <Icon aria-hidden="true" className="size-5" strokeWidth={active ? 2.2 : 1.8} />
      <span>{label}</span>
    </Link>
  );
}

/** The glass lens behind the active tab; hidden on pages that aren't a tab (Scan, Settings…). */
function TabLens({ index }: { index: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(index);
  const [swelling, setSwelling] = useState(false);
  // Start the swell during render when the tab changes (no flash of the settled lens at the new spot).
  if (shown !== index) {
    setShown(index);
    if (!reduced && shown >= 0 && index >= 0) setSwelling(true);
  }
  useEffect(() => {
    if (!swelling) return;
    const timer = window.setTimeout(() => setSwelling(false), SWELL_MS);
    return () => window.clearTimeout(timer);
  }, [swelling, index]);

  const style: CSSProperties = {
    transform: `translateX(${Math.max(index, 0) * 100}%) scale(${swelling ? "1.16, 1.1" : "1"})`,
    transition: reduced ? "opacity 150ms ease" : swelling ? `transform ${SWELL_MS}ms var(--ease-out-soft), opacity 150ms ease` : `transform ${SETTLE_MS}ms ${SETTLE_EASE}, opacity 150ms ease`,
    opacity: index < 0 ? 0 : 1,
  };
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-1/4 p-0.5" style={style}>
      <span className="block size-full rounded-full bg-salin-primary/10 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.9),0_4px_12px_-4px_rgb(16_40_28/0.22)] backdrop-blur-sm dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12),0_4px_12px_-4px_rgb(0_0_0/0.5)]" />
    </span>
  );
}

/**
 * Phone bottom bar: the tabs pill, then the compose circle, which turns into
 * an X and fans Scan / Import out above itself.
 */
export function MobileNav() {
  const { pathname } = useLocation();
  // Remember which page the menu was opened on, so leaving that page any other way
  // (e.g. the Android back button) closes it and releases the scroll lock.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (next: boolean) => setOpenOn(next ? pathname : null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const activeIndex = SECTION_LINKS.findIndex((link) => isSectionActive(link.to, pathname));

  useEffect(() => {
    if (!open) return;
    lockScroll(true);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenOn(null);
      toggleRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      lockScroll(false);
    };
  }, [open]);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  return (
    <div className="nav:hidden">
      {/* 72% white scrim under the menu; tapping it closes the actions */}
      <div
        aria-hidden="true"
        onClick={() => setOpen(false)}
        className={cn(
          "fixed inset-0 z-[60] bg-salin-surface/72 backdrop-blur-[1.5px] transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      {/* Under dialogs (z-50) normally; above the toasts while the quick actions are open. */}
      <div className={cn("pointer-events-none fixed inset-x-2.5 bottom-[calc(10px+env(safe-area-inset-bottom))] flex items-end justify-between", open ? "z-[95]" : "z-40")}>
        <nav
          aria-label="Primary"
          className="pointer-events-auto h-14 w-[calc(100%-66px)] rounded-full bg-salin-bar p-1 shadow-[inset_0_0_0_1px_var(--color-salin-border),0_10px_28px_-12px_rgb(16_40_28/0.28)]"
        >
          <div className="relative grid h-full grid-cols-4">
            <TabLens index={activeIndex} />
            {SECTION_LINKS.map((link, i) => (
              <TabLink key={link.to} {...link} active={i === activeIndex} />
            ))}
          </div>
        </nav>

        <div className="pointer-events-auto relative" style={{ width: FAB, height: FAB }}>
          <div id="quick-actions" role="group" aria-label="Quick actions" aria-hidden={!open}>
            {ACTIONS.map((action, i) => {
              const delay = (open ? i : ACTIONS.length - 1 - i) * STAGGER_MS;
              const offset = `translate(${action.x}px, ${action.y}px)`;
              // Reduced motion: actions live at their final position and only fade.
              const transform = reduced ? offset : open ? `${offset} scale(1)` : "translate(0px, 0px) scale(0.5)";
              const style: CSSProperties = {
                width: ACTION,
                height: ACTION,
                top: FAB / 2 - ACTION / 2,
                left: FAB / 2 - ACTION / 2,
                transform,
                opacity: open ? 1 : 0,
                transition: reduced
                  ? `opacity ${FADE_MS}ms ease ${delay}ms`
                  : `transform ${SPRING_MS}ms ${SPRING} ${delay}ms, opacity ${FADE_MS}ms ease ${delay}ms`,
              };
              const Icon = action.icon;
              return (
                <button
                  key={action.to}
                  type="button"
                  tabIndex={open ? 0 : -1}
                  onClick={() => go(action.to)}
                  style={style}
                  className={cn(
                    "absolute flex flex-col items-center justify-center gap-0.5 rounded-full bg-salin-surface text-salin-primary",
                    "shadow-[0_10px_24px_-8px_rgb(16_40_28/0.3),0_0_0_1px_var(--color-salin-border)] active:bg-salin-primary-soft",
                    !open && "pointer-events-none",
                  )}
                >
                  <Icon className="size-5" strokeWidth={2.1} />
                  <span className="text-[10.5px] leading-none font-semibold text-salin-text">{action.label}</span>
                </button>
              );
            })}
          </div>

          <button
            ref={toggleRef}
            type="button"
            aria-expanded={open}
            aria-controls="quick-actions"
            aria-label={open ? "Close quick actions" : "Open quick actions"}
            onClick={() => setOpen(!open)}
            className={cn(
              "relative grid size-full place-items-center rounded-full bg-salin-primary text-white shadow-[0_10px_22px_-8px_rgb(1_168_90/0.6)]",
              "transition-transform duration-[520ms] ease-spring active:scale-90 active:duration-[90ms] active:ease-out motion-reduce:transition-none",
            )}
          >
            <Plus
              aria-hidden="true"
              className="size-7"
              strokeWidth={2.4}
              style={{ transform: open ? "rotate(45deg)" : "rotate(0deg)", transition: reduced ? "none" : `transform ${SPRING_MS}ms ${SPRING}` }}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
