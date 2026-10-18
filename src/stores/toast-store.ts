/**
 * Toast Store
 * Queue of the small notification bars shown at the bottom of the screen
 * (rendered by components/common/toaster.tsx). Call `toast("message")` from
 * anywhere, optionally with an action button such as Undo.
 */

import { create } from "zustand";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  message: string;
  action?: ToastAction;
}

interface ToastOptions {
  /** Milliseconds before auto-dismiss; `null` keeps the toast until the user dismisses it. */
  duration?: number | null;
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, action?: ToastAction, options?: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const DEFAULT_DURATION = 4200;

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  show: (message, action, options = {}) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, action }] }));
    const duration = options.duration === undefined ? DEFAULT_DURATION : options.duration;
    if (duration !== null) window.setTimeout(() => get().dismiss(id), duration);
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (message: string, action?: ToastAction, options?: ToastOptions) =>
  useToastStore.getState().show(message, action, options);
