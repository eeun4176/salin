/**
 * Auth Store
 * Who is signed in on this device. The saved session is read from IndexedDB
 * once at startup (`status` is "loading" until then), then checked with the
 * City Vet API in the background — at startup and whenever the connection
 * comes back: an account the office ended signs out, a changed name or
 * barangay is picked up, and a token past half its life is renewed.
 * Sign-in, first sign-in and sign-out go through local-auth.ts and update
 * the store.
 */

import { create } from "zustand";

import { finishFirstSignIn, getSession, refreshSession, signIn, signOut, type LoginInput, type NewPassword, type Session, type SignInResult } from "@/core/auth/local-auth";

interface AuthState {
  status: "loading" | "ready";
  session: Session | null;
  signIn: (input: LoginInput) => Promise<SignInResult>;
  /** The last first-sign-in step (new password + terms), with the temporary password's reset token. */
  finishFirstSignIn: (resetToken: string, input: NewPassword) => Promise<SignInResult>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set) => ({
  status: "loading",
  session: null,
  signIn: async (input) => {
    const result = await signIn(input);
    if (result.ok) set({ session: result.session });
    return result;
  },
  finishFirstSignIn: async (resetToken, input) => {
    const result = await finishFirstSignIn(resetToken, input);
    if (result.ok) set({ session: result.session });
    return result;
  },
  signOut: async () => {
    await signOut();
    set({ session: null });
  },
}));

let checking = false;

/** Re-checks the signed-in session with the City Vet API (one check at a time). */
async function checkSession() {
  const session = useAuthStore.getState().session;
  if (!session || checking) return;
  checking = true;
  try {
    const current = await refreshSession(session);
    // Only apply it if nobody signed in or out meanwhile.
    if (useAuthStore.getState().session?.token !== session.token) return;
    if (current) useAuthStore.setState({ session: current });
    else await useAuthStore.getState().signOut();
  } catch (error) {
    console.error(error);
  } finally {
    checking = false;
  }
}

export function startAuth() {
  getSession()
    .catch((error: unknown) => {
      console.error(error);
      return null;
    })
    .then((session) => {
      useAuthStore.setState({ session, status: "ready" });
      void checkSession();
    });
  window.addEventListener("online", () => void checkSession());
}
