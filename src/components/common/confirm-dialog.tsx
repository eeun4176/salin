/**
 * Confirm Dialog
 * Yes/no dialog for actions that can't be undone (delete forever, empty
 * Trash, replace the workspace from a backup, delete all data). The confirm
 * button shows a busy state while the async action runs.
 */

import { useState, type ReactNode } from "react";

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** Red confirm button for destructive actions. */
  destructive?: boolean;
  /** Close happens after this resolves. */
  onConfirm: () => void | Promise<unknown>;
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, destructive, onConfirm }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      {open && (
        <DialogContent>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm text-salin-muted">{description}</div>
          </DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <DialogClose disabled={busy} className="press h-10 rounded-xl px-4 text-sm font-medium text-salin-muted hover:bg-salin-tile disabled:opacity-50">
              Cancel
            </DialogClose>
            <button
              type="button"
              autoFocus
              disabled={busy}
              onClick={confirm}
              className={cn(
                "press h-10 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-60",
                destructive ? "bg-destructive hover:bg-destructive/90" : "bg-salin-primary hover:bg-[#019A53]",
              )}
            >
              {busy ? "Working…" : confirmLabel}
            </button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
