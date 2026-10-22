/**
 * Require Session
 * Route guard around the app: sends anyone not signed in to /login,
 * remembering where they were headed so sign-in can return them there.
 * Renders a blank canvas for the moment the saved session is being read.
 */

import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { useAuthStore } from "@/stores/auth-store";

export function RequireSession({ children }: { children: ReactNode }) {
  const location = useLocation();
  const status = useAuthStore((state) => state.status);
  const session = useAuthStore((state) => state.session);

  if (status === "loading") return <div className="min-h-[100dvh] bg-salin-canvas" />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}
