import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adjustmentsJourney,
  bookedJourney,
  fakeJourneyService,
  itinerariesJourney,
  pendingJourney,
  reviewJourney,
} from "@/components/voice/journey/journeyFixtures";
import { ApiError, type ConversationService } from "@/services/types";
import type { ConversationResponse } from "@/types/contracts";
import type { JourneyStage } from "@/types/journey";
import {
  BOOKING_AUTO_CHECK_MS,
  initialVoiceFlowState,
  isJourneyStage,
  isOpenJourneyStage,
  snapshotOf,
  stageFromServer,
  useVoiceFlow,
  voiceFlowReducer,
  type VoiceFlowEvent,
  type VoiceFlowState,
} from "./useVoiceFlow";

const EMPTY = { confirmed: false, anyKnown: false };
const PARTIAL = { confirmed: false, anyKnown: true };
const CONFIRMED = { confirmed: true, anyKnown: true };

/** Applies events in order from the initial state (or from `from`). */
function run(events: VoiceFlowEvent[], from: VoiceFlowState = initialVoiceFlowState): VoiceFlowState {
  return events.reduce(voiceFlowReducer, from);
}

const booted = (snapshot = EMPTY): VoiceFlowEvent => ({ type: "SERVER_STATE", snapshot });

describe("voiceFlowReducer — initial stage and restore", () => {
  it("starts on the question when nothing is known", () => {
    const state = run([booted(EMPTY)]);
    expect(state).toMatchObject({ stage: "ask", booted: true });
  });

  it("restores a conversation with a known field on the sheet", () => {
    expect(run([booted(PARTIAL)]).stage).toBe("sheet");
  });

  it("restores a confirmed conversation on done", () => {
    expect(run([booted(CONFIRMED)]).stage).toBe("done");
  });

  it("derives the stage from the server state only", () => {
    expect(stageFromServer(CONFIRMED)).toBe("done");
    expect(stageFromServer(PARTIAL)).toBe("sheet");
    expect(stageFromServer(EMPTY)).toBe("ask");
  });
});

describe("voiceFlowReducer — listening", () => {
  it("goes from the question to listen and remembers where it came from", () => {
    const state = run([booted(), { type: "LISTEN_STARTED" }]);
    expect(state).toMatchObject({ stage: "listen", origin: "ask" });
  });

  it("listens from the sheet and comes back to the sheet", () => {
    const state = run([booted(PARTIAL), { type: "LISTEN_STARTED" }, { type: "LISTEN_DISCARDED", reason: "cancelled" }]);
    expect(state).toMatchObject({ stage: "sheet", origin: "sheet", hint: "cancelled" });
  });

  it.each(["cancelled", "too_short", "interrupted"] as const)("returns to the question with the %s hint", (reason) => {
    const state = run([booted(), { type: "LISTEN_STARTED" }, { type: "LISTEN_DISCARDED", reason }]);
    expect(state).toMatchObject({ stage: "ask", hint: reason, think: null });
  });

  it("clears an earlier hint and problem when a new recording starts", () => {
    const state = run([
      booted(),
      { type: "LISTEN_STARTED" },
      { type: "LISTEN_DISCARDED", reason: "too_short" },
      { type: "LISTEN_STARTED" },
    ]);
    expect(state).toMatchObject({ stage: "listen", hint: null, problem: null });
  });

  it("does not start listening while thinking or done", () => {
    const thinking = run([booted(), { type: "TEXT_SUBMITTED", text: "Nous serons 30." }]);
    expect(voiceFlowReducer(thinking, { type: "LISTEN_STARTED" })).toBe(thinking);
    const done = run([booted(CONFIRMED)]);
    expect(voiceFlowReducer(done, { type: "LISTEN_STARTED" })).toBe(done);
  });

  it("explains a refused microphone, keeps the button and opens the text field", () => {
    const state = run([booted(), { type: "LISTEN_STARTED" }, { type: "CAPTURE_FAILED", kind: "denied" }]);
    expect(state).toMatchObject({ stage: "ask", mic: "denied", micNotice: "denied", textEntryOpen: true });
  });

  it.each(["no_microphone", "unsupported"] as const)("replaces the talk button by text when capture is %s", (kind) => {
    const state = run([booted(), { type: "LISTEN_STARTED" }, { type: "CAPTURE_FAILED", kind }]);
    expect(state).toMatchObject({ stage: "ask", mic: "unavailable", micNotice: kind, textEntryOpen: true });
    expect(voiceFlowReducer(state, { type: "LISTEN_STARTED" })).toBe(state);
  });

  it("reports an empty recording as a hint", () => {
    const state = run([booted(), { type: "LISTEN_STARTED" }, { type: "CAPTURE_FAILED", kind: "empty" }]);
    expect(state).toMatchObject({ stage: "ask", hint: "empty_recording", mic: "available" });
  });

  it("marks the microphone as working again once a recording exists", () => {
    const state = run([
      booted(),
      { type: "LISTEN_STARTED" },
      { type: "CAPTURE_FAILED", kind: "denied" },
      { type: "LISTEN_STARTED" },
      { type: "RECORDED" },
    ]);
    expect(state).toMatchObject({ stage: "think", mic: "available", micNotice: null });
  });
});

describe("voiceFlowReducer — thinking", () => {
  const recorded = [booted(), { type: "LISTEN_STARTED" }, { type: "RECORDED" }] as VoiceFlowEvent[];

  it("shows two real steps: transcription, then understanding with the transcript", () => {
    const transcribing = run(recorded);
    expect(transcribing.think).toMatchObject({ step: "transcribing", source: "audio", transcript: null });

    const understanding = voiceFlowReducer(transcribing, { type: "TRANSCRIBED", transcript: "Nous serons 30." });
    expect(understanding.think).toMatchObject({ step: "understanding", transcript: "Nous serons 30." });
    expect(understanding.lastInput).toEqual({ text: "Nous serons 30.", source: "audio", delivered: false });
  });

  it("lands on the sheet once understood and marks the text as delivered", () => {
    const state = run([
      ...recorded,
      { type: "TRANSCRIBED", transcript: "Nous serons 30." },
      { type: "EXTRACTION_RETURNED" },
      { type: "UNDERSTOOD", snapshot: PARTIAL, applied: true },
    ]);
    expect(state).toMatchObject({ stage: "sheet", think: null });
    expect(state.lastInput?.delivered).toBe(true);
  });

  it("lands on the sheet even when nothing was understood: it is the review screen", () => {
    const state = run([
      ...recorded,
      { type: "TRANSCRIBED", transcript: "Euh…" },
      { type: "UNDERSTOOD", snapshot: EMPTY, applied: true },
    ]);
    expect(state.stage).toBe("sheet");
  });

  it("keeps the text as not delivered after a conflict or a rate limit", () => {
    const state = run([
      ...recorded,
      { type: "TRANSCRIBED", transcript: "Nous serons 30." },
      { type: "UNDERSTOOD", snapshot: PARTIAL, applied: false },
    ]);
    expect(state.stage).toBe("sheet");
    expect(state.lastInput).toMatchObject({ text: "Nous serons 30.", delivered: false });
  });

  it("goes straight to done when the server confirmed (accepted spoken confirmation)", () => {
    const state = run([...recorded, { type: "TRANSCRIBED", transcript: "Oui, je confirme." }, { type: "UNDERSTOOD", snapshot: CONFIRMED, applied: true }]);
    expect(state.stage).toBe("done");
  });

  it("sends an unusable recording back to where it can be recorded again, with the reason", () => {
    const state = run([...recorded, { type: "TRANSCRIPTION_FAILED", kind: "audio", detail: "L'enregistrement est trop long." }]);
    expect(state).toMatchObject({ stage: "ask", think: null, problem: "L'enregistrement est trop long." });
  });

  it("keeps a provider failure of the transcription on the think screen, retryable", () => {
    const state = run([...recorded, { type: "TRANSCRIPTION_FAILED", kind: "retry_same", detail: "Service indisponible." }]);
    expect(state.stage).toBe("think");
    expect(state.think?.failure).toEqual({ step: "transcribing", detail: "Service indisponible.", recovery: "retry" });
  });

  it("offers a new conversation when the conversation no longer exists", () => {
    const state = run([...recorded, { type: "TRANSCRIPTION_FAILED", kind: "not_found", detail: "Conversation introuvable." }]);
    expect(state.think?.failure?.recovery).toBe("restart");
  });

  it("offers no retry for a failure that repeating cannot fix", () => {
    const state = run([...recorded, { type: "TRANSCRIPTION_FAILED", kind: "other", detail: "Requête invalide." }]);
    expect(state.think?.failure?.recovery).toBeNull();
  });

  it("keeps an extraction failure on the think screen with the transcript", () => {
    const state = run([
      ...recorded,
      { type: "TRANSCRIBED", transcript: "Nous serons 30." },
      { type: "EXTRACTION_RETURNED" },
      { type: "EXTRACTION_FAILED", detail: "Désolé.", recovery: "retry" },
    ]);
    expect(state.stage).toBe("think");
    expect(state.think).toMatchObject({
      step: "understanding",
      transcript: "Nous serons 30.",
      settling: false,
      failure: { step: "understanding", detail: "Désolé.", recovery: "retry" },
    });
  });

  it("clears the failure when a retry starts and can then succeed", () => {
    const failed = run([
      ...recorded,
      { type: "TRANSCRIBED", transcript: "Nous serons 30." },
      { type: "EXTRACTION_FAILED", detail: "Désolé.", recovery: "retry" },
    ]);
    const retrying = voiceFlowReducer(failed, { type: "RETRY_STARTED" });
    expect(retrying.think).toMatchObject({ failure: null, transcript: "Nous serons 30." });
    const settled = run([{ type: "EXTRACTION_RETURNED" }, { type: "UNDERSTOOD", snapshot: PARTIAL, applied: true }], retrying);
    expect(settled.stage).toBe("sheet");
  });

  it("abandoning a failed analysis returns to the question with the text ready to edit", () => {
    const state = run([
      ...recorded,
      { type: "TRANSCRIBED", transcript: "Nous serons 30." },
      { type: "EXTRACTION_FAILED", detail: "Désolé.", recovery: "retry" },
      { type: "THINK_ABANDONED" },
    ]);
    expect(state).toMatchObject({ stage: "ask", think: null, textEntryOpen: true });
    expect(state.lastInput).toMatchObject({ text: "Nous serons 30.", delivered: false });
  });

  it("cannot be abandoned while a request is still running", () => {
    const state = run(recorded);
    expect(voiceFlowReducer(state, { type: "THINK_ABANDONED" })).toBe(state);
  });

  it("is not interrupted by a server update", () => {
    const state = run(recorded);
    expect(voiceFlowReducer(state, { type: "SERVER_STATE", snapshot: CONFIRMED })).toBe(state);
  });

  it("ignores pipeline events that arrive in another stage", () => {
    const ask = run([booted()]);
    for (const event of [
      { type: "RECORDED" },
      { type: "TRANSCRIBED", transcript: "x" },
      { type: "TRANSCRIPTION_FAILED", kind: "audio", detail: "x" },
      { type: "EXTRACTION_RETURNED" },
      { type: "EXTRACTION_FAILED", detail: "x", recovery: null },
      { type: "UNDERSTOOD", snapshot: PARTIAL, applied: true },
      { type: "RETRY_STARTED" },
      { type: "LISTEN_DISCARDED", reason: "cancelled" },
      { type: "CAPTURE_FAILED", kind: "denied" },
    ] as VoiceFlowEvent[]) {
      expect(voiceFlowReducer(ask, event)).toBe(ask);
    }
  });
});

describe("voiceFlowReducer — text path", () => {
  it("opens and closes the text field on the question", () => {
    const open = run([booted(), { type: "TEXT_ENTRY_OPENED" }]);
    expect(open.textEntryOpen).toBe(true);
    expect(voiceFlowReducer(open, { type: "TEXT_ENTRY_CLOSED" }).textEntryOpen).toBe(false);
  });

  it("sends typed text straight to understanding: one step, no transcription", () => {
    const state = run([booted(), { type: "TEXT_ENTRY_OPENED" }, { type: "TEXT_SUBMITTED", text: "Nous serons 30." }]);
    expect(state).toMatchObject({ stage: "think", origin: "ask", textEntryOpen: false });
    expect(state.think).toMatchObject({ step: "understanding", source: "text", transcript: "Nous serons 30." });
  });

  it("re-sends a corrected transcript from the sheet and returns there", () => {
    const state = run([booted(PARTIAL), { type: "TEXT_SUBMITTED", text: "Retour avant 17 h." }]);
    expect(state).toMatchObject({ stage: "think", origin: "sheet" });
    expect(run([{ type: "EXTRACTION_FAILED", detail: "x", recovery: null }, { type: "THINK_ABANDONED" }], state)).toMatchObject({
      stage: "sheet",
      textEntryOpen: false,
    });
  });

  it("opens the sheet from the question to fill it by hand", () => {
    expect(run([booted(), { type: "SHEET_OPENED" }]).stage).toBe("sheet");
  });
});

describe("voiceFlowReducer — confirmation", () => {
  it("enters done only when the server says the trip is confirmed", () => {
    const sheet = run([booted(PARTIAL)]);
    expect(voiceFlowReducer(sheet, { type: "SERVER_STATE", snapshot: PARTIAL }).stage).toBe("sheet");
    expect(voiceFlowReducer(sheet, { type: "SERVER_STATE", snapshot: CONFIRMED }).stage).toBe("done");
  });

  it("lets the teacher review a confirmed sheet and return to the confirmation", () => {
    const reviewing = run([booted(CONFIRMED), { type: "MODIFY_REQUESTED" }]);
    expect(reviewing).toMatchObject({ stage: "sheet", reviewing: true });
    // The same confirmed state arriving again must not throw the teacher out of the sheet.
    expect(voiceFlowReducer(reviewing, { type: "SERVER_STATE", snapshot: CONFIRMED })).toBe(reviewing);
    expect(voiceFlowReducer(reviewing, { type: "CONFIRMATION_REOPENED" })).toMatchObject({ stage: "done", reviewing: false });
  });

  it("requires a new confirmation after a confirmed sheet was edited", () => {
    const edited = run([booted(CONFIRMED), { type: "MODIFY_REQUESTED" }, { type: "SERVER_STATE", snapshot: PARTIAL }]);
    expect(edited).toMatchObject({ stage: "sheet", reviewing: false });
    expect(voiceFlowReducer(edited, { type: "SERVER_STATE", snapshot: CONFIRMED }).stage).toBe("done");
  });

  it("leaves done when the server reopened the trip", () => {
    expect(run([booted(CONFIRMED), { type: "SERVER_STATE", snapshot: PARTIAL }])).toMatchObject({ stage: "sheet" });
  });
});

describe("voiceFlowReducer — reset and notices", () => {
  it("starts over on a new trip but remembers that there is no microphone", () => {
    const state = run([
      booted(),
      { type: "LISTEN_STARTED" },
      { type: "CAPTURE_FAILED", kind: "no_microphone" },
      { type: "TEXT_SUBMITTED", text: "x" },
      { type: "RESET" },
    ]);
    expect(state).toMatchObject({ stage: "ask", booted: false, mic: "unavailable", lastInput: null, think: null });
    expect(voiceFlowReducer(state, booted(EMPTY))).toMatchObject({ stage: "ask", booted: true });
  });

  it("dismisses hints, problems and microphone notices", () => {
    const state: VoiceFlowState = { ...run([booted()]), hint: "too_short", problem: "x", micNotice: "denied" };
    const cleared = run([{ type: "HINT_DISMISSED" }, { type: "PROBLEM_DISMISSED" }, { type: "MIC_NOTICE_DISMISSED" }], state);
    expect(cleared).toMatchObject({ hint: null, problem: null, micNotice: null });
  });

  it("flags an unsupported browser before any attempt", () => {
    expect(run([{ type: "MIC_UNSUPPORTED" }])).toMatchObject({ mic: "unavailable", micNotice: "unsupported" });
  });
});

// ---------------------------------------------------------------------------------------
// The hook: effects around the reducer, against a fake ConversationService.
// ---------------------------------------------------------------------------------------

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

const partial = () =>
  response({
    version: 1,
    assistant_message: "De quelle gare souhaitez-vous partir ?",
    requirements: { participants_count: 30, departure_station: null, departure: null, return: null, teaching_type: null },
    missing_fields: ["departure_station", "departure", "return", "teaching_type"],
  });

function makeService(overrides: Partial<ConversationService> = {}): ConversationService {
  return {
    getConfig: vi.fn(async () => ({ max_audio_seconds: 90, max_audio_bytes: 1_000_000, max_message_chars: 500, timezone: "Europe/Paris" })),
    create: vi.fn(async () => response()),
    get: vi.fn(async () => response()),
    sendMessage: vi.fn<ConversationService["sendMessage"]>(async () => partial()),
    sendAudio: vi.fn(async () => response({ assistant_message: null, transcript: "Nous serons 30." })),
    editField: vi.fn(async () => partial()),
    confirm: vi.fn(async () => response({ state: "CONFIRMED" })),
    exportConfirmed: vi.fn(),
    ...overrides,
  };
}

function recording(): { blob: Blob; durationMs: number; endedBy: "user"; synthetic: boolean } {
  return { blob: new Blob(["audio-bytes"], { type: "audio/webm" }), durationMs: 1_500, endedBy: "user", synthetic: false };
}

async function mountFlow(service: ConversationService) {
  const hook = renderHook(() => useVoiceFlow(service, { allowSyntheticCapture: true }));
  await waitFor(() => expect(hook.result.current.state.booted).toBe(true));
  return hook;
}

describe("useVoiceFlow", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("lands on the question for a new conversation", async () => {
    const { result } = await mountFlow(makeService());
    expect(result.current.state.stage).toBe("ask");
  });

  it("restores a stored conversation on the sheet, and a confirmed one on done", async () => {
    window.localStorage.setItem("lio.conversation_id", "conv_test");
    const sheet = await mountFlow(makeService({ get: vi.fn(async () => partial()) }));
    expect(sheet.result.current.state.stage).toBe("sheet");
    sheet.unmount();

    const done = await mountFlow(makeService({ get: vi.fn(async () => response({ state: "CONFIRMED", missing_fields: [] })) }));
    expect(done.result.current.state.stage).toBe("done");
  });

  it("chains transcription then extraction with source audio and lands on the sheet", async () => {
    const service = makeService();
    const { result } = await mountFlow(service);

    act(() => result.current.listen.started());
    expect(result.current.state.stage).toBe("listen");
    act(() => result.current.listen.recorded(recording()));
    expect(result.current.state.think?.step).toBe("transcribing");

    await waitFor(() => expect(result.current.state.stage).toBe("sheet"));
    expect(service.sendAudio).toHaveBeenCalledTimes(1);
    expect(service.sendMessage).toHaveBeenCalledWith("conv_test", expect.objectContaining({ content: "Nous serons 30.", source: "audio" }));
    expect(result.current.state.lastInput).toEqual({ text: "Nous serons 30.", source: "audio", delivered: true });
  });

  it("retries a failed extraction with the same client_message_id and never transcribes again", async () => {
    const sendMessage = vi
      .fn<ConversationService["sendMessage"]>()
      .mockRejectedValueOnce(new ApiError(502, "Fournisseur", "Désolé, je n'ai pas pu traiter votre message.", "PROVIDER_ERROR"))
      .mockResolvedValueOnce(partial());
    const service = makeService({ sendMessage });
    const { result } = await mountFlow(service);

    act(() => result.current.listen.started());
    act(() => result.current.listen.recorded(recording()));
    await waitFor(() => expect(result.current.state.think?.failure).not.toBeNull());
    expect(result.current.state.stage).toBe("think");
    expect(result.current.state.think).toMatchObject({
      step: "understanding",
      transcript: "Nous serons 30.",
      failure: { step: "understanding", detail: "Désolé, je n'ai pas pu traiter votre message.", recovery: "retry" },
    });

    act(() => result.current.retryThink());
    await waitFor(() => expect(result.current.state.stage).toBe("sheet"));

    expect(sendMessage).toHaveBeenCalledTimes(2);
    const first = sendMessage.mock.calls[0]?.[1];
    const second = sendMessage.mock.calls[1]?.[1];
    expect(second?.client_message_id).toBe(first?.client_message_id);
    expect(second).toEqual(first);
    // The teacher was not asked to speak again: one upload only.
    expect(service.sendAudio).toHaveBeenCalledTimes(1);
    expect(result.current.state.lastInput?.delivered).toBe(true);
  });

  it("retries a failed transcription with the very same recording", async () => {
    const sendAudio = vi
      .fn<ConversationService["sendAudio"]>()
      .mockRejectedValueOnce(new ApiError(504, "Délai", "La transcription a pris trop de temps.", "PROVIDER_TIMEOUT"))
      .mockResolvedValueOnce(response({ assistant_message: null, transcript: "Nous serons 30." }));
    const service = makeService({ sendAudio });
    const { result } = await mountFlow(service);
    const taken = recording();

    act(() => result.current.listen.started());
    act(() => result.current.listen.recorded(taken));
    await waitFor(() => expect(result.current.state.think?.failure?.step).toBe("transcribing"));
    expect(result.current.state.think?.failure?.recovery).toBe("retry");
    expect(service.sendMessage).not.toHaveBeenCalled();

    act(() => result.current.retryThink());
    await waitFor(() => expect(result.current.state.stage).toBe("sheet"));
    expect(sendAudio).toHaveBeenCalledTimes(2);
    expect(sendAudio.mock.calls[0]?.[1]).toBe(taken.blob);
    expect(sendAudio.mock.calls[1]?.[1]).toBe(taken.blob);
  });

  it("returns to the question with the server's reason when the recording is unusable", async () => {
    const service = makeService({
      sendAudio: vi.fn(async () => {
        throw new ApiError(413, "Trop long", "L'enregistrement dépasse 2 minutes.", "AUDIO_TOO_LONG");
      }),
    });
    const { result } = await mountFlow(service);

    act(() => result.current.listen.started());
    act(() => result.current.listen.recorded(recording()));
    await waitFor(() => expect(result.current.state.stage).toBe("ask"));
    expect(result.current.state.problem).toBe("L'enregistrement dépasse 2 minutes.");
    expect(service.sendMessage).not.toHaveBeenCalled();
  });

  it("lands on the sheet with a notice and the text kept after a version conflict", async () => {
    const service = makeService({
      sendMessage: vi.fn(async () => {
        throw new ApiError(409, "Version obsolète", "Les informations ont été modifiées entre-temps.", "VERSION_CONFLICT");
      }),
      get: vi.fn(async () => partial()),
    });
    const { result } = await mountFlow(service);

    act(() => result.current.submitText("Nous serons 30."));
    await waitFor(() => expect(result.current.state.stage).toBe("sheet"));
    expect(result.current.conversation.notice).toBe("Les informations ont été modifiées entre-temps.");
    expect(result.current.state.lastInput).toEqual({ text: "Nous serons 30.", source: "text", delivered: false });
  });

  it("sends typed text with source text, without any audio call", async () => {
    const service = makeService();
    const { result } = await mountFlow(service);

    act(() => result.current.submitText("  Nous serons 30.  "));
    expect(result.current.state.think).toMatchObject({ step: "understanding", source: "text", transcript: "Nous serons 30." });
    await waitFor(() => expect(result.current.state.stage).toBe("sheet"));
    expect(service.sendAudio).not.toHaveBeenCalled();
    expect(service.sendMessage).toHaveBeenCalledWith("conv_test", expect.objectContaining({ content: "Nous serons 30.", source: "text" }));
  });

  it("ignores empty text", async () => {
    const service = makeService();
    const { result } = await mountFlow(service);
    act(() => result.current.submitText("   "));
    expect(result.current.state.stage).toBe("ask");
    expect(service.sendMessage).not.toHaveBeenCalled();
  });

  it("confirms only through the explicit action, then follows the server to done", async () => {
    window.localStorage.setItem("lio.conversation_id", "conv_test");
    const ready = response({ state: "AWAITING_CONFIRMATION", version: 4, missing_fields: [], ready_for_confirmation: true });
    const service = makeService({
      get: vi.fn(async () => ready),
      confirm: vi.fn(async () => ({ ...ready, state: "CONFIRMED" as const, ready_for_confirmation: false })),
    });
    const { result } = await mountFlow(service);
    expect(result.current.state.stage).toBe("sheet");
    expect(service.confirm).not.toHaveBeenCalled();

    act(() => result.current.confirm());
    await waitFor(() => expect(result.current.state.stage).toBe("done"));
    expect(service.confirm).toHaveBeenCalledWith("conv_test", 4);
  });

  it("starts a new trip from done", async () => {
    window.localStorage.setItem("lio.conversation_id", "conv_test");
    const service = makeService({ get: vi.fn(async () => response({ state: "CONFIRMED", missing_fields: [] })) });
    const { result } = await mountFlow(service);
    expect(result.current.state.stage).toBe("done");

    act(() => result.current.restart());
    await waitFor(() => expect(result.current.state).toMatchObject({ stage: "ask", booted: true }));
    expect(service.create).toHaveBeenCalledTimes(1);
  });
});

describe("snapshotOf", () => {
  it("reads confirmation and known fields from the server response", () => {
    expect(snapshotOf(response())).toEqual({ confirmed: false, anyKnown: false });
    expect(snapshotOf(partial())).toEqual({ confirmed: false, anyKnown: true });
    expect(snapshotOf(response({ state: "CONFIRMED" })).confirmed).toBe(true);
  });

  it("counts a partially understood field so it is shown on the sheet", () => {
    const dateOnly = response({
      requirements: {
        participants_count: null,
        departure_station: null,
        departure: { date: "2026-11-12", time: null, constraint: null },
        return: null,
        teaching_type: null,
      },
    });
    expect(snapshotOf(dateOnly).anyKnown).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------
// The journey after confirmation: the stage is the server's `journey.stage`.
// ---------------------------------------------------------------------------------------

const SERVER_STAGES: JourneyStage[] = [
  "destinations",
  "itineraries",
  "adjustments",
  "no_match",
  "review",
  "booking_pending",
  "booked",
  "booking_refused",
  "closed",
];
const OPEN_STAGES: JourneyStage[] = ["destinations", "itineraries", "adjustments", "no_match", "review", "booking_refused"];
const LOCKED_STAGES: JourneyStage[] = ["booking_pending", "booked", "closed"];

const journeyAt = (stage: JourneyStage | null): VoiceFlowEvent => ({ type: "JOURNEY_STATE", stage });
/** A confirmed conversation whose journey is on `stage`. */
const onJourney = (stage: JourneyStage): VoiceFlowState => run([booted(CONFIRMED), journeyAt(stage)]);

describe("voiceFlowReducer — journey stages", () => {
  it.each(SERVER_STAGES)("restores a journey in progress on its stage: %s", (stage) => {
    expect(onJourney(stage)).toMatchObject({ stage, journeyStage: stage, reviewing: false, searchRestart: false });
  });

  it("stays on done while there is no journey", () => {
    const state = run([booted(CONFIRMED), journeyAt(null)]);
    expect(state).toMatchObject({ stage: "done", journeyStage: null });
    // Nothing changed: the same object comes back.
    expect(voiceFlowReducer(state, journeyAt(null))).toBe(state);
  });

  it("follows every answer of the server, from the search to the end", () => {
    const path: JourneyStage[] = ["destinations", "itineraries", "review", "booking_pending", "booked", "closed"];
    let state = run([booted(CONFIRMED)]);
    for (const stage of path) {
      state = voiceFlowReducer(state, journeyAt(stage));
      expect(state.stage).toBe(stage);
    }
  });

  it("follows the branches: adjustments, no match, refusal", () => {
    expect(run([journeyAt("adjustments")], onJourney("destinations")).stage).toBe("adjustments");
    expect(run([journeyAt("itineraries")], onJourney("adjustments")).stage).toBe("itineraries");
    expect(run([journeyAt("no_match")], onJourney("destinations")).stage).toBe("no_match");
    expect(run([journeyAt("booking_refused")], onJourney("booking_pending")).stage).toBe("booking_refused");
    expect(run([journeyAt("review")], onJourney("booking_refused")).stage).toBe("review");
  });

  it("keeps the journey stage when an accepted adjustment refreshes the confirmed requirements", () => {
    const state = onJourney("itineraries");
    expect(voiceFlowReducer(state, booted(CONFIRMED))).toBe(state);
  });

  it("knows which stages belong to the journey and which are still open to a change", () => {
    for (const stage of [...SERVER_STAGES, "travel_file", "feedback"] as const) expect(isJourneyStage(stage)).toBe(true);
    for (const stage of ["ask", "listen", "think", "sheet", "done", "loading"] as const) expect(isJourneyStage(stage)).toBe(false);
    for (const stage of OPEN_STAGES) expect(isOpenJourneyStage(stage)).toBe(true);
    for (const stage of LOCKED_STAGES) expect(isOpenJourneyStage(stage)).toBe(false);
    expect(isOpenJourneyStage(null)).toBe(false);
  });
});

describe("voiceFlowReducer — changing one's mind during the journey", () => {
  it.each(OPEN_STAGES)("goes back to the destinations from %s, the server's stage unchanged", (stage) => {
    const state = run([{ type: "DESTINATIONS_REQUESTED" }], onJourney(stage));
    expect(state).toMatchObject({ stage: "destinations", journeyStage: stage });
  });

  it.each(LOCKED_STAGES)("does not go back to the destinations once a booking request exists: %s", (stage) => {
    const state = onJourney(stage);
    expect(voiceFlowReducer(state, { type: "DESTINATIONS_REQUESTED" })).toBe(state);
    expect(voiceFlowReducer(state, { type: "MODIFY_REQUESTED" })).toBe(state);
  });

  it("returns from the destinations to the server's stage without choosing", () => {
    const state = run([{ type: "DESTINATIONS_REQUESTED" }, { type: "JOURNEY_VIEW_CLOSED" }], onJourney("review"));
    expect(state).toMatchObject({ stage: "review", journeyStage: "review" });
  });

  it("lands on the server's stage after a new choice, even when that stage is the same as before", () => {
    // Looking at the destinations from the itineraries, then choosing one: itineraries again.
    const state = run([{ type: "DESTINATIONS_REQUESTED" }, journeyAt("itineraries")], onJourney("itineraries"));
    expect(state.stage).toBe("itineraries");
  });

  it("looks at the itineraries again from the review only", () => {
    expect(run([{ type: "ITINERARIES_REQUESTED" }], onJourney("review"))).toMatchObject({ stage: "itineraries", journeyStage: "review" });
    for (const stage of SERVER_STAGES.filter((item) => item !== "review")) {
      const state = onJourney(stage);
      expect(voiceFlowReducer(state, { type: "ITINERARIES_REQUESTED" })).toBe(state);
    }
  });

  it.each(OPEN_STAGES)("opens the sheet of the confirmed request from %s and comes back to it untouched", (stage) => {
    const sheet = run([{ type: "MODIFY_REQUESTED" }], onJourney(stage));
    expect(sheet).toMatchObject({ stage: "sheet", reviewing: true, journeyStage: stage, searchRestart: false });
    expect(voiceFlowReducer(sheet, { type: "CONFIRMATION_REOPENED" })).toMatchObject({ stage, reviewing: false });
  });

  it("opens the sheet from the destinations looked at again, and comes back to the server's stage", () => {
    const sheet = run([{ type: "DESTINATIONS_REQUESTED" }, { type: "MODIFY_REQUESTED" }], onJourney("review"));
    expect(sheet).toMatchObject({ stage: "sheet", reviewing: true });
    expect(voiceFlowReducer(sheet, { type: "CONFIRMATION_REOPENED" }).stage).toBe("review");
  });

  it("only remembers an answer of the server while the sheet is open", () => {
    const sheet = run([{ type: "MODIFY_REQUESTED" }, journeyAt("itineraries")], onJourney("review"));
    expect(sheet).toMatchObject({ stage: "sheet", reviewing: true, journeyStage: "itineraries" });
  });

  it("does not record from a journey stage: speech goes through the sheet", () => {
    const state = onJourney("destinations");
    expect(voiceFlowReducer(state, { type: "LISTEN_STARTED" })).toBe(state);
    expect(voiceFlowReducer(state, { type: "TEXT_SUBMITTED", text: "plutôt 18 h" })).toBe(state);
  });
});

describe("voiceFlowReducer — the journey is dropped with the confirmation", () => {
  it.each(OPEN_STAGES)("an edit on the sheet clears the journey of %s and says the search restarts", (stage) => {
    const edited = run([{ type: "MODIFY_REQUESTED" }, booted(PARTIAL)], onJourney(stage));
    expect(edited).toMatchObject({ stage: "sheet", reviewing: false, searchRestart: true });
    // The server dropped the journey: nothing of it is left.
    const cleared = voiceFlowReducer(edited, journeyAt(null));
    expect(cleared).toMatchObject({ stage: "sheet", journeyStage: null, searchRestart: true });
    expect(isJourneyStage(cleared.stage)).toBe(false);
  });

  it.each(SERVER_STAGES)("a confirmation lost while on %s lands on the sheet with the notice", (stage) => {
    const state = run([booted(PARTIAL), journeyAt(null)], onJourney(stage));
    expect(state).toMatchObject({ stage: "sheet", journeyStage: null, reviewing: false, searchRestart: true });
  });

  it("leaves the local views too", () => {
    for (const event of [{ type: "TRAVEL_FILE_OPENED" }, { type: "FEEDBACK_OPENED" }] as const) {
      const state = run([event, booted(PARTIAL), journeyAt(null)], onJourney("booked"));
      expect(state).toMatchObject({ stage: "sheet", journeyStage: null });
    }
  });

  it("confirming again leads to done, without journey and without notice", () => {
    const state = run([{ type: "MODIFY_REQUESTED" }, booted(PARTIAL), journeyAt(null), booted(CONFIRMED)], onJourney("review"));
    expect(state).toMatchObject({ stage: "done", journeyStage: null, searchRestart: false, reviewing: false });
  });

  it("the notice can be closed", () => {
    const state = run([{ type: "MODIFY_REQUESTED" }, booted(PARTIAL), journeyAt(null), { type: "SEARCH_RESTART_DISMISSED" }], onJourney("review"));
    expect(state).toMatchObject({ stage: "sheet", searchRestart: false });
    expect(voiceFlowReducer(state, { type: "SEARCH_RESTART_DISMISSED" })).toBe(state);
  });

  it("a spoken change from the sheet behaves like an edit", () => {
    const state = run(
      [
        { type: "MODIFY_REQUESTED" },
        { type: "LISTEN_STARTED" },
        { type: "RECORDED" },
        { type: "TRANSCRIBED", transcript: "plutôt un retour à 18 h" },
        // The server answers while the analysis is still on screen: remembered, not shown.
        booted(PARTIAL),
        journeyAt(null),
        { type: "EXTRACTION_RETURNED" },
        { type: "UNDERSTOOD", snapshot: PARTIAL, applied: true },
      ],
      onJourney("itineraries"),
    );
    expect(state).toMatchObject({ stage: "sheet", journeyStage: null, reviewing: false, searchRestart: true });
  });

  it("a message that leaves the confirmation untouched returns to the journey", () => {
    const state = run(
      [{ type: "MODIFY_REQUESTED" }, { type: "TEXT_SUBMITTED", text: "merci" }, { type: "EXTRACTION_RETURNED" }, { type: "UNDERSTOOD", snapshot: CONFIRMED, applied: true }],
      onJourney("itineraries"),
    );
    expect(state).toMatchObject({ stage: "itineraries", reviewing: false, searchRestart: false });
  });

  it("a journey that disappears while the request is still confirmed returns to done", () => {
    expect(run([journeyAt(null)], onJourney("destinations"))).toMatchObject({ stage: "done", journeyStage: null, searchRestart: false });
  });

  it("a new trip forgets the journey and the notice", () => {
    const state = run([{ type: "MODIFY_REQUESTED" }, booted(PARTIAL), { type: "RESET" }], onJourney("review"));
    expect(state).toMatchObject({ stage: "ask", booted: false, journeyStage: null, searchRestart: false });
    // The journey vanishing after the reset is not a changed request.
    expect(voiceFlowReducer(state, journeyAt(null)).searchRestart).toBe(false);
  });
});

describe("voiceFlowReducer — after the booking", () => {
  it("opens the travel file of a confirmed booking, and of a closed journey", () => {
    expect(run([{ type: "TRAVEL_FILE_OPENED" }], onJourney("booked"))).toMatchObject({ stage: "travel_file", journeyStage: "booked" });
    expect(run([{ type: "TRAVEL_FILE_OPENED" }], onJourney("closed"))).toMatchObject({ stage: "travel_file", journeyStage: "closed" });
    for (const stage of SERVER_STAGES.filter((item) => item !== "booked" && item !== "closed")) {
      const state = onJourney(stage);
      expect(voiceFlowReducer(state, { type: "TRAVEL_FILE_OPENED" })).toBe(state);
    }
  });

  it("asks for feedback once the booking is confirmed, and only then", () => {
    expect(run([{ type: "FEEDBACK_OPENED" }], onJourney("booked")).stage).toBe("feedback");
    expect(run([{ type: "TRAVEL_FILE_OPENED" }, { type: "FEEDBACK_OPENED" }], onJourney("booked")).stage).toBe("feedback");
    for (const stage of SERVER_STAGES.filter((item) => item !== "booked")) {
      const state = onJourney(stage);
      expect(voiceFlowReducer(state, { type: "FEEDBACK_OPENED" })).toBe(state);
    }
  });

  it("returns from the file or the feedback to the server's stage", () => {
    expect(run([{ type: "TRAVEL_FILE_OPENED" }, { type: "JOURNEY_VIEW_CLOSED" }], onJourney("booked")).stage).toBe("booked");
    expect(run([{ type: "FEEDBACK_OPENED" }, { type: "JOURNEY_VIEW_CLOSED" }], onJourney("booked")).stage).toBe("booked");
    expect(run([{ type: "TRAVEL_FILE_OPENED" }, { type: "JOURNEY_VIEW_CLOSED" }], onJourney("closed")).stage).toBe("closed");
  });

  it("closes when the server has recorded the feedback", () => {
    expect(run([{ type: "FEEDBACK_OPENED" }, journeyAt("closed")], onJourney("booked"))).toMatchObject({ stage: "closed", journeyStage: "closed" });
  });

  it("ignores journey events outside the journey", () => {
    const sheet = run([booted(PARTIAL)]);
    for (const type of ["DESTINATIONS_REQUESTED", "ITINERARIES_REQUESTED", "TRAVEL_FILE_OPENED", "FEEDBACK_OPENED", "JOURNEY_VIEW_CLOSED"] as const) {
      expect(voiceFlowReducer(sheet, { type })).toBe(sheet);
    }
  });
});

describe("useVoiceFlow — journey", () => {
  const confirmed = () => response({ state: "CONFIRMED", version: 4, missing_fields: [] });
  const withPlanner = (mode: "off" | "simulated" | "http" | undefined, overrides: Partial<ConversationService> = {}) =>
    makeService({
      getConfig: vi.fn(async () => ({
        max_audio_seconds: 90,
        max_audio_bytes: 1_000_000,
        max_message_chars: 500,
        timezone: "Europe/Paris",
        ...(mode ? { planner_mode: mode } : {}),
      })),
      get: vi.fn(async () => confirmed()),
      ...overrides,
    });

  async function mountJourney(service: ConversationService, journeyService = fakeJourneyService()) {
    window.localStorage.setItem("lio.conversation_id", "conv_test");
    const hook = renderHook(() => useVoiceFlow(service, { allowSyntheticCapture: true, journeyService }));
    await waitFor(() => expect(hook.result.current.state.booted).toBe(true));
    return { ...hook, journeyService };
  }

  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["off", undefined] as const)("offers no search when the planner mode is %s, and never calls the journey service", async (mode) => {
    const { result, journeyService } = await mountJourney(withPlanner(mode));
    expect(result.current.state.stage).toBe("done");
    expect(result.current.planner.available).toBe(false);
    expect(journeyService.get).not.toHaveBeenCalled();
  });

  it("offers the search in simulated mode, and the scenarios with it", async () => {
    const { result, journeyService } = await mountJourney(withPlanner("simulated"));
    await waitFor(() => expect(result.current.planner).toEqual({ available: true, simulated: true, ready: true }));
    expect(result.current.state.stage).toBe("done");

    act(() => result.current.search({ search_scenario: "adjustments", booking_scenario: "refused" }));
    await waitFor(() => expect(result.current.state.stage).toBe("destinations"));
    expect(journeyService.start).toHaveBeenCalledWith("conv_test", { search_scenario: "adjustments", booking_scenario: "refused" });
  });

  it("offers the search without scenarios when the real planner is announced", async () => {
    const { result } = await mountJourney(withPlanner("http"));
    await waitFor(() => expect(result.current.planner).toEqual({ available: true, simulated: false, ready: true }));
  });

  it("restores a journey in progress on the server's stage", async () => {
    const journeyService = fakeJourneyService({ get: vi.fn(async () => reviewJourney()) });
    const { result } = await mountJourney(withPlanner("simulated"), journeyService);
    await waitFor(() => expect(result.current.state.stage).toBe("review"));
    expect(result.current.journey.journey?.selected_itinerary_id).toBe("iti_9f11c4f37d");
  });

  it("keeps a technical failure of the search apart from a result: still on done, with the server's words and a retry", async () => {
    const start = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(502, "Planification", "La recherche a rencontré un problème technique.", "PLANNER_ERROR"))
      .mockResolvedValueOnce(itinerariesJourney({ stage: "destinations" }));
    const { result } = await mountJourney(withPlanner("simulated"), fakeJourneyService({ start }));
    await waitFor(() => expect(result.current.planner.ready).toBe(true));

    act(() => result.current.search({ search_scenario: "error" }));
    await waitFor(() => expect(result.current.journey.error).not.toBeNull());
    expect(result.current.state.stage).toBe("done");
    expect(result.current.journey.error).toMatchObject({ code: "PLANNER_ERROR", detail: "La recherche a rencontré un problème technique.", action: "start" });
    expect(result.current.journey.journey).toBeNull();

    await act(async () => {
      await result.current.journey.error?.retry?.();
    });
    await waitFor(() => expect(result.current.state.stage).toBe("destinations"));
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("re-reads the conversation after an accepted adjustment, and stays on the journey", async () => {
    const get = vi
      .fn<ConversationService["get"]>()
      .mockResolvedValueOnce(confirmed())
      .mockResolvedValue(response({ state: "CONFIRMED", version: 5, missing_fields: [] }));
    const journeyService = fakeJourneyService({ get: vi.fn(async () => adjustmentsJourney()) });
    const { result } = await mountJourney(withPlanner("simulated", { get }), journeyService);
    await waitFor(() => expect(result.current.state.stage).toBe("adjustments"));
    expect(get).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.journey.acceptAdjustment("adj_762b46e27f");
    });
    expect(journeyService.acceptAdjustment).toHaveBeenCalledWith("conv_test", "adj_762b46e27f");
    expect(get).toHaveBeenCalledTimes(2);
    expect(result.current.conversation.conversation?.version).toBe(5);
    expect(result.current.state.stage).toBe("itineraries");
    // Still confirmed: the journey was not looked up again, nor dropped.
    expect(journeyService.get).toHaveBeenCalledTimes(1);
  });

  it("drops the journey when a requirement is edited, and lands on the sheet with the notice", async () => {
    const editField = vi.fn(async () => response({ state: "AWAITING_CONFIRMATION", version: 5, missing_fields: [], ready_for_confirmation: true }));
    const journeyService = fakeJourneyService({ get: vi.fn(async () => itinerariesJourney()) });
    const { result } = await mountJourney(withPlanner("simulated", { editField }), journeyService);
    await waitFor(() => expect(result.current.state.stage).toBe("itineraries"));

    act(() => result.current.modify());
    expect(result.current.state).toMatchObject({ stage: "sheet", reviewing: true });
    // Looking is not editing: the journey is still there.
    expect(result.current.journey.journey).not.toBeNull();

    await act(async () => {
      await result.current.conversation.editField("participants_count", 31);
    });
    await waitFor(() => expect(result.current.journey.journey).toBeNull());
    expect(result.current.state).toMatchObject({ stage: "sheet", reviewing: false, journeyStage: null, searchRestart: true });
  });

  it("checks a waiting booking once by itself after the delay, then leaves it to the teacher", async () => {
    const checkBooking = vi.fn(async () => pendingJourney());
    const journeyService = fakeJourneyService({ get: vi.fn(async () => reviewJourney()), checkBooking });
    const { result } = await mountJourney(withPlanner("simulated"), journeyService);
    await waitFor(() => expect(result.current.state.stage).toBe("review"));

    vi.useFakeTimers();
    await act(async () => {
      await result.current.journey.submitBooking();
    });
    expect(result.current.state.stage).toBe("booking_pending");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOOKING_AUTO_CHECK_MS - 1);
    });
    expect(checkBooking).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(checkBooking).toHaveBeenCalledTimes(1);

    // Still waiting: no polling. The next check is the teacher's.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOOKING_AUTO_CHECK_MS * 10);
    });
    expect(checkBooking).toHaveBeenCalledTimes(1);
    expect(result.current.state.stage).toBe("booking_pending");

    checkBooking.mockResolvedValueOnce(bookedJourney());
    await act(async () => {
      await result.current.journey.checkBooking();
    });
    expect(result.current.state.stage).toBe("booked");
  });

  it("does not check automatically when the teacher has already left the waiting stage", async () => {
    const checkBooking = vi.fn(async () => bookedJourney());
    const journeyService = fakeJourneyService({ get: vi.fn(async () => pendingJourney()), checkBooking });
    const { result } = await mountJourney(withPlanner("simulated"), journeyService);
    await waitFor(() => expect(result.current.state.stage).toBe("booking_pending"));

    vi.useFakeTimers();
    // The teacher is faster than the timer.
    await act(async () => {
      await result.current.journey.checkBooking();
    });
    expect(result.current.state.stage).toBe("booked");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOOKING_AUTO_CHECK_MS * 2);
    });
    expect(checkBooking).toHaveBeenCalledTimes(1);
  });

  it("loads the travel file once, then shows it; feedback closes the journey", async () => {
    const journeyService = fakeJourneyService({ get: vi.fn(async () => bookedJourney()) });
    const { result } = await mountJourney(withPlanner("simulated"), journeyService);
    await waitFor(() => expect(result.current.state.stage).toBe("booked"));

    act(() => result.current.openTravelFile());
    await waitFor(() => expect(result.current.state.stage).toBe("travel_file"));
    expect(result.current.journey.travelFile?.reference).toBe("SIM-050033B9");

    act(() => result.current.closeJourneyView());
    expect(result.current.state.stage).toBe("booked");
    act(() => result.current.openTravelFile());
    expect(result.current.state.stage).toBe("travel_file");
    expect(journeyService.travelFile).toHaveBeenCalledTimes(1);

    act(() => result.current.openFeedback());
    expect(result.current.state.stage).toBe("feedback");
    await act(async () => {
      await result.current.journey.giveFeedback({ rating: 5, comment: null });
    });
    expect(result.current.state.stage).toBe("closed");
  });

  it("stays on the confirmed booking when the travel file cannot be loaded", async () => {
    const travelFile = vi.fn(async () => {
      throw new ApiError(502, "Dossier", "Le dossier de voyage n'a pas pu être préparé.", "PLANNER_ERROR");
    });
    const journeyService = fakeJourneyService({ get: vi.fn(async () => bookedJourney()), travelFile });
    const { result } = await mountJourney(withPlanner("simulated"), journeyService);
    await waitFor(() => expect(result.current.state.stage).toBe("booked"));

    act(() => result.current.openTravelFile());
    await waitFor(() => expect(result.current.journey.error?.action).toBe("travel_file"));
    expect(result.current.state.stage).toBe("booked");
  });

  it("a new trip leaves the journey behind", async () => {
    const journeyService = fakeJourneyService({ get: vi.fn(async () => bookedJourney()) });
    const { result } = await mountJourney(withPlanner("simulated"), journeyService);
    await waitFor(() => expect(result.current.state.stage).toBe("booked"));
    act(() => result.current.restart());
    await waitFor(() => expect(result.current.state.stage).toBe("ask"));
    expect(result.current.journey.journey).toBeNull();
    expect(result.current.state.searchRestart).toBe(false);
  });
});
