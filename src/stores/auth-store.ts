/**
 * Auth Store
 * Who is signed in on this device. The saved session is read from IndexedDB
 * once at startup (`status` is "loading" until then); sign-in and sign-out
 * go through local-auth.ts and update the store.
 */

import { create } from "zustand";

import { getSession, signIn, signOut, type LoginInput, type Session } from "@/core/auth/local-auth";

interface AuthState {
  status: "loading" | "ready";
  session: Session | null;
  /** Resolves to false when the key or password is wrong. */
  signIn: (input: LoginInput) => Promise<boolean>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set) => ({
  status: "loading",
  session: null,
  signIn: async (input) => {
    const session = await signIn(input);
    if (session) set({ session });
    return session !== null;
  },
  signOut: async () => {
    await signOut();
    set({ session: null });
  },
}));

export function startAuth() {
  getSession()
    .catch((error: unknown) => {
      console.error(error);
      return null;
    })
    .then((session) => useAuthStore.setState({ session, status: "ready" }));
}
