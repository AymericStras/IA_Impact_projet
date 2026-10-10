"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeftIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UseJourneyResult } from "@/hooks/useJourney";
import { fr } from "@/i18n/fr";
import { FLUID_BUTTON_SM, TOUCH_TARGET } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Itinerary, Journey, JourneyScenarios, JourneyStage } from "@/types/journey";
import { ErrorMessage } from "../ErrorMessage";
import { AdjustmentList } from "./AdjustmentList";
import { BookingPending } from "./BookingPending";
import { BookingRefused } from "./BookingRefused";
import { DestinationList } from "./DestinationList";
import { FeedbackForm } from "./FeedbackForm";
import { FeedbackGiven } from "./FeedbackGiven";
import { ItineraryCard } from "./ItineraryCard";
import { ItineraryList } from "./ItineraryList";
import { JourneyActions } from "./JourneyActions";
import { JourneyHeader } from "./JourneyHeader";
import { JourneyNotices } from "./JourneyNotices";
import { JourneyStart } from "./JourneyStart";
import { JOURNEY_CARD } from "./journeyStyles";
import { NoMatchCard } from "./NoMatchCard";
import { ReviewCard } from "./ReviewCard";
import { ScenarioControls } from "./ScenarioControls";
import { TravelFileView } from "./TravelFileView";

/**
 * Stages in which the contract lets the teacher change destination or search again: every
 * one before a booking request is waiting (docs/PLANNER_CONTRACT.md, "Rules").
 */
const OPEN_STAGES: readonly JourneyStage[] = ["destinations", "itineraries", "adjustments", "no_match", "review", "booking_refused"];

/** Id of the journey's root element in every state, so the page can scroll to it. */
export const JOURNEY_REGION_ID = "journey-region";

/** What the teacher asked to look at again; "stage" is the server's current stage. */
type View = "stage" | "destinations" | "itineraries";

interface JourneyPanelProps {
  /** Result of `useJourney`: the server's journey and the actions on it. */
  state: UseJourneyResult;
  /** True when the server's `planner_mode` is "simulated": shows the test scenario tool. */
  simulated: boolean;
  /** « Modifier ma demande »: opens the "Votre projet" panel on its first edit button. */
  onEditRequest: () => void;
  /** Tells the thread that another view is shown, so it can bring its start into view. */
  onViewChange?: (key: string) => void;
}

function findItinerary(journey: Journey, id: string | null | undefined): Itinerary | undefined {
  return id ? [...journey.itineraries, ...journey.alternatives].find((itinerary) => itinerary.id === id) : undefined;
}

/**
 * The journey after confirmation, as a sequence the teacher follows in the thread
 * (docs/PLANNER_CONTRACT.md). Everything shown — stage, lists, order, messages, counts,
 * feasibility — is read from the server's `Journey`; this component only chooses which
 * part to display and forwards the teacher's choices.
 */
export function JourneyPanel({ state, simulated, onEditRequest, onViewChange }: JourneyPanelProps) {
  const { journey, travelFile, status, pending, error, loadTravelFile } = state;
  const [view, setView] = useState<View>("stage");
  const [scenarios, setScenarios] = useState<Required<JourneyScenarios>>({
    search_scenario: "auto",
    booking_scenario: "confirmed",
  });
  const busy = pending !== null;
  const stage = journey?.stage ?? null;

  // The travel file is fetched once per confirmed booking; a failure is retried from the error block.
  const requestedFileRef = useRef<string | null>(null);
  const bookedReference = journey && (stage === "booked" || stage === "closed") ? (journey.booking?.reference ?? null) : null;
  useEffect(() => {
    if (!bookedReference) {
      requestedFileRef.current = null;
      return;
    }
    if (travelFile || requestedFileRef.current === bookedReference) return;
    requestedFileRef.current = bookedReference;
    void loadTravelFile();
  }, [bookedReference, travelFile, loadTravelFile]);

  // A view asked for again only makes sense in the stage it was asked from.
  const open = stage !== null && OPEN_STAGES.includes(stage);
  const shownView: View =
    view === "destinations" && open && journey !== null && journey.destinations.length > 0
      ? "destinations"
      : view === "itineraries" && stage === "review"
        ? "itineraries"
        : "stage";

  const viewKey = journey ? `${journey.stage}:${shownView}${error ? ":error" : ""}` : error ? "start:error" : "";
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  useEffect(() => {
    onViewChangeRef.current?.(viewKey);
  }, [viewKey]);
  useEffect(() => () => onViewChangeRef.current?.(""), []);

  if (status === "idle") return null;

  const start = async () => {
    if (await state.start(scenarios)) setView("stage");
  };
  const chooseDestination = async (destinationId: string, activityIds: string[]) => {
    if (await state.chooseDestination(destinationId, activityIds)) setView("stage");
  };
  const chooseItinerary = async (itineraryId: string) => {
    if (await state.chooseItinerary(itineraryId)) setView("stage");
  };

  const scenarioTool = simulated ? <ScenarioControls value={scenarios} onChange={setScenarios} disabled={busy} /> : null;
  const errorBlock = error ? (
    <ErrorMessage
      // A failure without a server message (network) gets the generic network text.
      detail={error.detail || fr.errors.network}
      onRetry={error.retry ? () => void error.retry?.() : undefined}
      onDismiss={state.dismissError}
    />
  ) : null;

  if (status === "loading") {
    return (
      <p id={JOURNEY_REGION_ID} role="status" className="flex items-center gap-2 text-sm font-medium text-muted-foreground" data-testid="journey-loading">
        <Loader2Icon className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {fr.journey.loading}
      </p>
    );
  }

  if (!journey) {
    return (
      <section
        id={JOURNEY_REGION_ID}
        aria-labelledby="journey-title"
        className="@container/journey grid min-w-0 gap-3"
        data-testid="journey"
        data-stage="start"
        {...(error ? { "data-thread-anchor": "" } : {})}
      >
        {errorBlock}
        <JourneyStart onStart={() => void start()} pending={pending === "start"} disabled={busy}>
          {scenarioTool}
        </JourneyStart>
      </section>
    );
  }

  const selected = findItinerary(journey, journey.selected_itinerary_id);
  const booked = findItinerary(journey, journey.booking?.itinerary_id);
  const canChangeDestination = open && stage !== "destinations" && journey.destinations.length > 0;
  // In review the other itineraries are the ones the server still offers.
  const otherItineraries = journey.alternatives.length > 0 ? journey.alternatives : journey.itineraries;

  const backButton = (
    <div className="flex">
      <Button type="button" variant="outline" size="sm" onClick={() => setView("stage")} disabled={busy} className={cn(FLUID_BUTTON_SM, TOUCH_TARGET)}>
        <ArrowLeftIcon aria-hidden="true" />
        {fr.journey.destinations.back}
      </Button>
    </div>
  );

  const destinationList = (
    <DestinationList
      destinations={journey.destinations}
      selectedDestinationId={journey.selected_destination_id}
      selectedActivityIds={journey.selected_activity_ids}
      departureStations={journey.departure_stations}
      onChoose={(destinationId, activityIds) => void chooseDestination(destinationId, activityIds)}
      busy={busy}
    />
  );

  let content: ReactNode;
  if (shownView === "destinations") {
    content = (
      <>
        {backButton}
        {destinationList}
      </>
    );
  } else if (shownView === "itineraries") {
    content = (
      <>
        {backButton}
        <ItineraryList
          itineraries={otherItineraries}
          selectedItineraryId={journey.selected_itinerary_id}
          onChoose={(id) => void chooseItinerary(id)}
          busy={busy}
        />
      </>
    );
  } else {
    switch (journey.stage) {
      case "destinations":
        content = destinationList;
        break;
      case "itineraries":
        content = <ItineraryList itineraries={journey.itineraries} onChoose={(id) => void chooseItinerary(id)} busy={busy} />;
        break;
      case "adjustments":
        content = <AdjustmentList adjustments={journey.adjustments} onAccept={(id) => void state.acceptAdjustment(id)} busy={busy} />;
        break;
      case "no_match":
        content = <NoMatchCard />;
        break;
      case "review":
        content = selected ? (
          <ReviewCard
            itinerary={selected}
            onSubmit={() => void state.submitBooking()}
            onOtherItinerary={otherItineraries.length > 0 ? () => setView("itineraries") : undefined}
            submitting={pending === "booking"}
            busy={busy}
          />
        ) : null;
        break;
      case "booking_pending":
        content = journey.booking ? (
          <>
            <BookingPending booking={journey.booking} onCheck={() => void state.checkBooking()} checking={pending === "check"} disabled={busy} />
            {booked ? <ItineraryCard itinerary={booked} /> : null}
          </>
        ) : null;
        break;
      case "booking_refused":
        content = journey.booking ? (
          <BookingRefused booking={journey.booking} alternatives={journey.alternatives} onChoose={(id) => void chooseItinerary(id)} busy={busy} />
        ) : null;
        break;
      case "booked":
      case "closed":
        content = (
          <>
            {journey.booking ? (
              <p className={cn(JOURNEY_CARD, "text-[0.9375rem] font-medium [overflow-wrap:anywhere]")} data-testid="booking-message">
                {journey.booking.message}
              </p>
            ) : null}
            {journey.stage === "closed" && journey.feedback ? <FeedbackGiven feedback={journey.feedback} /> : null}
            {travelFile ? (
              <TravelFileView file={travelFile} notices={journey.notices} />
            ) : pending === "travel_file" ? (
              <p role="status" className="flex items-center gap-2 text-sm font-medium text-muted-foreground" data-testid="travel-file-loading">
                <Loader2Icon className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                {fr.journey.travelFile.loading}
              </p>
            ) : null}
            {journey.stage === "booked" ? (
              <FeedbackForm onSubmit={(feedback) => void state.giveFeedback(feedback)} pending={pending === "feedback"} disabled={busy} />
            ) : null}
          </>
        );
        break;
    }
  }

  return (
    <section
      id={JOURNEY_REGION_ID}
      aria-labelledby="journey-title"
      className="@container/journey grid min-w-0 gap-4 short:gap-3"
      data-testid="journey"
      data-stage={journey.stage}
      data-view={shownView}
      data-thread-anchor=""
    >
      {/* One block: the stage header, and — flush under it — the yellow banner of notices. */}
      <div className="grid min-w-0 overflow-hidden rounded-2xl shadow-card">
        <JourneyHeader
          stage={journey.stage}
          title={shownView === "destinations" ? fr.journey.destinations.changeTitle : shownView === "itineraries" ? fr.journey.review.otherItinerary : undefined}
          message={journey.message}
          className={journey.notices.length > 0 ? "rounded-b-none" : undefined}
        />
        {/* On every view: simulated data must never pass for real availability. */}
        <JourneyNotices notices={journey.notices} className="rounded-t-none" />
      </div>
      {errorBlock}
      {content}
      {open && shownView === "stage" ? (
        <JourneyActions
          onChangeDestination={canChangeDestination ? () => setView("destinations") : undefined}
          changeDestinationLabel={
            stage === "adjustments"
              ? fr.journey.adjustments.otherDestination
              : stage === "no_match"
                ? fr.journey.noMatch.otherDestination
                : undefined
          }
          onEditRequest={onEditRequest}
          onRestart={() => void start()}
          restarting={pending === "start"}
          disabled={busy}
        >
          {scenarioTool}
        </JourneyActions>
      ) : null}
    </section>
  );
}
