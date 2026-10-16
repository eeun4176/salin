import { useEffect, useRef, useState, type CSSProperties } from "react";
import { NavLink, useNavigate } from "react-router";
import { Camera, Plus, Upload, type LucideIcon } from "lucide-react";

import { SECTION_LINKS } from "@/features/workspace/section-links";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { lockScroll } from "@/lib/lenis";
import { cn } from "@/lib/utils";

const SPRING = "var(--ease-spring)";
const SPRING_MS = 594;
const FADE_MS = 180;
const STAGGER_MS = 40;
const FAB = 60;
const ACTION = 58;

const ACTIONS: { label: string; to: string; icon: LucideIcon; x: number; y: number }[] = [
  { label: "Scan", to: "/scan", icon: Camera, x: -60, y: -76 },
  { label: "Import", to: "/import", icon: Upload, x: 60, y: -76 },
];

function TabLink({ to, label, icon: Icon }: (typeof SECTION_LINKS)[number]) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        cn(
          "flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
          isActive ? "text-salin-primary" : "text-salin-muted active:text-salin-text",
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className="size-[22px]" strokeWidth={isActive ? 2.2 : 1.8} />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

/**
 * Phone tab bar: Workspace · Recents · [raised +] · Favorites · Trash.
 * The centre toggle turns into an X and fans Scan / Import out on an arc.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    lockScroll(true);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
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

  const [left, right] = [SECTION_LINKS.slice(0, 2), SECTION_LINKS.slice(2)];

  return (
    <div className="md:hidden">
      {/* 72% white scrim under the menu; tapping it closes the actions */}
      <div
        aria-hidden="true"
        onClick={() => setOpen(false)}
        className={cn(
          "fixed inset-0 z-[60] bg-white/72 backdrop-blur-[1.5px] transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-salin-border bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-16px_rgb(16_40_28/0.18)]"
      >
        <div className="grid h-(--mobile-nav-h) grid-cols-5">
          {left.map((link) => (
            <TabLink key={link.to} {...link} />
          ))}
          <div aria-hidden="true" />
          {right.map((link) => (
            <TabLink key={link.to} {...link} />
          ))}
        </div>
      </nav>

      {/* Zero-size anchor at the top-centre edge of the bar; FAB + actions hang off it */}
      <div className="fixed bottom-[calc(var(--mobile-nav-h)+env(safe-area-inset-bottom))] left-1/2 z-[70] size-0">
        <div id="quick-actions" role="group" aria-label="Quick actions" aria-hidden={!open}>
          {ACTIONS.map((action, i) => {
            const delay = (open ? i : ACTIONS.length - 1 - i) * STAGGER_MS;
            const offset = `translate(${action.x}px, ${action.y}px)`;
            // Reduced motion: actions live at their arc position and only fade.
            const transform = reduced ? offset : open ? `${offset} scale(1)` : "translate(0px, 0px) scale(0.5)";
            const style: CSSProperties = {
              width: ACTION,
              height: ACTION,
              top: -24 + FAB / 2 - ACTION / 2,
              left: -ACTION / 2,
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
                  "absolute flex flex-col items-center justify-center gap-0.5 rounded-full bg-white text-salin-primary",
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
          onClick={() => setOpen((v) => !v)}
          style={{ width: FAB, height: FAB, top: -24, left: -FAB / 2 }}
          className={cn(
            "absolute grid place-items-center rounded-full text-white",
            "bg-[linear-gradient(150deg,#22C878_0%,#01A85A_52%,#018A4A_100%)]",
            "shadow-[0_0_0_7px_var(--color-salin-canvas),0_12px_22px_-6px_rgb(1_168_90/0.55)]",
            "transition-transform duration-150 active:scale-95 motion-reduce:transition-none",
          )}
        >
          <Plus
            aria-hidden="true"
            className="size-7"
            strokeWidth={2.4}
            style={{
              transform: open ? "rotate(45deg)" : "rotate(0deg)",
              transition: reduced ? "none" : `transform ${SPRING_MS}ms ${SPRING}`,
            }}
          />
        </button>
      </div>
    </div>
  );
}
