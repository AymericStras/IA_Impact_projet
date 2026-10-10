import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type ConversationService } from "@/services/types";
import type { ConversationResponse, SendMessageBody } from "@/types/contracts";
import { useConversation } from "./useConversation";

function response(overrides: Partial<ConversationResponse> = {}): ConversationResponse {
  return {
    conversation_id: "conv_test",
    state: "COLLECTING",
    version: 0,
    assistant_message: "Bonjour !",
    requirements: { participants_count: null, departure_station: null, departure: null, return: null, teaching_type: null },
    missing_fields: ["participants_count", "departure_station", "departure", "return", "teaching_type"],
    pending_clarification: null,
    ready_for_confirmation: false,
    transcript: null,
    confirmed_requirements: null,
    messages: [{ id: "msg_001", role: "assistant", content: "Bonjour !", created_at: "2026-10-10T10:00:00+02:00" }],
    ...overrides,
  };
}

function makeService(overrides: Partial<ConversationService> = {}): ConversationService {
  return {
    getConfig: vi.fn(async () => ({
      max_audio_seconds: 90,
      max_audio_bytes: 1_000,
      max_message_chars: 500,
      timezone: "Europe/Paris",
    })),
    create: vi.fn(async () => response()),
    get: vi.fn(async () => response()),
    sendMessage: vi.fn(async (_id: string, body: SendMessageBody) =>
      response({
        version: 1,
        assistant_message: "Quel jour partez-vous ?",
        messages: [
          ...response().messages,
          { id: "msg_002", role: "user", content: body.content, source: body.source, created_at: "2026-10-10T10:01:00+02:00" },
          { id: "msg_003", role: "assistant", content: "Quel jour partez-vous ?", created_at: "2026-10-10T10:01:02+02:00" },
        ],
      }),
    ),
    sendAudio: vi.fn(async () => response({ assistant_message: null, transcript: "Nous sommes 30." })),
    editField: vi.fn(async () => response({ version: 2 })),
    confirm: vi.fn(async () => response({ state: "CONFIRMED" })),
    exportConfirmed: vi.fn(),
    ...overrides,
  };
}

describe("useConversation", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("creates a conversation on first load and persists its id", async () => {
    const service = makeService();
    const { result } = renderHook(() => useConversation(service));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.get).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("lio.conversation_id")).toBe("conv_test");
  });

  it("restores a stored conversation and falls back to a new one on 404", async () => {
    window.localStorage.setItem("lio.conversation_id", "conv_old");
    const service = makeService({
      get: vi.fn(async () => {
        throw new ApiError(404, "Introuvable", "Conversation introuvable.");
      }),
    });
    const { result } = renderHook(() => useConversation(service));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(service.get).toHaveBeenCalledWith("conv_old");
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(result.current.notice).toMatch(/nouvelle conversation/i);
  });

  it("appends the server messages after a successful send", async () => {
    const service = makeService();
    const { result } = renderHook(() => useConversation(service));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.send("Nous sommes 30");
    });

    expect(service.sendMessage).toHaveBeenCalledWith(
      "conv_test",
      expect.objectContaining({ content: "Nous sommes 30", source: "text", client_message_id: expect.any(String) }),
    );
    expect(result.current.conversation?.messages).toHaveLength(3);
    expect(result.current.conversation?.messages[1]?.content).toBe("Nous sommes 30");
    expect(result.current.optimisticMessage).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("keeps the optimistic bubble on error and retries with the same client_message_id", async () => {
    const sendMessage = vi
      .fn<ConversationService["sendMessage"]>()
      .mockRejectedValueOnce(
        new ApiError(502, "Fournisseur", "Désolé, je n'ai pas pu traiter votre message.", "PROVIDER_ERROR"),
      )
      .mockResolvedValueOnce(response({ version: 1 }));
    const service = makeService({ sendMessage });
    const { result } = renderHook(() => useConversation(service));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.send("Nous sommes 30");
    });

    expect(result.current.error?.detail).toBe("Désolé, je n'ai pas pu traiter votre message.");
    expect(result.current.error?.recovery).toBe("retry");
    expect(result.current.optimisticMessage?.content).toBe("Nous sommes 30");

    await act(async () => {
      await result.current.retry();
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    const first = sendMessage.mock.calls[0]?.[1];
    const second = sendMessage.mock.calls[1]?.[1];
    expect(first?.client_message_id).toBe(second?.client_message_id);
    expect(result.current.error).toBeNull();
    expect(result.current.optimisticMessage).toBeNull();
  });

  it("reloads the conversation and shows a notice on a stale version (409)", async () => {
    const fresh = response({ version: 5, assistant_message: null });
    const service = makeService({
      editField: vi.fn(async () => {
        throw new ApiError(409, "Version obsolète", "Les informations ont changé entre-temps.");
      }),
      get: vi.fn(async () => fresh),
    });
    const { result } = renderHook(() => useConversation(service));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let ok = true;
    await act(async () => {
      ok = await result.current.editField("participants_count", 32);
    });

    expect(ok).toBe(false);
    expect(service.get).toHaveBeenCalledWith("conv_test");
    expect(result.current.conversation?.version).toBe(5);
    expect(result.current.notice).toBe("Les informations ont changé entre-temps.");
    expect(result.current.error).toBeNull();
  });

  it("retries with a NEW client_message_id after an IDEMPOTENCY_CONFLICT", async () => {
    const sendMessage = vi
      .fn<ConversationService["sendMessage"]>()
      .mockRejectedValueOnce(new ApiError(409, "Conflit", "Ce message a déjà été envoyé.", "IDEMPOTENCY_CONFLICT"))
      .mockResolvedValueOnce(response({ version: 1 }));
    const service = makeService({ sendMessage });
    const { result } = renderHook(() => useConversation(service));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.send("Nous sommes 30");
    });
    expect(result.current.error?.detail).toBe("Ce message a déjà été envoyé.");
    expect(service.get).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.retry();
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0]?.[1].client_message_id).not.toBe(sendMessage.mock.calls[1]?.[1].client_message_id);
    expect(sendMessage.mock.calls[1]?.[1].content).toBe("Nous sommes 30");
    expect(result.current.error).toBeNull();
  });

  it("refetches, shows the server detail as a notice and keeps the draft on CONCURRENT_UPDATE", async () => {
    const fresh = response({ version: 7, assistant_message: null });
    const service = makeService({
      sendMessage: vi.fn(async () => {
        throw new ApiError(409, "Conflit", "Une autre modification est en cours.", "CONCURRENT_UPDATE");
      }),
      get: vi.fn(async () => fresh),
    });
    const { result } = renderHook(() => useConversation(service));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let outcome = "";
    await act(async () => {
      outcome = await result.current.send("Nous sommes 30");
    });

    expect(outcome).toBe("draft_kept");
    expect(service.get).toHaveBeenCalledWith("conv_test");
    expect(result.current.conversation?.version).toBe(7);
    expect(result.current.notice).toBe("Une autre modification est en cours.");
    expect(result.current.error).toBeNull();
    expect(result.current.optimisticMessage).toBeNull();
  });

  it("shows a notice without refetching on RATE_LIMITED", async () => {
    const service = makeService({
      sendMessage: vi.fn(async () => {
        throw new ApiError(429, "Trop de requêtes", "Trop de messages, patientez un instant.", "RATE_LIMITED");
      }),
    });
    const { result } = renderHook(() => useConversation(service));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let outcome = "";
    await act(async () => {
      outcome = await result.current.send("Nous sommes 30");
    });

    expect(outcome).toBe("draft_kept");
    expect(service.get).not.toHaveBeenCalled();
    expect(result.current.notice).toBe("Trop de messages, patientez un instant.");
    expect(result.current.error).toBeNull();
  });

  it("offers no replay for a validation error and a restart when the conversation is gone", async () => {
    const editField = vi
      .fn<ConversationService["editField"]>()
      .mockRejectedValueOnce(new ApiError(422, "Invalide", "Le retour doit être après le départ.", "VALIDATION_ERROR"))
      .mockRejectedValueOnce(new ApiError(404, "Introuvable", "Conversation introuvable.", "CONVERSATION_NOT_FOUND"));
    const service = makeService({ editField });
    const { result } = renderHook(() => useConversation(service));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.editField("participants_count", 32);
    });
    expect(result.current.error).toMatchObject({ detail: "Le retour doit être après le départ.", recovery: null });

    await act(async () => {
      await result.current.editField("participants_count", 32);
    });
    expect(result.current.error).toMatchObject({ detail: "Conversation introuvable.", recovery: "restart" });
  });

  it("loads the server limits once and rejects an oversized recording before uploading", async () => {
    const service = makeService();
    const { result } = renderHook(() => useConversation(service));
    await waitFor(() => expect(result.current.config.max_message_chars).toBe(500));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(service.getConfig).toHaveBeenCalledTimes(1);

    const tooBig = new Blob([new Uint8Array(1_001)], { type: "audio/webm" });
    await expect(result.current.transcribe(tooBig)).rejects.toMatchObject({ code: "AUDIO_TOO_LARGE", kind: "audio" });
    expect(service.sendAudio).not.toHaveBeenCalled();
  });

  it("keeps the default limits when the config endpoint fails", async () => {
    const service = makeService({
      getConfig: vi.fn(async () => {
        throw new ApiError(0, "Réseau", "Impossible de joindre le serveur.");
      }),
    });
    const { result } = renderHook(() => useConversation(service));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.config).toMatchObject({ max_audio_seconds: 120, max_audio_bytes: 10_485_760, max_message_chars: 4_000 });
  });

  it("returns the transcript from the audio endpoint", async () => {
    const service = makeService();
    const { result } = renderHook(() => useConversation(service));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let transcript = "";
    await act(async () => {
      transcript = await result.current.transcribe(new Blob(["x"], { type: "audio/webm" }));
    });

    expect(transcript).toBe("Nous sommes 30.");
    expect(service.sendAudio).toHaveBeenCalledWith("conv_test", expect.any(Blob));
  });
});
