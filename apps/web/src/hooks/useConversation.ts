"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fr } from "@/i18n/fr";
import { DEFAULT_CLIENT_CONFIG } from "@/lib/env";
import { readConversationId, writeConversationId } from "@/lib/storage";
import { ApiError, conversationService, toApiError, type ConversationService, type ErrorKind } from "@/services";
import type {
  ClientConfig,
  ConversationResponse,
  FieldName,
  Message,
  MessageSource,
  RequirementValue,
} from "@/types/contracts";

export type PendingAction = "restore" | "message" | "audio" | "edit" | "confirm";

export interface ConversationError {
  /** French text to display: the server's `detail` whenever it sent one. */
  detail: string;
  /**
   * What the error block offers: replay the failed request ("retry"), open a new
   * conversation ("restart", the current one no longer exists), or nothing.
   */
  recovery: "retry" | "restart" | null;
  /** Undelivered user text, handed back to the composer when the error is dismissed. */
  failedContent: string | null;
}

/**
 * Result of `send`:
 * - "sent": the server applied the message;
 * - "failed": an error block is shown (retry or dismiss);
 * - "draft_kept": nothing was applied and only a notice is shown (conflict, rate limit),
 *   so the caller should put the text back in the composer;
 * - "ignored": empty text or no conversation yet.
 */
export type SendOutcome = "sent" | "failed" | "draft_kept" | "ignored";

export interface UseConversationResult {
  status: "loading" | "ready" | "failed";
  conversation: ConversationResponse | null;
  /** Server limits; defaults until `GET /config` answers. */
  config: ClientConfig;
  pending: PendingAction | null;
  /** User bubble shown before the server answers. */
  optimisticMessage: Message | null;
  error: ConversationError | null;
  /** Non-blocking notice (e.g. reload after a version conflict, rate limit). */
  notice: string | null;
  send: (content: string, source?: Exclude<MessageSource, "edit">) => Promise<SendOutcome>;
  /** Uploads the audio and returns the transcript to correct; throws an ApiError on failure. */
  transcribe: (audio: Blob) => Promise<string>;
  editField: <F extends FieldName>(field: F, value: RequirementValue<F>) => Promise<boolean>;
  confirm: () => Promise<boolean>;
  retry: () => Promise<void>;
  dismissError: () => void;
  dismissNotice: () => void;
  restart: () => Promise<void>;
}

type ActionResult = { ok: true } | { ok: false; kind: ErrorKind };

function newClientMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

function isValidConfig(value: unknown): value is ClientConfig {
  const config = value as ClientConfig | null;
  return (
    !!config &&
    [config.max_audio_seconds, config.max_audio_bytes, config.max_message_chars].every(
      (n) => typeof n === "number" && Number.isFinite(n) && n > 0,
    )
  );
}

/**
 * Drives a conversation: restore, send messages, transcribe, panel edits,
 * confirmation and replay after an error.
 * It never derives business state: it stores the latest `ConversationResponse`.
 */
export function useConversation(service: ConversationService = conversationService): UseConversationResult {
  const [status, setStatus] = useState<UseConversationResult["status"]>("loading");
  const [conversation, setConversation] = useState<ConversationResponse | null>(null);
  const [config, setConfig] = useState<ClientConfig>(DEFAULT_CLIENT_CONFIG);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [optimisticMessage, setOptimisticMessage] = useState<Message | null>(null);
  const [error, setError] = useState<ConversationError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const conversationRef = useRef<ConversationResponse | null>(null);
  const configRef = useRef<ClientConfig>(DEFAULT_CLIENT_CONFIG);
  const lastFailedRef = useRef<(() => Promise<void>) | null>(null);
  const initializedRef = useRef(false);

  const adopt = useCallback((response: ConversationResponse) => {
    conversationRef.current = response;
    setConversation(response);
    writeConversationId(response.conversation_id);
  }, []);

  const initialize = useCallback(async () => {
    setStatus("loading");
    setError(null);
    setPending("restore");
    try {
      const storedId = readConversationId();
      let response: ConversationResponse | null = null;
      if (storedId) {
        try {
          response = await service.get(storedId);
        } catch (err) {
          if (err instanceof ApiError && err.kind === "not_found") {
            setNotice(fr.errors.notFound);
          } else {
            throw err;
          }
        }
      }
      if (!response) response = await service.create();
      adopt(response);
      setStatus("ready");
    } catch (err) {
      const apiError = toApiError(err, fr.errors.network);
      setError({ detail: apiError.detail || fr.errors.initFailed, recovery: "retry", failedContent: null });
      lastFailedRef.current = initialize;
      setStatus("failed");
    } finally {
      setPending(null);
    }
  }, [adopt, service]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    void initialize();
    // Limits are fetched once. On failure the defaults stay in place: they only drive
    // client-side hints, the server enforces the real limits either way.
    service
      .getConfig()
      .then((value) => {
        if (!isValidConfig(value)) return;
        configRef.current = value;
        setConfig(value);
      })
      .catch(() => undefined);
  }, [initialize, service]);

  const runAction = useCallback(
    async (
      kind: PendingAction,
      action: () => Promise<ConversationResponse>,
      options: { failedContent?: string | null; retry?: () => Promise<void> } = {},
    ): Promise<ActionResult> => {
      setPending(kind);
      setError(null);
      try {
        const response = await action();
        adopt(response);
        setOptimisticMessage(null);
        lastFailedRef.current = null;
        return { ok: true };
      } catch (err) {
        const apiError = toApiError(err, fr.errors.network);
        const errorKind = apiError.kind;

        if (errorKind === "conflict" || errorKind === "rate_limited") {
          // Nothing was applied. Show a notice and leave the user's input untouched;
          // on a conflict, first reload what the server now holds. No automatic replay.
          if (errorKind === "conflict" && conversationRef.current) {
            try {
              adopt(await service.get(conversationRef.current.conversation_id));
            } catch {
              // Reload failed: the notice below still tells the user what happened.
            }
          }
          const fallback = errorKind === "conflict" ? fr.errors.staleVersion : fr.errors.rateLimited;
          setNotice(apiError.detail || fallback);
          setOptimisticMessage(null);
          lastFailedRef.current = null;
          return { ok: false, kind: errorKind };
        }

        const canReplay = Boolean(options.retry) && (errorKind === "retry_same" || errorKind === "idempotency");
        lastFailedRef.current = canReplay ? (options.retry ?? null) : null;
        setError({
          detail: apiError.detail || fr.errors.generic,
          recovery: canReplay ? "retry" : errorKind === "not_found" ? "restart" : null,
          failedContent: options.failedContent ?? null,
        });
        return { ok: false, kind: errorKind };
      } finally {
        setPending(null);
      }
    },
    [adopt, service],
  );

  const send = useCallback<UseConversationResult["send"]>(
    async (content, source = "text") => {
      const current = conversationRef.current;
      const trimmed = content.trim();
      if (!current || !trimmed) return "ignored";
      // The same id is reused on every retry so the server never applies the patch twice.
      // Only an IDEMPOTENCY_CONFLICT (id already bound to other content) forces a new one.
      let clientMessageId = newClientMessageId();
      const attempt = async (): Promise<SendOutcome> => {
        setOptimisticMessage({
          id: `local_${clientMessageId}`,
          role: "user",
          content: trimmed,
          source,
          created_at: new Date().toISOString(),
        });
        const result = await runAction(
          "message",
          () =>
            service.sendMessage(current.conversation_id, {
              content: trimmed,
              client_message_id: clientMessageId,
              source,
            }),
          { failedContent: trimmed, retry: () => attempt().then(() => undefined) },
        );
        if (result.ok) return "sent";
        if (result.kind === "idempotency") clientMessageId = newClientMessageId();
        return result.kind === "conflict" || result.kind === "rate_limited" ? "draft_kept" : "failed";
      };
      return attempt();
    },
    [runAction, service],
  );

  const transcribe = useCallback<UseConversationResult["transcribe"]>(
    async (audio) => {
      const current = conversationRef.current;
      if (!current) throw new ApiError(0, "Erreur", fr.errors.generic);
      // Cheap client-side check before uploading; the server enforces the same limit.
      if (audio.size > configRef.current.max_audio_bytes) {
        throw new ApiError(413, "Enregistrement trop volumineux", fr.voice.tooLarge, "AUDIO_TOO_LARGE");
      }
      setPending("audio");
      try {
        const response = await service.sendAudio(current.conversation_id, audio);
        const transcript = response.transcript ?? "";
        if (!transcript.trim()) {
          throw new ApiError(422, "Transcription vide", fr.voice.emptyRecording, "EMPTY_TRANSCRIPT");
        }
        return transcript;
      } catch (err) {
        throw toApiError(err, fr.errors.network);
      } finally {
        setPending(null);
      }
    },
    [service],
  );

  const editField = useCallback<UseConversationResult["editField"]>(
    async (field, value) => {
      const current = conversationRef.current;
      if (!current) return false;
      const attempt = async (): Promise<boolean> => {
        // Always send the version of the latest response, including after a refetch.
        const latest = conversationRef.current ?? current;
        const result = await runAction(
          "edit",
          () => service.editField(latest.conversation_id, field, value, latest.version),
          { retry: () => attempt().then(() => undefined) },
        );
        return result.ok;
      };
      return attempt();
    },
    [runAction, service],
  );

  const confirm = useCallback<UseConversationResult["confirm"]>(async () => {
    const current = conversationRef.current;
    if (!current) return false;
    const attempt = async (): Promise<boolean> => {
      const latest = conversationRef.current ?? current;
      const result = await runAction("confirm", () => service.confirm(latest.conversation_id, latest.version), {
        retry: () => attempt().then(() => undefined),
      });
      return result.ok;
    };
    return attempt();
  }, [runAction, service]);

  const retry = useCallback(async () => {
    const action = lastFailedRef.current;
    if (!action) return;
    await action();
  }, []);

  const dismissError = useCallback(() => {
    setError(null);
    setOptimisticMessage(null);
    lastFailedRef.current = null;
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  const restart = useCallback(async () => {
    writeConversationId(null);
    conversationRef.current = null;
    lastFailedRef.current = null;
    setConversation(null);
    setOptimisticMessage(null);
    setNotice(null);
    await initialize();
  }, [initialize]);

  return useMemo(
    () => ({
      status,
      conversation,
      config,
      pending,
      optimisticMessage,
      error,
      notice,
      send,
      transcribe,
      editField,
      confirm,
      retry,
      dismissError,
      dismissNotice,
      restart,
    }),
    [
      status,
      conversation,
      config,
      pending,
      optimisticMessage,
      error,
      notice,
      send,
      transcribe,
      editField,
      confirm,
      retry,
      dismissError,
      dismissNotice,
      restart,
    ],
  );
}
