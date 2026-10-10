import { fr } from "@/i18n/fr";
import { frVoice } from "@/i18n/fr.voice";
import { formatPartialDateTime } from "@/lib/format";
import type { ConversationResponse, FieldName, PartialRequirements } from "@/types/contracts";

/**
 * Display helpers of the voice flow. Rendering only: every decision (known, missing,
 * asked, ready) is read from the server's `ConversationResponse`.
 */

/**
 * The rows of the sheet and the dots of the progress indicator, in the contract's
 * canonical order. A typed constant of this route, so a field added to the shared
 * `FieldName` is a compile error here until it is given a row.
 */
export const SHEET_FIELDS = [
  "participants_count",
  "departure_station",
  "departure",
  "return",
  "teaching_type",
] as const satisfies readonly FieldName[];

export type SheetField = (typeof SHEET_FIELDS)[number];

// Compile-time guard: every `FieldName` has a row.
type MissingRow = Exclude<FieldName, SheetField>;
const allFieldsHaveARow: MissingRow extends never ? true : false = true;
void allFieldsHaveARow;

export function fieldLabel(field: FieldName): string {
  if (field === "departure_station") return frVoice.fields.departure_station.label;
  return fr.fields[field].label;
}

export type RowStatus = "known" | "missing" | "clarify";

/** Known / to complete / to clarify — the server's verdict, never recomputed. */
export function rowStatus(field: FieldName, conversation: ConversationResponse): RowStatus {
  if (conversation.pending_clarification?.field === field) return "clarify";
  return conversation.missing_fields.includes(field) ? "missing" : "known";
}

/** Value in words, exactly as the server holds it; null when it holds nothing. */
export function fieldValue(field: FieldName, requirements: PartialRequirements): string | null {
  switch (field) {
    case "participants_count": {
      const count = requirements.participants_count;
      if (count !== null) return fr.fields.participants_count.unit(count);
      const students = requirements.participants_breakdown?.students ?? null;
      return students !== null ? fr.fields.participants_count.studentsOnly(students) : null;
    }
    case "departure_station":
      return requirements.departure_station?.trim() ? requirements.departure_station : null;
    case "departure":
      return requirements.departure ? formatPartialDateTime(requirements.departure) : null;
    case "return":
      return requirements.return ? formatPartialDateTime(requirements.return) : null;
    case "teaching_type": {
      const teaching = requirements.teaching_type;
      if (!teaching || (!teaching.subject && !teaching.theme)) return null;
      return [teaching.subject, teaching.theme].filter(Boolean).join(" — ");
    }
    default:
      return null;
  }
}

/**
 * Detail line under the total ("27 élèves et 3 accompagnateurs"). Display guard only, the
 * same as the classic panel: shown when the server's breakdown is complete and adds up to
 * the server's total, so a stale breakdown never sits next to a different total.
 */
export function participantsDetail(requirements: PartialRequirements): string | null {
  const breakdown = requirements.participants_breakdown ?? null;
  const count = requirements.participants_count;
  if (!breakdown || count === null) return null;
  if (breakdown.students === null || breakdown.accompanying === null) return null;
  if (breakdown.students + breakdown.accompanying !== count) return null;
  return fr.fields.participants_count.breakdown(breakdown.students, breakdown.accompanying);
}

/**
 * What the assistant currently says. `GET /conversations/{id}` (reload) carries no
 * `assistant_message`, so the last assistant message of the history is used then.
 */
export function assistantText(conversation: ConversationResponse): string | null {
  if (conversation.assistant_message) return conversation.assistant_message;
  for (let i = conversation.messages.length - 1; i >= 0; i -= 1) {
    const message = conversation.messages[i];
    if (message?.role === "assistant") return message.content;
  }
  return null;
}

/**
 * The row the server's message is attached to, or null when it concerns no single row.
 *
 * - A pending clarification names its field: that row.
 * - Otherwise, when the server is replying to the teacher and fields are missing, its
 *   question is about the first of its `missing_fields` (the backend's state manager asks
 *   them in that order). `ConversationResponse` does not carry that target explicitly:
 *   see "Open questions" in VOICE_NOTES.md.
 * - The welcome (no user turn yet) and a summary (nothing missing) are general messages.
 */
export function askedField(conversation: ConversationResponse): FieldName | null {
  const clarification = conversation.pending_clarification;
  if (clarification) return clarification.field;
  const replied = conversation.messages.some((message) => message.role === "user");
  return replied ? (conversation.missing_fields[0] ?? null) : null;
}

/** Number of fields the server considers complete. */
export function knownCount(conversation: ConversationResponse): number {
  return SHEET_FIELDS.filter((field) => !conversation.missing_fields.includes(field)).length;
}

/** One sentence under the sheet: why confirmation is or is not possible (server state). */
export function confirmationStatus(conversation: ConversationResponse): string {
  if (conversation.ready_for_confirmation) return frVoice.sheet.readyStatus;
  if (conversation.state === "CONFIRMED" || conversation.state === "HANDOFF") return frVoice.sheet.alreadyConfirmed;
  const clarification = conversation.pending_clarification;
  if (clarification) return frVoice.sheet.clarifyStatus(fieldLabel(clarification.field));
  if (conversation.missing_fields.length > 0) return frVoice.sheet.missingStatus(conversation.missing_fields.map(fieldLabel));
  return frVoice.sheet.notReadyStatus;
}
