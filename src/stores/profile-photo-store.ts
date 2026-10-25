/**
 * Profile Photo Store
 * The signed-in person's on-device photo, shared by the account menu and the
 * Account page. `load` reads it for an account; `change` and `remove` update
 * the saved copy (see core/auth/profile-photo.ts).
 */

import { create } from "zustand";

import { loadProfilePhoto, removeProfilePhoto, saveProfilePhoto, shrinkPhoto } from "@/core/auth/profile-photo";

interface ProfilePhotoState {
  account: string | null;
  photo: string | null;
  load: (account: string) => Promise<void>;
  change: (account: string, file: File) => Promise<void>;
  remove: (account: string) => Promise<void>;
}

export const useProfilePhotoStore = create<ProfilePhotoState>()((set, get) => ({
  account: null,
  photo: null,
  load: async (account) => {
    if (get().account === account) return;
    set({ account, photo: null });
    const photo = await loadProfilePhoto(account);
    if (get().account === account) set({ photo });
  },
  change: async (account, file) => {
    const photo = await shrinkPhoto(file);
    await saveProfilePhoto(account, photo);
    set({ account, photo });
  },
  remove: async (account) => {
    await removeProfilePhoto(account);
    set({ account, photo: null });
  },
}));
