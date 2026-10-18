/**
 * App Header
 * The logo, "Install Salin" button (PWA install prompt) and Settings button
 * shown at the top of every screen.
 */

import { useState } from "react";
import { Link } from "react-router";
import { Check, Download, Settings } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils";

function InstallButton() {
  const { canPrompt, installed, promptInstall } = useInstallPrompt();
  const [pressed, setPressed] = useState(false);

  async function handleClick() {
    if (installed) return;
    if (!canPrompt) {
      toast("To install, use your browser menu → “Install app” or “Add to Home Screen”.");
      return;
    }
    const outcome = await promptInstall();
    if (outcome === "accepted") toast("Salin is installed. Open it from your home screen.");
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      // Touch devices don't always paint :active; mirror it with pointer state.
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      data-pressed={pressed}
      disabled={installed}
      className={cn(
        "press inline-flex h-10 items-center gap-2 rounded-xl bg-salin-primary px-3.5 text-sm font-semibold text-white",
        "shadow-[0_1px_0_rgb(255_255_255/0.25)_inset,0_6px_16px_-6px_rgb(1_168_90/0.6)] hover:bg-[#019A53] disabled:opacity-80",
        "sm:px-4",
      )}
    >
      {installed ? <Check className="size-4" /> : <Download className="size-4" />}
      <span>{installed ? "Installed" : "Install Salin"}</span>
    </button>
  );
}

/** Logo + install + settings row that sits on top of the hero / page band. */
export function AppHeader({ className }: { className?: string }) {
  return (
    <header className={cn("relative z-10 flex items-center justify-between gap-3", className)}>
      <Logo />
      <div className="flex items-center gap-2.5">
        <InstallButton />
        <Link
          to="/settings"
          aria-label="Settings"
          className="press grid size-10 place-items-center rounded-full bg-white text-salin-primary shadow-[0_1px_2px_rgb(0_0_0/0.06),0_0_0_1px_var(--color-salin-border)] hover:bg-salin-primary-soft"
        >
          <Settings className="size-[18px]" />
        </Link>
      </div>
    </header>
  );
}
