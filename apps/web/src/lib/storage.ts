/**
 * Minimal local persistence: the conversation id, used to restore the
 * session on reload. Demo mode also keeps its simulated state here.
 */
import { basePath } from "./env";

/**
 * Keys are namespaced by the deployment base path so two deployments on the same
 * origin never share a conversation. At the root the key is plain `lio.<name>`.
 */
export function storageKey(name: string, base: string = basePath): string {
  return base ? `lio[${base}].${name}` : `lio.${name}`;
}

const CONVERSATION_ID_KEY = storageKey("conversation_id");

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readConversationId(): string | null {
  return safeStorage()?.getItem(CONVERSATION_ID_KEY) ?? null;
}

export function writeConversationId(id: string | null): void {
  const storage = safeStorage();
  if (!storage) return;
  if (id === null) storage.removeItem(CONVERSATION_ID_KEY);
  else storage.setItem(CONVERSATION_ID_KEY, id);
}

export function readJson<T>(key: string): T | null {
  const raw = safeStorage()?.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    safeStorage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage unavailable: the session will not survive a reload, nothing else breaks.
  }
}

/** Reads a one-shot flag and clears it. */
export function takeFlag(key: string): boolean {
  const storage = safeStorage();
  if (!storage || storage.getItem(key) === null) return false;
  storage.removeItem(key);
  return true;
}
