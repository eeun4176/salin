/**
 * Sidebar
 * The dashboard's left pane on screens 760px and wider: the logo, the
 * "New Document" menu (scan with the camera or import files), links to every
 * area with item counts, how much this device stores, and the signed-in
 * paravet's menu (install, sign out). Below 1024px it narrows to an icon
 * rail; phones use the bottom bar instead.
 */

import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Camera, ChevronDown, ClipboardList, Download, HardDrive, LogOut, Plus, Settings, Sparkles, Upload, type LucideIcon } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getStorageStatus } from "@/core/storage/storage-health";
import { SECTION_LINKS, isSectionActive } from "@/features/workspace/section-links";
import { formatBytes } from "@/features/workspace/query";
import type { WorkspaceItem } from "@/features/workspace/types";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "@/stores/toast-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const OTHER_LINKS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/census", label: "Census", icon: ClipboardList },
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
        "flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-[background-color,color,box-shadow] duration-300 ease-spring max-lg:justify-center max-lg:px-0",
        active ? "bg-salin-surface text-salin-text shadow-[0_0_0_1px_var(--color-salin-border),0_1px_2px_rgb(0_0_0/0.04)]" : "text-salin-muted hover:bg-salin-tile hover:text-salin-text",
      )}
    >
      <Icon aria-hidden="true" className={cn("size-[18px] shrink-0", active && "text-salin-primary")} strokeWidth={1.9} />
      <span className="flex-1 truncate max-lg:sr-only">{label}</span>
      {count !== undefined && count > 0 && <span className="text-xs text-salin-subtle tabular-nums max-lg:hidden">{count.toLocaleString()}</span>}
    </Link>
  );
}

function NewDocumentMenu() {
  const navigate = useNavigate();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label="New Document"
        className="press flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-salin-primary px-3 text-sm font-semibold text-white shadow-[0_6px_16px_-8px_rgb(1_168_90/0.7)] outline-none hover:bg-salin-primary-strong focus-visible:ring-3 focus-visible:ring-salin-primary/30"
      >
        <Plus aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={2.2} />
        <span className="max-lg:sr-only">New Document</span>
        <ChevronDown aria-hidden="true" className="ml-auto size-4 opacity-80 max-lg:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60 rounded-xl p-1.5">
        <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => navigate("/scan")}>
          <Camera /> Scan Document
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => navigate("/import")}>
          <Upload /> Import Files
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "12.4 MB Local": how much Salin keeps on this device, refreshed when the workspace changes. */
function StorageBadge() {
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
      className="flex h-9 items-center gap-2 rounded-xl px-3 text-xs text-salin-muted ring-1 ring-salin-border hover:text-salin-text max-lg:justify-center max-lg:px-0"
    >
      <HardDrive aria-hidden="true" className="size-4 shrink-0" />
      <span className="tabular-nums max-lg:sr-only">{formatBytes(usage)} Local</span>
    </Link>
  );
}

function AccountMenu() {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const signOut = useAuthStore((s) => s.signOut);
  const { canPrompt, installed, promptInstall } = useInstallPrompt();
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
    if ((await promptInstall()) === "accepted") toast("Salin is installed. Open it from your desktop or home screen.");
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={`Account: ${session.name}`}
        className="flex w-full items-center gap-2.5 rounded-xl p-1.5 text-left outline-none hover:bg-salin-tile focus-visible:ring-2 focus-visible:ring-salin-primary max-lg:justify-center"
      >
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-salin-primary-soft text-xs font-semibold text-salin-primary-ink">
          {initials}
        </span>
        <span className="min-w-0 flex-1 max-lg:hidden">
          <span className="block truncate text-sm font-medium text-salin-text">{session.name}</span>
          <span className="block truncate text-[11px] text-salin-subtle">{session.key}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60 rounded-xl p-1.5">
        <DropdownMenuLabel className="truncate">{session.name}</DropdownMenuLabel>
        {!installed && (
          <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => void install()}>
            <Download /> Install Salin
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

export function Sidebar() {
  const { pathname } = useLocation();
  const items = useWorkspaceStore((s) => s.items);
  const hidden = useWorkspaceStore((s) => s.hiddenFolderIds);
  const counts = sectionCounts(items, hidden);

  return (
    <aside className="sticky top-0 hidden h-dvh flex-col gap-5 border-r border-salin-border bg-salin-canvas px-3 py-4 nav:flex">
      <div className="flex h-10 items-center px-2 max-lg:justify-center max-lg:px-0">
        <Logo className="max-lg:hidden" />
        <Link to="/" aria-label="Salin home" className="rounded-md text-[26px] leading-none font-extrabold text-salin-primary lg:hidden">
          S
        </Link>
      </div>
      <NewDocumentMenu />
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
        <StorageBadge />
        <AccountMenu />
      </div>
    </aside>
  );
}
