import type {
  ClientConfig,
  ConfirmedRequirements,
  ConversationResponse,
  FieldName,
  RequirementValue,
  SendMessageBody,
} from "@/types/contracts";

/**
 * Single client contract, implemented by the real API and by the demo mock.
 * The `useConversation` hook only knows this interface.
 */
export interface ConversationService {
  /** Server limits (audio length/size, message length). */
  getConfig(): Promise<ClientConfig>;
  create(): Promise<ConversationResponse>;
  get(conversationId: string): Promise<ConversationResponse>;
  sendMessage(conversationId: string, body: SendMessageBody): Promise<ConversationResponse>;
  /** Returns the response whose `transcript` holds the text; no extraction. */
  sendAudio(conversationId: string, audio: Blob): Promise<ConversationResponse>;
  editField<F extends FieldName>(
    conversationId: string,
    field: F,
    value: RequirementValue<F>,
    expectedVersion: number,
  ): Promise<ConversationResponse>;
  confirm(conversationId: string, expectedVersion: number): Promise<ConversationResponse>;
  exportConfirmed(conversationId: string): Promise<ConfirmedRequirements>;
}

/**
 * How the client reacts to a failure. Derived from the server's stable `code`;
 * the HTTP status is only a fallback for responses without a code.
 */
export type ErrorKind =
  /** Requirements changed elsewhere: refetch, show a notice, keep the user's draft. */
  | "conflict"
  /** The client_message_id was already used for other content: retry with a new id. */
  | "idempotency"
  /** Provider failure, state unchanged: retry the SAME request (same client_message_id). */
  | "retry_same"
  /** The recording itself is unusable: record again. */
  | "audio"
  /** Too many requests: show a notice, keep the draft. */
  | "rate_limited"
  | "not_found"
  | "other";

const CODE_KINDS: Record<string, ErrorKind> = {
  VERSION_CONFLICT: "conflict",
  CONCURRENT_UPDATE: "conflict",
  IDEMPOTENCY_CONFLICT: "idempotency",
  PROVIDER_ERROR: "retry_same",
  PROVIDER_TIMEOUT: "retry_same",
  INVALID_EVIDENCE: "retry_same",
  INVALID_EXTRACTION: "retry_same",
  AUDIO_INVALID: "audio",
  AUDIO_EMPTY: "audio",
  AUDIO_TOO_LONG: "audio",
  AUDIO_TOO_LARGE: "audio",
  AUDIO_FORMAT: "audio",
  EMPTY_TRANSCRIPT: "audio",
  RATE_LIMITED: "rate_limited",
  CONVERSATION_NOT_FOUND: "not_found",
};

/**
 * Normalised error: `detail` is always a displayable French text (the server's own
 * `detail` whenever there is one). `status` 0 means the server did not answer.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  readonly code?: string;

  constructor(status: number, title: string, detail: string, code?: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.code = code;
  }

  get kind(): ErrorKind {
    const fromCode = this.code ? CODE_KINDS[this.code] : undefined;
    if (fromCode) return fromCode;
    if (this.code) return "other";
    switch (this.status) {
      case 0:
      case 502:
      case 504:
        return "retry_same";
      case 404:
        return "not_found";
      case 409:
        return "conflict";
      case 429:
        return "rate_limited";
      default:
        // An uncoded server failure leaves state unchanged: the same request may be replayed.
        return this.status >= 500 ? "retry_same" : "other";
    }
  }
}

export function toApiError(error: unknown, fallbackDetail: string): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(0, "Erreur", fallbackDetail);
}
