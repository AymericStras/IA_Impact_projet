import { fr } from "@/i18n/fr";
import { apiRoot } from "@/lib/env";
import type {
  ClientConfig,
  ConfirmedRequirements,
  ConversationResponse,
  FieldName,
  ProblemDetails,
  RequirementValue,
  SendMessageBody,
} from "@/types/contracts";
import { ApiError, type ConversationService } from "./types";

const DEFAULT_TIMEOUT_MS = 45_000;
const AUDIO_TIMEOUT_MS = 90_000;

function isProblemDetails(value: unknown): value is ProblemDetails {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ProblemDetails).detail === "string" &&
    typeof (value as ProblemDetails).status === "number"
  );
}

/** Turns an HTTP response into an error with a displayable French `detail`. */
async function errorFromResponse(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Missing or non-JSON body: fall back to a generic message.
  }
  if (isProblemDetails(body)) {
    return new ApiError(body.status, body.title, body.detail, typeof body.code === "string" ? body.code : undefined);
  }
  // FastAPI sometimes returns `{ detail: string }` without the other RFC 9457 fields.
  if (typeof body === "object" && body !== null && typeof (body as { detail?: unknown }).detail === "string") {
    return new ApiError(response.status, response.statusText, (body as { detail: string }).detail);
  }
  const detail =
    response.status === 502 || response.status === 504 ? fr.errors.provider : fr.errors.generic;
  return new ApiError(response.status, response.statusText || "Erreur", detail);
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${apiRoot}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json, application/problem+json",
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, "Réseau", fr.errors.network);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return (await response.json()) as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * HTTP client for the FastAPI service. A failure is always surfaced as an `ApiError`:
 * this client never falls back to the demo mock.
 */
export const conversationApi: ConversationService = {
  getConfig() {
    return request<ClientConfig>("/config");
  },

  create() {
    return request<ConversationResponse>("/conversations", jsonInit("POST", {}));
  },

  get(conversationId) {
    return request<ConversationResponse>(`/conversations/${encodeURIComponent(conversationId)}`);
  },

  sendMessage(conversationId, body: SendMessageBody) {
    return request<ConversationResponse>(
      `/conversations/${encodeURIComponent(conversationId)}/messages`,
      jsonInit("POST", body),
    );
  },

  sendAudio(conversationId, audio) {
    const form = new FormData();
    const extension = audio.type.includes("ogg") ? "ogg" : audio.type.includes("mp4") ? "m4a" : "webm";
    form.append("file", audio, `enregistrement.${extension}`);
    return request<ConversationResponse>(
      `/conversations/${encodeURIComponent(conversationId)}/audio`,
      { method: "POST", body: form },
      AUDIO_TIMEOUT_MS,
    );
  },

  editField<F extends FieldName>(
    conversationId: string,
    field: F,
    value: RequirementValue<F>,
    expectedVersion: number,
  ) {
    return request<ConversationResponse>(
      `/conversations/${encodeURIComponent(conversationId)}/requirements`,
      jsonInit("PATCH", { field, value, expected_version: expectedVersion }),
    );
  },

  confirm(conversationId, expectedVersion) {
    return request<ConversationResponse>(
      `/conversations/${encodeURIComponent(conversationId)}/confirm`,
      jsonInit("POST", { expected_version: expectedVersion }),
    );
  },

  exportConfirmed(conversationId) {
    return request<ConfirmedRequirements>(`/conversations/${encodeURIComponent(conversationId)}/export`);
  },
};
