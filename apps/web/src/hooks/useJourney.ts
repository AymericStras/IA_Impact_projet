"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { journeyService as defaultService, toApiError, type JourneyService } from "@/services";
import type { Feedback, Journey, JourneyScenarios, TravelFile } from "@/types/journey";

export type JourneyAction =
  | "load"
  | "start"
  | "destination"
  | "adjustment"
  | "itinerary"
  | "booking"
  | "check"
  | "travel_file"
  | "feedback";

export interface JourneyError {
  /** Server's French message, displayable as is. */
  detail: string;
  /** Stable code (`PLANNER_ERROR`, `BOOKING_ERROR`, `INVALID_STATE`…), when the server sent one. */
  code?: string;
  action: JourneyAction;
  /** Repeats the failed action; null when repeating makes no sense. */
  retry: (() => Promise<void>) | null;
}

export interface UseJourneyOptions {
  /** Conversation whose journey is driven; null while the conversation is loading. */
  conversationId: string | null;
  /** True when the requirements are confirmed and the server's `planner_mode` is not "off". */
  enabled: boolean;
  /** Called after an action that changed the requirements on the server (an accepted time adjustment). */
  onRequirementsChanged?: () => void | Promise<void>;
  service?: JourneyService;
}

export interface UseJourneyResult {
  /** Latest journey from the server, or null when no search is in progress. */
  journey: Journey | null;
  /** Travel file, once loaded for a confirmed booking. */
  travelFile: TravelFile | null;
  /** "idle" until enabled; "loading" while the existing journey is looked up; then "ready". */
  status: "idle" | "loading" | "ready";
  pending: JourneyAction | null;
  error: JourneyError | null;
  start: (scenarios?: JourneyScenarios) => Promise<boolean>;
  chooseDestination: (destinationId: string, activityIds: string[]) => Promise<boolean>;
  acceptAdjustment: (adjustmentId: string) => Promise<boolean>;
  chooseItinerary: (itineraryId: string) => Promise<boolean>;
  submitBooking: () => Promise<boolean>;
  checkBooking: () => Promise<boolean>;
  loadTravelFile: () => Promise<boolean>;
  giveFeedback: (feedback: Feedback) => Promise<boolean>;
  dismissError: () => void;
}

/**
 * Drives the journey after confirmation (docs/PLANNER_CONTRACT.md): it stores the latest
 * `Journey` returned by the server and never derives a stage, a feasibility or an adjustment.
 * When `enabled` turns false (a requirement was edited, a new conversation started) the
 * journey is dropped: the server has dropped it too.
 */
export function useJourney({
  conversationId,
  enabled,
  onRequirementsChanged,
  service = defaultService,
}: UseJourneyOptions): UseJourneyResult {
  const [journey, setJourney] = useState<Journey | null>(null);
  const [travelFile, setTravelFile] = useState<TravelFile | null>(null);
  const [status, setStatus] = useState<UseJourneyResult["status"]>("idle");
  const [pending, setPending] = useState<JourneyAction | null>(null);
  const [error, setError] = useState<JourneyError | null>(null);
  const changedRef = useRef(onRequirementsChanged);
  changedRef.current = onRequirementsChanged;
  // Guards against a late answer for a conversation or a confirmation that is gone.
  const epochRef = useRef(0);

  useEffect(() => {
    epochRef.current += 1;
    const epoch = epochRef.current;
    setJourney(null);
    setTravelFile(null);
    setError(null);
    setPending(null);
    if (!enabled || !conversationId) {
      setStatus("idle");
      return;
    }
    setStatus("loading");
    service.get(conversationId).then(
      (found) => {
        if (epochRef.current !== epoch) return;
        setJourney(found);
        setStatus("ready");
      },
      () => {
        // No journey yet (409) or unreachable: the stage offers to start one.
        if (epochRef.current === epoch) setStatus("ready");
      },
    );
  }, [conversationId, enabled, service]);

  const run = useCallback(
    async (action: JourneyAction, call: (id: string) => Promise<Journey>, retryable = true): Promise<boolean> => {
      if (!conversationId || !enabled) return false;
      const epoch = epochRef.current;
      const attempt = async (): Promise<boolean> => {
        setPending(action);
        setError(null);
        try {
          const next = await call(conversationId);
          if (epochRef.current !== epoch) return false;
          setJourney(next);
          if (next.stage !== "booked" && next.stage !== "closed") setTravelFile(null);
          return true;
        } catch (caught) {
          if (epochRef.current !== epoch) return false;
          const apiError = toApiError(caught, "");
          setError({
            detail: apiError.detail,
            code: apiError.code,
            action,
            retry: retryable ? () => attempt().then(() => undefined) : null,
          });
          return false;
        } finally {
          if (epochRef.current === epoch) setPending(null);
        }
      };
      return attempt();
    },
    [conversationId, enabled],
  );

  const start = useCallback<UseJourneyResult["start"]>(
    (scenarios) => run("start", (id) => service.start(id, scenarios)),
    [run, service],
  );
  const chooseDestination = useCallback<UseJourneyResult["chooseDestination"]>(
    (destinationId, activityIds) =>
      run("destination", (id) => service.chooseDestination(id, destinationId, activityIds)),
    [run, service],
  );
  const acceptAdjustment = useCallback<UseJourneyResult["acceptAdjustment"]>(
    async (adjustmentId) => {
      // Not retryable blindly: a second acceptance of the same adjustment is refused by the server.
      const ok = await run("adjustment", (id) => service.acceptAdjustment(id, adjustmentId), false);
      if (ok) await changedRef.current?.();
      return ok;
    },
    [run, service],
  );
  const chooseItinerary = useCallback<UseJourneyResult["chooseItinerary"]>(
    (itineraryId) => run("itinerary", (id) => service.chooseItinerary(id, itineraryId)),
    [run, service],
  );
  const submitBooking = useCallback(() => run("booking", (id) => service.submitBooking(id)), [run, service]);
  const checkBooking = useCallback(() => run("check", (id) => service.checkBooking(id)), [run, service]);
  const giveFeedback = useCallback<UseJourneyResult["giveFeedback"]>(
    (feedback) => run("feedback", (id) => service.giveFeedback(id, feedback)),
    [run, service],
  );

  const loadTravelFile = useCallback(async (): Promise<boolean> => {
    if (!conversationId || !enabled) return false;
    const epoch = epochRef.current;
    setPending("travel_file");
    setError(null);
    try {
      const file = await service.travelFile(conversationId);
      if (epochRef.current !== epoch) return false;
      setTravelFile(file);
      return true;
    } catch (caught) {
      if (epochRef.current !== epoch) return false;
      const apiError = toApiError(caught, "");
      setError({
        detail: apiError.detail,
        code: apiError.code,
        action: "travel_file",
        retry: () => loadTravelFile().then(() => undefined),
      });
      return false;
    } finally {
      if (epochRef.current === epoch) setPending(null);
    }
  }, [conversationId, enabled, service]);

  const dismissError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({
      journey,
      travelFile,
      status,
      pending,
      error,
      start,
      chooseDestination,
      acceptAdjustment,
      chooseItinerary,
      submitBooking,
      checkBooking,
      loadTravelFile,
      giveFeedback,
      dismissError,
    }),
    [
      journey,
      travelFile,
      status,
      pending,
      error,
      start,
      chooseDestination,
      acceptAdjustment,
      chooseItinerary,
      submitBooking,
      checkBooking,
      loadTravelFile,
      giveFeedback,
      dismissError,
    ],
  );
}
