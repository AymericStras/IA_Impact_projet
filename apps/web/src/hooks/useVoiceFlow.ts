"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { isCaptureSupported, type CaptureErrorKind, type CaptureResult, type DiscardReason } from "@/hooks/useAudioCapture";
import { useConversation, type UseConversationResult } from "@/hooks/useConversation";
import { useJourney, type UseJourneyResult } from "@/hooks/useJourney";
import { frVoice } from "@/i18n/fr.voice";
import { ApiError, type ConversationService, type ErrorKind, type JourneyService } from "@/services";
import { FIELD_NAMES, type ConversationResponse } from "@/types/contracts";
import type { JourneyScenarios, JourneyStage } from "@/types/journey";

/**
 * Stage machine of the voice flow (`/vocal`).
 *
 * - `voiceFlowReducer` is PURE and holds every transition. To add a stage (e.g. proposals
 *   after `done`): extend `StageId`, add its events to `VoiceFlowEvent` and its cases to the
 *   reducer; the exhaustive `switch` makes the compiler point at what is missing.
 * - `useVoiceFlow` composes `useConversation` (all server state, requests and error kinds)
 *   and runs the effects: transcription, extraction, retries.
 *
 * Business state is never held here: which fields are known, what is asked and whether
 * confirmation is possible are read from the latest `ConversationResponse` by the views.
 *
 * After confirmation the journey (docs/PLANNER_CONTRACT.md) takes over: `useJourney` holds
 * the server's `Journey`, and the stage shown IS the server's `journey.stage`, mirrored in
 * `journeyStage`. The machine only adds what the server has no notion of: looking at the
 * destinations or the itineraries again before choosing (`stage` differs from
 * `journeyStage`), and the travel file / feedback screens of a confirmed booking.
 */

/** Screens of the journey: the server's stages, plus two local views of a confirmed booking. */
export type JourneyStageId = JourneyStage | "travel_file" | "feedback";
export type StageId = "ask" | "listen" | "think" | "sheet" | "done" | JourneyStageId;

const JOURNEY_STAGE_IDS: readonly JourneyStageId[] = [
  "destinations",
  "itineraries",
  "adjustments",
  "no_match",
  "review",
  "booking_pending",
  "booked",
  "booking_refused",
  "closed",
  "travel_file",
  "feedback",
];

export function isJourneyStage(stage: StageId | "loading"): stage is JourneyStageId {
  return (JOURNEY_STAGE_IDS as readonly string[]).includes(stage);
}

/**
 * Stages in which the server still accepts another destination, and in which editing the
 * request makes sense: everything before a booking request is waiting (`_OPEN_STAGES` of
 * the API). Used to OFFER the way back; the server remains the judge.
 */
const OPEN_JOURNEY_STAGES: readonly JourneyStage[] = ["destinations", "itineraries", "adjustments", "no_match", "review", "booking_refused"];

export function isOpenJourneyStage(stage: JourneyStage | null): boolean {
  return stage !== null && OPEN_JOURNEY_STAGES.includes(stage);
}
/** Stages a recording or an analysis starts from and returns to. */
export type RestStage = "ask" | "sheet";
export type InputSource = "audio" | "text";
export type ThinkStep = "transcribing" | "understanding";
export type HintKind = DiscardReason | "empty_recording";
export type MicStatus = "available" | "denied" | "unavailable";
export type MicNotice = "denied" | "no_microphone" | "unsupported";

export interface ThinkFailure {
  step: ThinkStep;
  /** French text to display: the server's `detail` whenever it sent one. */
  detail: string;
  /** "retry" replays the same request; "restart" opens a new conversation. */
  recovery: "retry" | "restart" | null;
}

export interface ThinkState {
  step: ThinkStep;
  source: InputSource;
  /** Shown as soon as it exists, before the sheet arrives. */
  transcript: string | null;
  failure: ThinkFailure | null;
  /** The extraction request has returned; its result is being read from the conversation. */
  settling: boolean;
}

export interface LastInput {
  text: string;
  source: InputSource;
  /** False while the server has not applied this text (failure, conflict, rate limit). */
  delivered: boolean;
}

/** The two facts the machine needs from the server state. */
export interface ServerSnapshot {
  confirmed: boolean;
  anyKnown: boolean;
}

export interface VoiceFlowState {
  stage: StageId;
  /** False until the first server state has chosen the initial stage. */
  booted: boolean;
  origin: RestStage;
  think: ThinkState | null;
  lastInput: LastInput | null;
  hint: HintKind | null;
  mic: MicStatus;
  micNotice: MicNotice | null;
  /** Server detail of an unusable recording (record again). */
  problem: string | null;
  textEntryOpen: boolean;
  /** The teacher came back from `done` or from the journey to look at / edit a confirmed sheet. */
  reviewing: boolean;
  /** The server's `journey.stage`; null when no search is in progress. */
  journeyStage: JourneyStage | null;
  /** A journey was dropped because the request changed: say that the search restarts. */
  searchRestart: boolean;
}

export type VoiceFlowEvent =
  | { type: "SERVER_STATE"; snapshot: ServerSnapshot }
  | { type: "RESET" }
  | { type: "MIC_UNSUPPORTED" }
  | { type: "LISTEN_STARTED" }
  | { type: "LISTEN_DISCARDED"; reason: DiscardReason }
  | { type: "CAPTURE_FAILED"; kind: CaptureErrorKind }
  | { type: "RECORDED" }
  | { type: "TRANSCRIBED"; transcript: string }
  | { type: "TRANSCRIPTION_FAILED"; kind: ErrorKind; detail: string }
  | { type: "TEXT_SUBMITTED"; text: string }
  | { type: "EXTRACTION_RETURNED" }
  | { type: "EXTRACTION_FAILED"; detail: string; recovery: ThinkFailure["recovery"] }
  | { type: "UNDERSTOOD"; snapshot: ServerSnapshot; applied: boolean }
  | { type: "RETRY_STARTED" }
  | { type: "THINK_ABANDONED" }
  | { type: "TEXT_ENTRY_OPENED" }
  | { type: "TEXT_ENTRY_CLOSED" }
  | { type: "SHEET_OPENED" }
  | { type: "MODIFY_REQUESTED" }
  | { type: "CONFIRMATION_REOPENED" }
  | { type: "JOURNEY_STATE"; stage: JourneyStage | null }
  | { type: "DESTINATIONS_REQUESTED" }
  | { type: "ITINERARIES_REQUESTED" }
  | { type: "TRAVEL_FILE_OPENED" }
  | { type: "FEEDBACK_OPENED" }
  | { type: "JOURNEY_VIEW_CLOSED" }
  | { type: "SEARCH_RESTART_DISMISSED" }
  | { type: "HINT_DISMISSED" }
  | { type: "PROBLEM_DISMISSED" }
  | { type: "MIC_NOTICE_DISMISSED" };

export const initialVoiceFlowState: VoiceFlowState = {
  stage: "ask",
  booted: false,
  origin: "ask",
  think: null,
  lastInput: null,
  hint: null,
  mic: "available",
  micNotice: null,
  problem: null,
  textEntryOpen: false,
  reviewing: false,
  journeyStage: null,
  searchRestart: false,
};

/** CONFIRMED → done; anything known → sheet; otherwise the question. */
export function stageFromServer(snapshot: ServerSnapshot): StageId {
  if (snapshot.confirmed) return "done";
  return snapshot.anyKnown ? "sheet" : "ask";
}

/**
 * Routing facts only. "Known" is the server's verdict (`missing_fields`); a partially
 * understood field (a date without its time) also counts, so the teacher lands on the
 * sheet where it is displayed.
 */
export function snapshotOf(conversation: ConversationResponse): ServerSnapshot {
  const requirements = conversation.requirements as unknown as Record<string, unknown>;
  const anyValue = Object.values(requirements).some((value) => value !== null && value !== undefined);
  const anyComplete = FIELD_NAMES.some((field) => !conversation.missing_fields.includes(field));
  return {
    confirmed: conversation.state === "CONFIRMED" || conversation.state === "HANDOFF",
    anyKnown: anyValue || anyComplete || Boolean(conversation.pending_clarification),
  };
}

function isRest(stage: StageId): stage is RestStage {
  return stage === "ask" || stage === "sheet";
}

function transcriptionRecovery(kind: ErrorKind): ThinkFailure["recovery"] {
  if (kind === "not_found") return "restart";
  // Nothing was applied: the same recording can be uploaded again.
  if (kind === "retry_same" || kind === "rate_limited" || kind === "conflict") return "retry";
  return null;
}

export function voiceFlowReducer(state: VoiceFlowState, event: VoiceFlowEvent): VoiceFlowState {
  switch (event.type) {
    case "SERVER_STATE": {
      const { confirmed } = event.snapshot;
      if (!state.booted) return { ...state, booted: true, stage: stageFromServer(event.snapshot) };
      // Transient stages are never interrupted by a server update.
      if (state.stage === "listen" || state.stage === "think") return state;
      if (!confirmed) {
        // A confirmed trip was edited: the server reopened it, and dropped its journey.
        const searchRestart = state.searchRestart || state.journeyStage !== null;
        if (state.stage === "done" || isJourneyStage(state.stage)) return { ...state, stage: "sheet", reviewing: false, searchRestart };
        return state.reviewing || searchRestart !== state.searchRestart ? { ...state, reviewing: false, searchRestart } : state;
      }
      // An accepted adjustment changes the requirements and keeps them confirmed: stay put.
      if (state.stage === "done" || state.reviewing || isJourneyStage(state.stage)) return state;
      return { ...state, stage: "done", textEntryOpen: false, searchRestart: false };
    }

    case "JOURNEY_STATE": {
      if (event.stage === null) {
        if (state.journeyStage === null) return state;
        // The journey is gone (the request changed, or it was never the server's any more).
        if (isJourneyStage(state.stage)) return { ...state, journeyStage: null, stage: "done" };
        return { ...state, journeyStage: null, searchRestart: state.searchRestart || state.stage !== "done" };
      }
      const next = { ...state, journeyStage: event.stage };
      // Every answer of the server puts the teacher on the server's stage. Elsewhere (sheet
      // under review, recording, analysing) it is only remembered.
      if (state.stage === "done" || isJourneyStage(state.stage)) return { ...next, stage: event.stage };
      return next;
    }

    case "DESTINATIONS_REQUESTED":
      if (!isJourneyStage(state.stage) || !isOpenJourneyStage(state.journeyStage)) return state;
      return { ...state, stage: "destinations" };

    case "ITINERARIES_REQUESTED":
      // The server accepts another itinerary while the chosen one is under review.
      return state.stage === "review" && state.journeyStage === "review" ? { ...state, stage: "itineraries" } : state;

    case "TRAVEL_FILE_OPENED":
      if (!isJourneyStage(state.stage)) return state;
      return state.journeyStage === "booked" || state.journeyStage === "closed" ? { ...state, stage: "travel_file" } : state;

    case "FEEDBACK_OPENED":
      return isJourneyStage(state.stage) && state.journeyStage === "booked" ? { ...state, stage: "feedback" } : state;

    case "JOURNEY_VIEW_CLOSED":
      return isJourneyStage(state.stage) && state.journeyStage !== null ? { ...state, stage: state.journeyStage } : state;

    case "SEARCH_RESTART_DISMISSED":
      return state.searchRestart ? { ...state, searchRestart: false } : state;

    case "RESET":
      // The microphone's availability does not depend on the conversation.
      return { ...initialVoiceFlowState, mic: state.mic, micNotice: state.mic === "unavailable" ? state.micNotice : null };

    case "MIC_UNSUPPORTED":
      return { ...state, mic: "unavailable", micNotice: "unsupported" };

    case "LISTEN_STARTED":
      if (!isRest(state.stage) || state.mic === "unavailable") return state;
      return { ...state, stage: "listen", origin: state.stage, hint: null, problem: null, micNotice: null, textEntryOpen: false };

    case "LISTEN_DISCARDED":
      if (state.stage !== "listen") return state;
      return { ...state, stage: state.origin, hint: event.reason };

    case "CAPTURE_FAILED": {
      if (state.stage !== "listen") return state;
      const back = { ...state, stage: state.origin };
      if (event.kind === "empty") return { ...back, hint: "empty_recording" };
      // Text becomes the way forward: open it on the question screen.
      const textEntryOpen = state.origin === "ask";
      if (event.kind === "denied") return { ...back, mic: "denied", micNotice: "denied", textEntryOpen };
      return { ...back, mic: "unavailable", micNotice: event.kind, textEntryOpen };
    }

    case "RECORDED":
      if (state.stage !== "listen") return state;
      return {
        ...state,
        stage: "think",
        // A recording exists, so the microphone works (again).
        mic: "available",
        think: { step: "transcribing", source: "audio", transcript: null, failure: null, settling: false },
      };

    case "TRANSCRIBED":
      if (state.stage !== "think" || state.think?.step !== "transcribing") return state;
      return {
        ...state,
        think: { ...state.think, step: "understanding", transcript: event.transcript, failure: null },
        lastInput: { text: event.transcript, source: "audio", delivered: false },
      };

    case "TRANSCRIPTION_FAILED":
      if (state.stage !== "think" || state.think?.step !== "transcribing") return state;
      // The recording itself is unusable: back to where the teacher can record again.
      if (event.kind === "audio") return { ...state, stage: state.origin, think: null, problem: event.detail };
      return {
        ...state,
        think: {
          ...state.think,
          failure: { step: "transcribing", detail: event.detail, recovery: transcriptionRecovery(event.kind) },
        },
      };

    case "TEXT_SUBMITTED":
      if (!isRest(state.stage)) return state;
      return {
        ...state,
        stage: "think",
        origin: state.stage,
        think: { step: "understanding", source: "text", transcript: event.text, failure: null, settling: false },
        lastInput: { text: event.text, source: "text", delivered: false },
        hint: null,
        problem: null,
        textEntryOpen: false,
      };

    case "EXTRACTION_RETURNED":
      if (state.stage !== "think" || state.think?.step !== "understanding") return state;
      return { ...state, think: { ...state.think, settling: true } };

    case "EXTRACTION_FAILED":
      if (state.stage !== "think" || state.think?.step !== "understanding") return state;
      return {
        ...state,
        think: {
          ...state.think,
          settling: false,
          failure: { step: "understanding", detail: event.detail, recovery: event.recovery },
        },
      };

    case "UNDERSTOOD":
      if (state.stage !== "think") return state;
      return {
        ...state,
        // Even when nothing new was understood the sheet is the review screen. A message that
        // left the confirmation untouched returns to the journey, when there is one.
        stage: event.snapshot.confirmed ? (state.journeyStage ?? "done") : "sheet",
        think: null,
        reviewing: false,
        searchRestart: event.snapshot.confirmed ? false : state.searchRestart || state.journeyStage !== null,
        lastInput: state.lastInput ? { ...state.lastInput, delivered: event.applied } : null,
      };

    case "RETRY_STARTED":
      if (state.stage !== "think" || !state.think?.failure) return state;
      return { ...state, think: { ...state.think, failure: null, settling: false } };

    case "THINK_ABANDONED":
      if (state.stage !== "think" || !state.think?.failure) return state;
      return {
        ...state,
        stage: state.origin,
        think: null,
        // The text is not lost: the question screen reopens the field with it.
        textEntryOpen: state.origin === "ask" && state.lastInput !== null,
      };

    case "TEXT_ENTRY_OPENED":
      return state.stage === "ask" ? { ...state, textEntryOpen: true, hint: null } : state;

    case "TEXT_ENTRY_CLOSED":
      return state.stage === "ask" ? { ...state, textEntryOpen: false } : state;

    case "SHEET_OPENED":
      return state.stage === "ask" ? { ...state, stage: "sheet", textEntryOpen: false, hint: null } : state;

    case "MODIFY_REQUESTED":
      if (state.stage === "done" || (isJourneyStage(state.stage) && isOpenJourneyStage(state.journeyStage))) {
        return { ...state, stage: "sheet", reviewing: true };
      }
      return state;

    case "CONFIRMATION_REOPENED":
      // Nothing was edited: back to the journey where it stands, or to the confirmation.
      return state.stage === "sheet" && state.reviewing ? { ...state, stage: state.journeyStage ?? "done", reviewing: false } : state;

    case "HINT_DISMISSED":
      return state.hint ? { ...state, hint: null } : state;

    case "PROBLEM_DISMISSED":
      return state.problem ? { ...state, problem: null } : state;

    case "MIC_NOTICE_DISMISSED":
      return state.micNotice ? { ...state, micNotice: null } : state;

    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

export interface UseVoiceFlowOptions {
  /** Demo mode records without a microphone when none exists, so the flow never dead-ends. */
  allowSyntheticCapture?: boolean;
  /** Injectable journey service (tests); defaults to the one selected at build time. */
  journeyService?: JourneyService;
}

/** Delay before the one automatic check of a waiting booking request. */
export const BOOKING_AUTO_CHECK_MS = 2_500;

export interface PlannerAvailability {
  /** The server's `planner_mode` is "simulated" or "http": the search can be offered. */
  available: boolean;
  /** Simulation: the test scenarios can be offered. */
  simulated: boolean;
  /** The lookup of an existing journey has answered. */
  ready: boolean;
}

export interface VoiceFlow {
  state: VoiceFlowState;
  conversation: UseConversationResult;
  /** The journey after confirmation: server state, requests and errors. */
  journey: UseJourneyResult;
  planner: PlannerAvailability;
  /** Starts (or restarts) the search of proposals. */
  search: (scenarios?: JourneyScenarios) => void;
  /** Look at the destinations again (allowed until a booking request is waiting). */
  browseDestinations: () => void;
  /** Look at the itineraries again while one is under review. */
  browseItineraries: () => void;
  /** Loads the travel file if needed, then shows it. */
  openTravelFile: () => void;
  openFeedback: () => void;
  /** Back to the stage the server is on. */
  closeJourneyView: () => void;
  dismissSearchRestart: () => void;
  /** Callbacks for the capture hook; the flow owns what happens with a recording. */
  listen: {
    started: () => void;
    discarded: (reason: DiscardReason) => void;
    failed: (kind: CaptureErrorKind) => void;
    recorded: (result: CaptureResult) => void;
  };
  submitText: (text: string) => void;
  retryThink: () => void;
  abandonThink: () => void;
  confirm: () => void;
  restart: () => void;
  openTextEntry: () => void;
  closeTextEntry: () => void;
  openSheet: () => void;
  modify: () => void;
  reopenConfirmation: () => void;
  dismissHint: () => void;
  dismissProblem: () => void;
  dismissMicNotice: () => void;
}

export function useVoiceFlow(service?: ConversationService, options: UseVoiceFlowOptions = {}): VoiceFlow {
  const conversation = useConversation(service);
  const [state, dispatch] = useReducer(voiceFlowReducer, initialVoiceFlowState);
  const { allowSyntheticCapture = false, journeyService } = options;

  /** Kept until its upload has succeeded, so a retry never asks the teacher to speak again. */
  const recordingRef = useRef<Blob | null>(null);
  /** Outcome of the first extraction attempt; null when it comes from a replay. */
  const appliedRef = useRef<boolean | null>(null);

  const { send, transcribe, retry, dismissError, dismissNotice, confirm: confirmConversation, restart: restartConversation } = conversation;

  // The stage follows the server: initial stage, confirmation, reopening.
  const current = conversation.conversation;
  useEffect(() => {
    if (current) dispatch({ type: "SERVER_STATE", snapshot: snapshotOf(current) });
  }, [current]);

  useEffect(() => {
    if (!allowSyntheticCapture && !isCaptureSupported()) dispatch({ type: "MIC_UNSUPPORTED" });
  }, [allowSyntheticCapture]);

  // The journey exists only for confirmed requirements and a planner the server exposes.
  const plannerMode = conversation.config.planner_mode;
  const plannerAvailable = plannerMode === "simulated" || plannerMode === "http";
  const confirmedNow = current ? snapshotOf(current).confirmed : false;
  const journey = useJourney({
    conversationId: current?.conversation_id ?? null,
    enabled: confirmedNow && plannerAvailable,
    // An accepted time adjustment changed the requirements: the sheet must show the new time.
    onRequirementsChanged: conversation.refresh,
    service: journeyService,
  });
  const journeyData = journey.journey;
  useEffect(() => {
    dispatch({ type: "JOURNEY_STATE", stage: journeyData?.stage ?? null });
  }, [journeyData]);

  // A waiting booking request is checked once by itself; after that the teacher asks.
  const waitingReference =
    state.stage === "booking_pending" && journeyData?.stage === "booking_pending" ? (journeyData.booking?.reference ?? "") : null;
  const autoCheckedRef = useRef<string | null>(null);
  const { checkBooking } = journey;
  useEffect(() => {
    if (waitingReference === null || autoCheckedRef.current === waitingReference) return;
    const timer = setTimeout(() => {
      autoCheckedRef.current = waitingReference;
      void checkBooking();
    }, BOOKING_AUTO_CHECK_MS);
    return () => clearTimeout(timer);
  }, [waitingReference, checkBooking]);

  // Reads the result of an extraction once its request has fully settled. `retry()` of
  // `useConversation` returns nothing, so the conversation itself is the source of truth.
  const settling = state.stage === "think" && state.think?.settling === true;
  const { pending, error, notice } = conversation;
  useEffect(() => {
    if (!settling || pending !== null) return;
    if (error) {
      dispatch({ type: "EXTRACTION_FAILED", detail: error.detail, recovery: error.recovery });
      return;
    }
    if (!current) return;
    // A conflict or a rate limit applies nothing and only raises a notice.
    const applied = appliedRef.current ?? notice === null;
    dispatch({ type: "UNDERSTOOD", snapshot: snapshotOf(current), applied });
  }, [settling, pending, error, notice, current]);

  const runExtraction = useCallback(
    async (text: string, source: InputSource) => {
      const outcome = await send(text, source);
      if (outcome === "ignored") {
        dispatch({ type: "EXTRACTION_FAILED", detail: frVoice.think.fallbackError, recovery: null });
        return;
      }
      appliedRef.current = outcome === "sent";
      dispatch({ type: "EXTRACTION_RETURNED" });
    },
    [send],
  );

  const runTranscription = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) return;
    let transcript: string;
    try {
      transcript = await transcribe(recording);
    } catch (err) {
      const apiError = err instanceof ApiError ? err : new ApiError(0, "Erreur", frVoice.think.fallbackError);
      // An unusable recording is dropped; any other failure keeps it for the retry.
      if (apiError.kind === "audio") recordingRef.current = null;
      dispatch({ type: "TRANSCRIPTION_FAILED", kind: apiError.kind, detail: apiError.detail || frVoice.think.fallbackError });
      return;
    }
    recordingRef.current = null;
    dispatch({ type: "TRANSCRIBED", transcript });
    // D2: the transcript goes to extraction automatically; the sheet is the review.
    await runExtraction(transcript, "audio");
  }, [transcribe, runExtraction]);

  const listen = useMemo<VoiceFlow["listen"]>(
    () => ({
      started: () => {
        dismissError();
        dispatch({ type: "LISTEN_STARTED" });
      },
      discarded: (reason) => dispatch({ type: "LISTEN_DISCARDED", reason }),
      failed: (kind) => dispatch({ type: "CAPTURE_FAILED", kind }),
      recorded: (result) => {
        recordingRef.current = result.blob;
        dispatch({ type: "RECORDED" });
        void runTranscription();
      },
    }),
    [dismissError, runTranscription],
  );

  const submitText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      dismissError();
      dispatch({ type: "TEXT_SUBMITTED", text: trimmed });
      void runExtraction(trimmed, "text");
    },
    [dismissError, runExtraction],
  );

  const failure = state.think?.failure ?? null;
  const retryThink = useCallback(() => {
    if (!failure || failure.recovery !== "retry") return;
    dispatch({ type: "RETRY_STARTED" });
    if (failure.step === "transcribing") {
      void runTranscription();
      return;
    }
    // Replays the failed request with the SAME client_message_id (see useConversation.send).
    appliedRef.current = null;
    dismissNotice();
    void retry().then(() => dispatch({ type: "EXTRACTION_RETURNED" }));
  }, [failure, runTranscription, retry, dismissNotice]);

  const abandonThink = useCallback(() => {
    recordingRef.current = null;
    dismissError();
    dispatch({ type: "THINK_ABANDONED" });
  }, [dismissError]);

  const confirm = useCallback(() => {
    // The only path to a confirmed trip; `done` is entered when the server says CONFIRMED.
    void confirmConversation();
  }, [confirmConversation]);

  const restart = useCallback(() => {
    recordingRef.current = null;
    dispatch({ type: "RESET" });
    void restartConversation();
  }, [restartConversation]);

  const { start: startJourney, loadTravelFile, dismissError: dismissJourneyError, travelFile } = journey;
  const search = useCallback(
    (scenarios?: JourneyScenarios) => {
      void startJourney(scenarios);
    },
    [startJourney],
  );
  const openTravelFile = useCallback(() => {
    if (travelFile) {
      dispatch({ type: "TRAVEL_FILE_OPENED" });
      return;
    }
    void loadTravelFile().then((loaded) => {
      if (loaded) dispatch({ type: "TRAVEL_FILE_OPENED" });
    });
  }, [travelFile, loadTravelFile]);
  const journeyActions = useMemo(
    () => ({
      // An error belongs to the screen it happened on: it does not follow the teacher.
      browseDestinations: () => {
        dismissJourneyError();
        dispatch({ type: "DESTINATIONS_REQUESTED" });
      },
      browseItineraries: () => {
        dismissJourneyError();
        dispatch({ type: "ITINERARIES_REQUESTED" });
      },
      openFeedback: () => {
        dismissJourneyError();
        dispatch({ type: "FEEDBACK_OPENED" });
      },
      closeJourneyView: () => {
        dismissJourneyError();
        dispatch({ type: "JOURNEY_VIEW_CLOSED" });
      },
      dismissSearchRestart: () => dispatch({ type: "SEARCH_RESTART_DISMISSED" }),
    }),
    [dismissJourneyError],
  );
  const planner = useMemo<PlannerAvailability>(
    () => ({ available: plannerAvailable, simulated: plannerMode === "simulated", ready: journey.status === "ready" }),
    [plannerAvailable, plannerMode, journey.status],
  );

  const actions = useMemo(
    () => ({
      openTextEntry: () => dispatch({ type: "TEXT_ENTRY_OPENED" }),
      closeTextEntry: () => dispatch({ type: "TEXT_ENTRY_CLOSED" }),
      openSheet: () => dispatch({ type: "SHEET_OPENED" }),
      modify: () => {
        dismissJourneyError();
        dispatch({ type: "MODIFY_REQUESTED" });
      },
      reopenConfirmation: () => dispatch({ type: "CONFIRMATION_REOPENED" }),
      dismissHint: () => dispatch({ type: "HINT_DISMISSED" }),
      dismissProblem: () => dispatch({ type: "PROBLEM_DISMISSED" }),
      dismissMicNotice: () => dispatch({ type: "MIC_NOTICE_DISMISSED" }),
    }),
    [dismissJourneyError],
  );

  return {
    state,
    conversation,
    journey,
    planner,
    search,
    openTravelFile,
    ...journeyActions,
    listen,
    submitText,
    retryThink,
    abandonThink,
    confirm,
    restart,
    ...actions,
  };
}
