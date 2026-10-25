/**
 * City Vet API
 * The only way Salin talks to the City Veterinary Office's admin system
 * (e-Kapon): JSON over HTTPS to its /api/v1, with the signed-in paravet's
 * session as a Bearer token, never a cookie. The server's address comes from
 * VITE_CITY_VET_API_URL; without it every call fails as "not configured".
 * Failures are grouped by what the user can do about them — offline, signed
 * out, refused, conflict, invalid, server — and carry the server's own
 * (user-facing) message. Replies are checked with zod before use.
 */

import type { z } from "zod";

/** The server's origin: no trailing slash, and https:// added when the setting leaves it out ("city-vet-admin.vercel.app"). */
export function apiBase(setting: string | undefined) {
  const value = (setting ?? "").trim().replace(/\/+$/, "");
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export const CITY_VET_API_URL = apiBase(import.meta.env?.VITE_CITY_VET_API_URL as string | undefined);

export type AdminErrorKind = "not_configured" | "offline" | "unauthenticated" | "refused" | "conflict" | "invalid" | "server";

export class AdminApiError extends Error {
  readonly kind: AdminErrorKind;
  /** e-Kapon's error code, e.g. INVALID_CREDENTIALS, FIRST_SIGN_IN_REQUIRED, ACCOUNT_LOCKED. */
  readonly code: string;
  readonly details?: unknown;

  constructor(kind: AdminErrorKind, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AdminApiError";
    this.kind = kind;
    this.code = code;
    this.details = details;
  }
}

const OFFLINE = "You're offline. Connect to the internet and try again.";

function kindOf(status: number): AdminErrorKind {
  if (status === 401) return "unauthenticated";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "invalid";
  if (status >= 500) return "server";
  return "refused";
}

export interface AdminRequest<T> {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  token?: string | null;
  body?: unknown;
  schema: z.ZodType<T>;
  signal?: AbortSignal;
}

/** One call to `/api/v1${path}`; resolves to the checked reply or throws AdminApiError. */
export async function adminRequest<T>(path: string, { method = "GET", token, body, schema, signal }: AdminRequest<T>, base = CITY_VET_API_URL): Promise<T> {
  if (!base) throw new AdminApiError("not_configured", "NOT_CONFIGURED", "This copy of e-Vet isn't connected to the City Veterinary Office yet.");
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new AdminApiError("offline", "OFFLINE", OFFLINE);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(`${base}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "omit", signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AdminApiError("offline", "OFFLINE", OFFLINE);
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new AdminApiError(kindOf(response.status), failure?.code ?? `HTTP_${response.status}`, failure?.message ?? "The City Veterinary Office server couldn't complete this request.", failure?.details);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new AdminApiError("server", "BAD_REPLY", "The City Veterinary Office server sent a reply e-Vet doesn't understand. Try again later.");
  return parsed.data;
}
