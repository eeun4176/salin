/**
 * Open Item Hooks
 * What happens when a card or row is clicked: folders open at
 * /folders/:folderId, files open in the preview (the `?preview=<id>` URL
 * parameter, so the phone's Back button closes it). Opening records the
 * last-opened time that drives Recents.
 */

import { useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import { validateName } from "@/core/storage/names";
import type { WorkspaceItem } from "@/features/workspace/types";
import { markOpened } from "@/features/workspace/workspace-actions";
import { toast } from "@/stores/toast-store";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

export const PREVIEW_PARAM = "preview";

export function folderUrl(folderId: string | null) {
  return folderId === null ? "/" : `/folders/${folderId}`;
}

export function useOpenItem() {
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();

  return useCallback(
    (item: WorkspaceItem) => {
      if (item.deletedAt !== null) {
        toast("Restore this item to open it.");
        return;
      }
      markOpened(item);
      if (item.kind === "folder") {
        useUiStore.getState().setQuery("");
        navigate(folderUrl(item.id));
        return;
      }
      setParams(
        (params) => {
          params.set(PREVIEW_PARAM, item.id);
          return params;
        },
        { state: { previewPushed: true } },
      );
    },
    [navigate, setParams],
  );
}

/** Closes the preview: steps back if opening it added a history entry, otherwise drops the parameter. */
export function useClosePreview() {
  const navigate = useNavigate();
  const location = useLocation();
  const [, setParams] = useSearchParams();
  return useCallback(() => {
    if ((location.state as { previewPushed?: boolean } | null)?.previewPushed) {
      navigate(-1);
      return;
    }
    setParams(
      (params) => {
        params.delete(PREVIEW_PARAM);
        return params;
      },
      { replace: true },
    );
  }, [location.state, navigate, setParams]);
}

/** Name validator for a new or renamed item, checked against its live siblings of the same kind. */
export function siblingNameValidator(kind: WorkspaceItem["kind"], parentId: string | null, selfId?: string) {
  return (name: string) => {
    const siblings = useWorkspaceStore
      .getState()
      .items.filter((i) => i.kind === kind && i.parentId === parentId && i.deletedAt === null);
    return validateName(name, siblings, selfId);
  };
}
