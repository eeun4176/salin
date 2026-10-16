import { create } from "zustand";

export interface Toast {
  id: string;
  message: string;
  action?: { label: string; onClick: () => void };
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, action?: Toast["action"]) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  show: (message, action) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, action }] }));
    window.setTimeout(() => get().dismiss(id), 4200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (message: string, action?: Toast["action"]) => useToastStore.getState().show(message, action);
