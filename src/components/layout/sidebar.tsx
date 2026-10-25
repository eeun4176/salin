/**
 * Sidebar
 * The dashboard's left pane on screens 760px and wider, a floating white card
 * 12px in from the edges: the logo, the morphing "New Document" menu (scan,
 * import or start a dataset), pill links to every
 * area with item counts, how much this device stores, and the signed-in
 * paravet's menu (Account, a Light/Dark/Device switch, install, sign out). The PanelLeft button or Ctrl/Cmd+B folds
 * it from 264px to a 64px icon rail topped by the city seal, which unfolds it (remembered on this device; screens under
 * 1024px start folded); phones use the bottom bar instead.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { CalendarHeart, ClipboardList, Download, HardDrive, Landmark, LogOut, Monitor, Moon, PanelLeft, Settings, Sparkles, Sun, UserRound, type LucideIcon } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";

import sealUrl from "@/assets/brand/cityvet-logo.png";
import { Logo } from "@/components/brand/logo";
import { NewDocumentMenu } from "@/components/layout/new-document-menu";
import { SyncStatus } from "@/components/layout/sync-status";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { roleLabel } from "@/core/auth/local-auth";
import { getStorageStatus } from "@/core/storage/storage-health";
import { SECTION_LINKS, isSectionActive } from "@/features/workspace/section-links";
import { formatBytes } from "@/features/workspace/query";
import type { WorkspaceItem } from "@/features/workspace/types";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { cn } from "@/lib/utils";
import { useAppearanceStore, type Theme } from "@/stores/appearance-store";
import { useAuthStore } from "@/stores/auth-store";
import { useProfilePhotoStore } from "@/stores/profile-photo-store";
import { toast } from "@/stores/toast-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const COLLAPSED_KEY = "salin_sidebar_collapsed";
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
/** Text that wipes out right to left while the sidebar folds into the rail (`group/rail` is the aside). */
const wipe =
  "min-w-0 whitespace-nowrap transition-[clip-path,opacity] duration-400 ease-[cubic-bezier(.32,.72,0,1)] [clip-path:inset(0_0_0_0)] motion-reduce:transition-none group-data-collapsed/rail:[clip-path:inset(0_100%_0_0)] group-data-collapsed/rail:opacity-0";

const OTHER_LINKS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/census", label: "Census", icon: ClipboardList },
  { to: "/programs", label: "Programs", icon: CalendarHeart },
  { to: "/city-vet", label: "City Vet", icon: Landmark },
  { to: "/ai-studio", label: "AI Studio", icon: Sparkles },
  { to: "/settings", label: "Settings", icon: Settings },
];

/** Same rules as the Workspace, Recents, Favorites and Trash views (see query.ts). */
function sectionCounts(items: WorkspaceItem[], hidden: Set<string>): Record<string, number> {
  const live = items.filter((item) => item.deletedAt === null && !(item.parentId !== null && hidden.has(item.parentId)));
  return {
    "/": live.filter((item) => item.kind === "file").length,
    "/recents": live.filter((item) => item.kind === "file" && item.openedAt !== null).length,
    "/favorites": live.filter((item) => item.isFavorite).length,
    "/trash": items.filter((item) => item.deletedAt !== null).length,
  };
}

function NavLink({ to, label, icon: Icon, count, active }: { to: string; label: string; icon: LucideIcon; count?: number; active: boolean }) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      title={label}
      className={cn(
        "flex h-10 items-center gap-3 overflow-hidden rounded-full px-[11px] text-sm font-medium transition-[background-color,color] duration-300 ease-spring",
        active ? "bg-salin-primary/10 text-salin-text" : "text-salin-muted hover:bg-salin-tile hover:text-salin-text",
      )}
    >
      <Icon aria-hidden="true" className={cn("size-[18px] shrink-0", active && "text-salin-primary")} strokeWidth={1.9} />
      <span className={cn(wipe, "flex flex-1 items-center gap-3")}>
        <span className="flex-1 truncate">{label}</span>
        {count !== undefined && count > 0 && <span className="text-xs text-salin-subtle tabular-nums">{count.toLocaleString()}</span>}
      </span>
    </Link>
  );
}

const THEME_CHOICES: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Device", icon: Monitor },
];

/** "12.4 MB Local": how much Salin keeps on this device, refreshed when the workspace changes. */
export function StorageBadge({ className }: { className?: string }) {
  const items = useWorkspaceStore((s) => s.items);
  const [usage, setUsage] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    getStorageStatus()
      .then((status) => active && setUsage(status.supported ? status.usage : null))
      .catch(() => active && setUsage(null));
    return () => {
      active = false;
    };
  }, [items]);
  if (usage === null) return null;
  return (
    <Link
      to="/settings"
      title="Stored on this device"
      className={cn("flex h-9 items-center gap-2 overflow-hidden rounded-xl px-3 text-xs text-salin-muted ring-1 ring-salin-border hover:text-salin-text", className)}
    >
      <HardDrive aria-hidden="true" className="size-4 shrink-0" />
      <span className={cn(wipe, "truncate tabular-nums")}>
        {formatBytes(usage)}
        <span className="max-[440px]:hidden"> Local</span>
      </span>
    </Link>
  );
}

/** The signed-in paravet: avatar + name in the sidebar; just the avatar (`compact`) in the phone header. */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const signOut = useAuthStore((s) => s.signOut);
  const { canPrompt, installed, promptInstall } = useInstallPrompt();
  const theme = useAppearanceStore((s) => s.theme);
  const setTheme = useAppearanceStore((s) => s.setTheme);
  const photo = useProfilePhotoStore((s) => s.photo);
  const loadPhoto = useProfilePhotoStore((s) => s.load);
  useEffect(() => {
    if (session) void loadPhoto(session.key);
  }, [session, loadPhoto]);
  if (!session) return null;
  const initials = session.name
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  async function install() {
    if (!canPrompt) {
      toast("To install, use your browser menu → “Install app”.");
      return;
    }
    if ((await promptInstall()) === "accepted") toast("e-Vet is installed. Open it from your desktop or home screen.");
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={`Account: ${session.name}`}
        className={cn("flex items-center gap-2.5 overflow-hidden rounded-xl p-1 text-left outline-none hover:bg-salin-tile focus-visible:ring-2 focus-visible:ring-salin-primary", compact ? "shrink-0 rounded-full" : "w-full")}
      >
        {photo ? (
          <img src={photo} alt="" className="size-8 shrink-0 rounded-full object-cover" />
        ) : (
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-salin-primary-soft text-xs font-semibold text-salin-primary-ink">
            {initials}
          </span>
        )}
        {!compact && (
          <span className={cn(wipe, "flex-1")}>
            <span className="block truncate text-sm font-medium text-salin-text">{session.name}</span>
            <span className="block truncate text-[11px] text-salin-subtle">{session.barangay ? `${roleLabel(session.role)} · ${session.barangay}` : session.key}</span>
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={compact ? "bottom" : "top"} align={compact ? "end" : "start"} className="w-60 rounded-xl p-1.5">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate font-semibold">{session.name}</span>
          <span className="block truncate text-xs text-salin-muted">
            {roleLabel(session.role)}
            {session.barangay ? ` · ${session.barangay}` : ""} · {session.key}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => navigate("/account")}>
          <UserRound /> Account
        </DropdownMenuItem>
        {/* Theme as a segmented switch; picking keeps the menu open so the pill can be seen sliding. */}
        <DropdownMenuPrimitive.RadioGroup
          aria-label="Theme"
          value={theme}
          onValueChange={(value) => setTheme(value as Theme)}
          className="seg-track mx-1 my-1.5 flex gap-1 rounded-xl bg-salin-tile p-1"
        >
          {THEME_CHOICES.map(({ value, label, icon: Icon }) => (
            <DropdownMenuPrimitive.RadioItem
              key={value}
              value={value}
              onSelect={(event) => event.preventDefault()}
              className={cn(
                "flex h-8 flex-1 cursor-default items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium outline-none select-none focus-visible:ring-2 focus-visible:ring-salin-primary",
                theme === value ? "bg-salin-surface text-salin-primary shadow-sm" : "text-salin-muted data-highlighted:text-salin-text",
              )}
            >
              <Icon aria-hidden="true" className="size-3.5" /> {label}
            </DropdownMenuPrimitive.RadioItem>
          ))}
        </DropdownMenuPrimitive.RadioGroup>
        {/* Phones have no sidebar, so these areas are reached from here. */}
        {compact &&
          OTHER_LINKS.map(({ to, label, icon: Icon }) => (
            <DropdownMenuItem key={to} className="gap-2.5 py-2" onSelect={() => navigate(to)}>
              <Icon /> {label}
            </DropdownMenuItem>
          ))}
        {!installed && (
          <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => void install()}>
            <Download /> Install e-Vet
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2.5 py-2"
          onSelect={() => {
            void signOut().then(() => navigate("/login", { replace: true }));
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
        <p className="px-1.5 py-1 text-xs text-salin-muted">Signing out keeps your documents and datasets on this device.</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Folded or not: remembered on this device; without a saved choice, screens under 1024px start folded. Ctrl/Cmd+B toggles it outside text fields. */
function useCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(COLLAPSED_KEY);
      if (saved !== null) return saved === "true";
    } catch {
      // Storage blocked (private mode): fall back to the screen width.
    }
    return !window.matchMedia("(min-width: 64rem)").matches;
  });

  const toggle = useCallback(() => {
    setCollapsed((was) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, String(!was));
      } catch {
        // Not remembered this time; the toggle still works.
      }
      return !was;
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b" || !(IS_MAC ? event.metaKey : event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable]:not([contenteditable='false'])")) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return [collapsed, toggle] as const;
}

export function Sidebar() {
  const { pathname } = useLocation();
  const items = useWorkspaceStore((s) => s.items);
  const hidden = useWorkspaceStore((s) => s.hiddenFolderIds);
  const counts = sectionCounts(items, hidden);
  const [collapsed, toggle] = useCollapsed();
  const shortcut = IS_MAC ? "⌘B" : "Ctrl+B";

  return (
    <aside data-collapsed={collapsed || undefined} className="group/rail sticky top-0 z-40 hidden h-dvh shrink-0 p-3 nav:block">
      <div
        className={cn(
          "flex h-full flex-col gap-5 rounded-[24px] border border-salin-border bg-salin-bar px-[11px] py-4 shadow-sm transition-[width] duration-[640ms] ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none",
          collapsed ? "w-16" : "w-[264px]",
        )}
      >
        <div className="relative flex h-10 items-center">
          <div inert={collapsed} className={cn(wipe, "pr-11 pl-1")}>
            <Logo />
          </div>
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            aria-keyshortcuts={IS_MAC ? "Meta+B" : "Control+B"}
            title={`${collapsed ? "Expand" : "Collapse"} sidebar (${shortcut})`}
            className="absolute top-0 right-0 grid size-10 place-items-center rounded-xl text-salin-muted outline-none hover:bg-salin-tile hover:text-salin-text focus-visible:ring-2 focus-visible:ring-salin-primary"
          >
            {/* Folded, the city seal is the expand button. */}
            {collapsed ? <img src={sealUrl} alt="" className="size-9" /> : <PanelLeft aria-hidden="true" className="size-[18px]" strokeWidth={1.9} />}
          </button>
        </div>
        <NewDocumentMenu collapsed={collapsed} />
        <nav aria-label="Primary" className="flex flex-1 flex-col gap-1">
          {SECTION_LINKS.map((link) => (
            <NavLink key={link.to} {...link} count={counts[link.to]} active={isSectionActive(link.to, pathname)} />
          ))}
          <div aria-hidden="true" className="my-2 h-px bg-salin-border" />
          {OTHER_LINKS.map((link) => (
            <NavLink key={link.to} {...link} active={pathname.startsWith(link.to)} />
          ))}
        </nav>
        <div className="space-y-2">
          <SyncStatus className="w-full" />
          <StorageBadge />
          <AccountMenu />
        </div>
      </div>
    </aside>
  );
}
