import { isDemoMode } from "@/lib/env";

/**
 * Deterministic mode of the voice visual, for screenshots: when the page defines
 * `window.__lioVoiceFixedLevel` (a number from 0 to 1) the shape and the meter render that
 * level, at a fixed instant, instead of the live microphone. Honoured in demo mode only.
 */
export function fixedVoiceLevel(): number | null {
  if (!isDemoMode || typeof window === "undefined") return null;
  const value = (window as unknown as { __lioVoiceFixedLevel?: unknown }).__lioVoiceFixedLevel;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}
