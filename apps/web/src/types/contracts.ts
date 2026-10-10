/**
 * Hand-written mirror of `packages/contracts/conversation_response.schema.json`
 * (schema_version 1.1). To be replaced by the OpenAPI generation (`pnpm gen:types`)
 * once the API is available; key names follow the JSON exactly,
 * including `return`.
 */

export type ConversationState =
  | "COLLECTING"
  | "ASKING_USER"
  | "AWAITING_CONFIRMATION"
  | "EDITING"
  | "CONFIRMED"
  | "HANDOFF";

export type FieldName = "participants_count" | "departure_station" | "departure" | "return" | "teaching_type";

/** Canonical order, used everywhere a list of fields is shown or asked. */
export const FIELD_NAMES: readonly FieldName[] = [
  "participants_count",
  "departure_station",
  "departure",
  "return",
  "teaching_type",
] as const;

export type TimeConstraint = "exact" | "approximate" | "earliest" | "latest";

export const TIME_CONSTRAINTS: readonly TimeConstraint[] = [
  "exact",
  "approximate",
  "earliest",
  "latest",
] as const;

export interface PartialDateTime {
  /** ISO 8601 calendar date (Europe/Paris), e.g. "2026-11-12". */
  date: string | null;
  /** Local time "HH:MM". */
  time: string | null;
  constraint: TimeConstraint | null;
}

export interface DateTimeRequirement {
  date: string;
  time: string;
  constraint: TimeConstraint;
}

export interface ParticipantsBreakdown {
  students: number | null;
  accompanying: number | null;
}

export interface TeachingType {
  subject: string | null;
  theme: string | null;
}

export interface PartialRequirements {
  participants_count: number | null;
  participants_breakdown?: ParticipantsBreakdown | null;
  /** Departure station or city, free text as the teacher said it (max 80 characters). */
  departure_station: string | null;
  departure: PartialDateTime | null;
  return: PartialDateTime | null;
  teaching_type: TeachingType | null;
}

export interface CompleteRequirements {
  participants_count: number;
  participants_breakdown?: ParticipantsBreakdown | null;
  departure_station: string;
  departure: DateTimeRequirement;
  return: DateTimeRequirement;
  teaching_type: TeachingType;
}

export interface ConfirmedRequirements {
  schema_version: "1.1";
  conversation_id: string;
  status: "confirmed";
  timezone: "Europe/Paris";
  confirmed_at: string;
  requirements: CompleteRequirements;
}

export type MessageRole = "assistant" | "user";
export type MessageSource = "text" | "audio" | "edit";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  source?: MessageSource | null;
  created_at: string;
}

export interface PendingClarification {
  field: FieldName;
  kind: string;
}

export interface ConversationResponse {
  conversation_id: string;
  state: ConversationState;
  version: number;
  assistant_message: string | null;
  requirements: PartialRequirements;
  missing_fields: FieldName[];
  pending_clarification?: PendingClarification | null;
  ready_for_confirmation: boolean;
  transcript?: string | null;
  confirmed_requirements?: ConfirmedRequirements | null;
  messages: Message[];
}

/** Body of `POST /conversations/{id}/messages`. */
export interface SendMessageBody {
  content: string;
  client_message_id: string;
  source: Exclude<MessageSource, "edit">;
}

/** Value accepted by `PATCH /conversations/{id}/requirements`, per field. */
export type RequirementValue<F extends FieldName = FieldName> = F extends "participants_count"
  ? number
  : F extends "departure_station"
    ? string
    : F extends "departure" | "return"
      ? DateTimeRequirement
      : TeachingType;

export interface RequirementEditBody<F extends FieldName = FieldName> {
  field: F;
  value: RequirementValue<F>;
  expected_version: number;
}

export interface ConfirmBody {
  expected_version: number;
}

/** RFC 9457 error returned by the API (`application/problem+json`). */
export interface ProblemDetails {
  type?: string;
  title: string;
  status: number;
  /** Stable machine-readable code, e.g. "VERSION_CONFLICT". */
  code?: string;
  detail: string;
}

/** `GET /config`: limits the client applies before calling the server. */
export interface ClientConfig {
  max_audio_seconds: number;
  max_audio_bytes: number;
  max_message_chars: number;
  timezone: string;
  /** How the backend reaches the planner. Informational; the UI does not act on it. */
  planner_mode?: "off" | "simulated" | "http";
}
