import { fr } from "@/i18n/fr";
import type { PartialDateTime, TimeConstraint } from "@/types/contracts";

const PARIS = "Europe/Paris";

const dayFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: PARIS,
  weekday: "long",
  day: "numeric",
  month: "long",
});

const dayWithYearFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: PARIS,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const parisYearFormatter = new Intl.DateTimeFormat("fr-FR", { timeZone: PARIS, year: "numeric" });

/**
 * Formats an ISO calendar date ("2026-11-12") in French: "jeudi 12 novembre".
 * The year is appended when it differs from the current year in Paris, or when `withYear` is set.
 * Rendering only: no business interpretation.
 */
export function formatDate(isoDate: string, now: Date = new Date(), withYear = false): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  // Noon UTC always falls on the same calendar day in Paris.
  const date = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  const currentYear = parisYearFormatter.format(now);
  return match[1] === currentYear && !withYear ? dayFormatter.format(date) : dayWithYearFormatter.format(date);
}

/** "08:00" → "8 h 00"; "17:30" → "17 h 30". */
export function formatTime(time: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return time;
  return `${Number(match[1])} h ${match[2]}`;
}

/** "vers 8 h 00", "au plus tard à 17 h 00", etc. */
export function formatConstraint(constraint: TimeConstraint | null, time: string): string {
  const formatted = formatTime(time);
  if (!constraint) return formatted;
  return `${fr.constraints[constraint]} ${formatted}`;
}

/**
 * Renders a partial date/time exactly as returned by the server.
 * Missing parts are flagged, never inferred.
 */
export function formatPartialDateTime(value: PartialDateTime | null, now: Date = new Date()): string {
  if (!value) return fr.panel.missing;
  const parts: string[] = [];
  parts.push(value.date ? formatDate(value.date, now) : fr.dateTime.dateMissing);
  parts.push(value.time ? formatConstraint(value.constraint, value.time) : fr.dateTime.timeMissing);
  // Non-breaking spaces inside the time ("8 h 00") so it never wraps mid-value in the panel.
  return parts.join(", ").replace(/(\d) h (\d)/g, "$1\u00a0h\u00a0$2");
}

/** Message time for the discreet timestamp under each bubble. */
export function formatMessageTime(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: PARIS,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Seconds → "1:05" for the recording timer. */
export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
