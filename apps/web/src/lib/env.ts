/**
 * Public variables read at build time (NEXT_PUBLIC_ prefix). No secret
 * ever goes through here: the OpenAI key stays in the backend.
 */
import type { ClientConfig } from "@/types/contracts";

export const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

const API_PREFIX = "/api/v1";
const DEFAULT_API_BASE_URL = "http://localhost:8000";

/** "/sncf-chatbot/" → "/sncf-chatbot"; "" or "/" → "". */
export function normalizeBasePath(basePath: string | undefined): string {
  const trimmed = (basePath ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/**
 * Root of the REST API, including `/api/v1`.
 * - `apiBaseUrl` undefined (variable not set): local default, http://localhost:8000.
 * - `apiBaseUrl` absolute: that origin.
 * - `apiBaseUrl` empty: same origin, under the deployment base path (reverse proxy).
 */
export function resolveApiRoot(apiBaseUrl: string | undefined, basePath: string | undefined): string {
  const base = (apiBaseUrl ?? DEFAULT_API_BASE_URL).trim().replace(/\/+$/, "");
  if (base) return `${base}${API_PREFIX}`;
  return `${normalizeBasePath(basePath)}${API_PREFIX}`;
}

export const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

export const apiRoot = resolveApiRoot(process.env.NEXT_PUBLIC_API_BASE_URL, process.env.NEXT_PUBLIC_BASE_PATH);

/**
 * Limits used until `GET /config` answers (and in case it fails). They mirror the
 * backend defaults; the server remains the authority and re-checks everything.
 */
export const DEFAULT_CLIENT_CONFIG: ClientConfig = {
  max_audio_seconds: 120,
  max_audio_bytes: 10_485_760,
  max_message_chars: 4_000,
  timezone: "Europe/Paris",
};
