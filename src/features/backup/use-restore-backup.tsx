/**
 * Restore Backup Flow
 * Hook behind "Restore from backup…": opens a file picker, validates the
 * chosen .zip completely, shows what it contains and asks the user to confirm
 * replacing the current workspace, then restores it in one transaction.
 * Render `elements` once; call `pick()` to start.
 */

import { useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { readBackupArchive, restoreBackup, type ParsedBackup } from "@/core/storage/backup";
import { errorMessage } from "@/core/storage/errors";
import { formatBytes } from "@/features/workspace/query";
import { toast, useToastStore } from "@/stores/toast-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function useRestoreBackup() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [backup, setBackup] = useState<ParsedBackup | null>(null);
  const currentCount = useWorkspaceStore((s) => s.items.length);
  const navigate = useNavigate();

  async function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const checking = toast("Checking backup…", undefined, { duration: null });
    try {
      setBackup(await readBackupArchive(file));
    } catch (error) {
      toast(errorMessage(error, "That backup couldn't be read."));
    } finally {
      useToastStore.getState().dismiss(checking);
    }
  }

  async function confirm() {
    if (!backup) return;
    try {
      await restoreBackup(backup);
      toast(`Workspace restored: ${plural(backup.folders.length, "folder")}, ${plural(backup.files.length, "file")}.`);
      navigate("/");
    } catch (error) {
      console.error(error);
      toast(errorMessage(error, "The restore failed. Your workspace was left unchanged."));
    }
  }

  const exported = backup ? new Date(backup.exportedAt) : null;
  const elements = (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="restore-input"
        onChange={onChange}
      />
      <ConfirmDialog
        open={backup !== null}
        onOpenChange={(open) => !open && setBackup(null)}
        title="Replace your workspace?"
        description={
          backup && (
            <div className="space-y-2">
              <p>
                This backup
                {exported && !Number.isNaN(exported.getTime()) ? ` from ${exported.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : ""} has{" "}
                {plural(backup.folders.length, "folder")} and {plural(backup.files.length, "file")} ({formatBytes(backup.totalBytes)}). Every file passed its integrity check.
              </p>
              <p className="font-medium text-salin-text">
                Restoring replaces everything currently in your workspace{currentCount > 0 ? ` (${plural(currentCount, "item")})` : ""}. Back up first if you might need it.
              </p>
            </div>
          )
        }
        confirmLabel="Replace workspace"
        destructive={currentCount > 0}
        onConfirm={confirm}
      />
    </>
  );

  return { elements, pick: () => inputRef.current?.click() };
}
