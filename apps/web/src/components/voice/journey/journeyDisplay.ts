import { frVoice } from "@/i18n/fr.voice";
import { formatTime } from "@/lib/format";
import type { Adjustment, Itinerary, Journey, RequirementChange } from "@/types/journey";

/**
 * Display helpers of the journey stages. Formatting only: nothing here ranks, filters or
 * judges what the server proposed.
 */

/**
 * Wall-clock time of a local ISO date-time ("2026-11-12T08:05+01:00" → "8 h 05"). The
 * server sends Europe/Paris local times: the digits are shown as written, with no
 * conversion through the browser's time zone.
 */
export function clockTime(isoDateTime: string): string {
  const match = /T(\d{2}:\d{2})/.exec(isoDateTime);
  return match ? formatTime(match[1]!) : isoDateTime;
}

/** Calendar date of a local ISO date-time, for helpers that format dates. */
export function isoDatePart(isoDateTime: string): string {
  return isoDateTime.slice(0, 10);
}

export const formatDuration = frVoice.journey.duration;

/** "Retour : 17 h 00 → 17 h 30" — the before and after values recorded by the server. */
export function changeText(change: RequirementChange): string {
  return frVoice.journey.adjustments.change(
    frVoice.journey.adjustments.field[change.field],
    formatTime(change.before),
    formatTime(change.after),
  );
}

/** Same change, in words, for assistive technology (an arrow is not read reliably). */
export function changeSpoken(change: RequirementChange): string {
  return frVoice.journey.adjustments.changeSpoken(
    frVoice.journey.adjustments.field[change.field],
    formatTime(change.before),
    formatTime(change.after),
  );
}

/** The reasons given by the server, each once (every adjustment repeats the same one). */
export function adjustmentReasons(adjustments: readonly Adjustment[]): string[] {
  return [...new Set(adjustments.map((adjustment) => adjustment.reason).filter((reason) => reason.trim() !== ""))];
}

/** The itinerary the server says is chosen, wherever it lists it. A lookup, not a choice. */
export function selectedItinerary(journey: Journey): Itinerary | null {
  const id = journey.selected_itinerary_id;
  if (!id) return null;
  return journey.itineraries.find((item) => item.id === id) ?? journey.alternatives.find((item) => item.id === id) ?? null;
}
