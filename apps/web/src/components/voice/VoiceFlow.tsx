"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { ClipboardListIcon, KeyboardIcon, Loader2Icon } from "lucide-react";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import { useHoldToTalk } from "@/hooks/useHoldToTalk";
import { isJourneyStage, useVoiceFlow, type StageId } from "@/hooks/useVoiceFlow";
import { frVoice } from "@/i18n/fr.voice";
import { isDemoMode } from "@/lib/env";
import { cn } from "@/lib/utils";
import type { ConversationService, JourneyService } from "@/services";
import { Banner } from "./Banner";
import { AdjustmentsStage } from "./journey/AdjustmentsStage";
import { BookedStage } from "./journey/BookedStage";
import { BookingPendingStage } from "./journey/BookingPendingStage";
import { ClosedStage } from "./journey/ClosedStage";
import { DestinationsStage } from "./journey/DestinationsStage";
import { FeedbackStage } from "./journey/FeedbackStage";
import { ItinerariesStage } from "./journey/ItinerariesStage";
import { NoMatchStage } from "./journey/NoMatchStage";
import { ReviewStage } from "./journey/ReviewStage";
import { DockSlotContext } from "./journey/StageActions";
import { TravelFileStage } from "./journey/TravelFileStage";
import { ProgressDots } from "./ProgressDots";
import { StageFrame } from "./StageFrame";
import { TalkButton } from "./TalkButton";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { assistantText, confirmationStatus } from "./fieldDisplay";
import { AskStage } from "./stages/AskStage";
import { DoneStage } from "./stages/DoneStage";
import { ListenStage } from "./stages/ListenStage";
import { SheetStage } from "./stages/SheetStage";
import { ThinkStage } from "./stages/ThinkStage";
import styles from "./voice.module.css";

interface VoiceFlowProps {
  /** Injectable service (tests); defaults to the one selected by NEXT_PUBLIC_DEMO_MODE. */
  service?: ConversationService;
  /** Injectable journey service (tests); same rule. */
  journeyService?: JourneyService;
}

const DOCK_BUTTON =
  "inline-flex min-h-11 max-w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-center text-sm font-medium [overflow-wrap:anywhere] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";
const DOCK_SECONDARY = "border-input bg-card text-foreground hover:bg-muted";
const DOCK_PRIMARY = "border-transparent bg-primary text-primary-foreground hover:bg-primary/85";
/** On the accent surface: same contrast pair as the surface text (7.7:1). */
const DOCK_ON_ACCENT = "border-primary-foreground/70 bg-transparent text-primary-foreground hover:bg-primary-foreground/10";

/** A light tick on start and stop, where the device can do it. */
function haptic(milliseconds: number): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(milliseconds);
  } catch {
    // Haptics are a nicety; some browsers throw without a prior user activation.
  }
}

/**
 * The staged, voice-first experience: stage router, transitions and the persistent dock.
 *
 * All business state comes from `useVoiceFlow` → `useConversation`; this component only
 * wires the microphone (`useAudioCapture`) and the gesture (`useHoldToTalk`) to the stage
 * machine and renders the stage the machine says.
 *
 * The talk button lives here, outside the stages, and keeps its place across `ask`,
 * `listen` and `sheet`: the finger that started a recording stays on the same element
 * (pointer capture survives) while the screen changes around it.
 */
export function VoiceFlow({ service, journeyService }: VoiceFlowProps) {
  const flow = useVoiceFlow(service, { allowSyntheticCapture: isDemoMode, journeyService });
  const { state, conversation: chat, journey: trip, planner } = flow;
  const journey = trip.journey;
  // The dock element the journey stages render their actions into (see StageActions).
  const [dockSlot, setDockSlot] = useState<HTMLElement | null>(null);
  const { conversation, config, pending, error, notice } = chat;
  const reducedMotion = usePrefersReducedMotion();
  const hintId = useId();
  const statusId = useId();
  const mainRef = useRef<HTMLElement>(null);

  const capture = useAudioCapture({
    maxSeconds: config.max_audio_seconds,
    allowSynthetic: isDemoMode,
    onComplete: (result) => {
      haptic(8);
      flow.listen.recorded(result);
    },
    onDiscard: flow.listen.discarded,
    onError: flow.listen.failed,
  });

  const recording = capture.status !== "idle";
  const busy = pending !== null;
  const gesture = useHoldToTalk({
    active: recording,
    disabled: !recording && busy,
    onStart: () => {
      flow.listen.started();
      // Inside the gesture: the permission prompt and the audio unlock need it.
      capture.start();
      haptic(12);
    },
    onStop: capture.stop,
    onCancel: (reason) => capture.cancel(reason === "interrupted" ? "interrupted" : "cancelled"),
    onRelease: capture.unlock,
  });

  const stage: StageId | "loading" = conversation && state.booted ? state.stage : "loading";

  // Entering a stage moves focus to its heading — except around `listen`: the teacher is
  // operating the talk button, which must keep the focus it has (see VOICE_NOTES.md).
  const previousStageRef = useRef<StageId | "loading">("loading");
  const previousStage = previousStageRef.current;
  useEffect(() => {
    previousStageRef.current = stage;
    mainRef.current?.scrollTo?.({ top: 0 });
  }, [stage]);
  const focusHeading = stage !== "listen" && previousStage !== "listen";

  // Notices and errors sit at the top of the stage area: bring them into view when they
  // appear (the teacher may have scrolled down the sheet).
  const bannerKey = [
    notice ?? "",
    state.hint ?? "",
    state.micNotice ?? "",
    state.problem ?? "",
    error?.detail ?? "",
    trip.error ? `${trip.error.action}:${trip.error.detail}` : "",
    state.searchRestart ? "restart" : "",
  ].join("|");
  useEffect(() => {
    if (bannerKey.replace(/\|/g, "") !== "") mainRef.current?.scrollTo?.({ top: 0 });
  }, [bannerKey]);

  // Journey requests: one at a time, and no conversation request alongside.
  const tripBusy = trip.pending !== null || busy;
  // The server's line describes the stage the SERVER is on: not shown on another screen.
  const tripMessage = journey && journey.stage === stage ? journey.message : null;

  const micUsable = state.mic !== "unavailable";
  const textOpen = state.textEntryOpen || !micUsable;
  const undelivered = state.lastInput && !state.lastInput.delivered ? state.lastInput.text : "";

  let content: ReactNode;
  if (!conversation || stage === "loading") {
    content = (
      <div className={cn(styles.stage, styles.safeX, "max-w-xl items-center justify-center gap-3 py-6 text-center")} data-testid="stage-loading">
        {chat.status === "failed" ? (
          <Banner
            kind="error"
            title={frVoice.problem.title}
            action={{ label: frVoice.chrome.retry, onClick: () => void chat.retry() }}
            testId="voice-error"
          >
            {error?.detail ?? frVoice.chrome.loadFailed}
          </Banner>
        ) : (
          <p className="flex items-center gap-2 text-base text-muted-foreground" role="status">
            <Loader2Icon className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {frVoice.chrome.loading}
          </p>
        )}
      </div>
    );
  } else if (stage === "ask") {
    content = (
      <AskStage
        // Before the teacher has said anything the server only holds its chat welcome, a
        // paragraph: this stage shows one short question instead.
        question={conversation.messages.some((m) => m.role === "user") ? assistantText(conversation) : null}
        focusHeading={focusHeading}
        textOpen={textOpen}
        textAutoFocus={state.textEntryOpen}
        initialText={undelivered}
        maxLength={config.max_message_chars}
        disabled={busy}
        onSubmitText={flow.submitText}
        onCloseText={micUsable ? flow.closeTextEntry : undefined}
      />
    );
  } else if (stage === "listen") {
    content = (
      <ListenStage capture={capture} gesture={gesture} maxSeconds={config.max_audio_seconds} reducedMotion={reducedMotion} hintId={hintId} />
    );
  } else if (stage === "think" && state.think) {
    content = (
      <ThinkStage
        think={state.think}
        focusHeading={focusHeading}
        demo={isDemoMode}
        onRetry={flow.retryThink}
        onAbandon={flow.abandonThink}
        onRestart={flow.restart}
      />
    );
  } else if (stage === "done") {
    content = (
      <DoneStage
        conversation={conversation}
        focusHeading={focusHeading}
        disabled={tripBusy}
        onModify={flow.modify}
        onNewTrip={flow.restart}
        search={
          planner.available
            ? { simulated: planner.simulated, ready: planner.ready, searching: trip.pending === "start", onSearch: flow.search }
            : undefined
        }
      />
    );
  } else if (isJourneyStage(stage)) {
    if (!journey || (stage === "travel_file" && !trip.travelFile)) {
      // Between the server dropping the journey and the stage following it: never a stale card.
      content = (
        <div className={cn(styles.stage, styles.safeX, "max-w-xl items-center justify-center gap-3 py-6 text-center")} data-testid="stage-journey-loading">
          <p className="flex items-center gap-2 text-base text-muted-foreground" role="status">
            <Loader2Icon className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {frVoice.journey.loading}
          </p>
        </div>
      );
    } else if (stage === "destinations") {
      content = (
        <DestinationsStage
          journey={journey}
          focusHeading={focusHeading}
          message={tripMessage}
          busy={tripBusy}
          choosing={trip.pending === "destination"}
          onChoose={(destinationId, activityIds) => void trip.chooseDestination(destinationId, activityIds)}
          onModify={flow.modify}
          onBack={journey.stage !== "destinations" ? flow.closeJourneyView : undefined}
        />
      );
    } else if (stage === "itineraries") {
      content = (
        <ItinerariesStage
          stage="itineraries"
          heading={frVoice.journey.itinerary.heading}
          listLabel={frVoice.journey.itinerary.listLabel}
          itineraries={journey.itineraries}
          selectedId={journey.selected_itinerary_id}
          notices={journey.notices}
          focusHeading={focusHeading}
          message={tripMessage}
          busy={tripBusy}
          choosing={trip.pending === "itinerary"}
          onChoose={(itineraryId) => void trip.chooseItinerary(itineraryId)}
          onOtherDestination={flow.browseDestinations}
          onModify={flow.modify}
        />
      );
    } else if (stage === "adjustments") {
      content = (
        <AdjustmentsStage
          journey={journey}
          focusHeading={focusHeading}
          message={tripMessage}
          busy={tripBusy}
          accepting={trip.pending === "adjustment"}
          onAccept={(adjustmentId) => void trip.acceptAdjustment(adjustmentId)}
          onOtherDestination={flow.browseDestinations}
          onModify={flow.modify}
        />
      );
    } else if (stage === "no_match") {
      content = (
        <NoMatchStage
          journey={journey}
          focusHeading={focusHeading}
          message={tripMessage}
          busy={tripBusy}
          // Rendering only: with no destination in the server's answer there is none to show.
          onOtherDestination={journey.destinations.length > 0 ? flow.browseDestinations : undefined}
          onModify={flow.modify}
        />
      );
    } else if (stage === "review") {
      content = (
        <ReviewStage
          journey={journey}
          focusHeading={focusHeading}
          message={tripMessage}
          busy={tripBusy}
          sending={trip.pending === "booking"}
          onSend={() => void trip.submitBooking()}
          onOtherItinerary={flow.browseItineraries}
          onOtherDestination={flow.browseDestinations}
          onModify={flow.modify}
        />
      );
    } else if (stage === "booking_pending") {
      content = (
        <BookingPendingStage
          journey={journey}
          focusHeading={focusHeading}
          message={tripMessage}
          busy={tripBusy}
          checking={trip.pending === "check"}
          onCheck={() => void trip.checkBooking()}
        />
      );
    } else if (stage === "booking_refused") {
      content = (
        <ItinerariesStage
          stage="booking_refused"
          heading={frVoice.journey.refused.heading}
          listLabel={frVoice.journey.refused.alternativesLabel}
          itineraries={journey.alternatives}
          selectedId={null}
          notices={journey.notices}
          focusHeading={focusHeading}
          message={tripMessage}
          lead={
            <p className="rounded-xl border border-primary/20 bg-accent/50 px-3 py-2.5 text-base text-foreground [overflow-wrap:anywhere]" data-testid="refused-message">
              {/* The server's reason for the refusal, as received. */}
              {journey.booking?.message ? <span className="block font-medium">{journey.booking.message}</span> : null}
              <span className="block">{frVoice.journey.refused.nothingBooked}</span>
            </p>
          }
          busy={tripBusy}
          choosing={trip.pending === "itinerary"}
          onChoose={(itineraryId) => void trip.chooseItinerary(itineraryId)}
          onOtherDestination={flow.browseDestinations}
          onModify={flow.modify}
        />
      );
    } else if (stage === "booked") {
      content = (
        <BookedStage
          journey={journey}
          focusHeading={focusHeading}
          message={tripMessage}
          busy={tripBusy}
          opening={trip.pending === "travel_file"}
          onOpenFile={flow.openTravelFile}
          onFeedback={flow.openFeedback}
        />
      );
    } else if (stage === "travel_file") {
      content = trip.travelFile && (
        <TravelFileStage
          file={trip.travelFile}
          notices={journey.notices}
          focusHeading={focusHeading}
          onPrint={() => window.print()}
          onBack={flow.closeJourneyView}
          onFeedback={journey.stage === "booked" ? flow.openFeedback : undefined}
        />
      );
    } else if (stage === "feedback") {
      content = (
        <FeedbackStage
          journey={journey}
          focusHeading={focusHeading}
          busy={tripBusy}
          sending={trip.pending === "feedback"}
          onSend={(feedback) => void trip.giveFeedback(feedback)}
          onBack={flow.closeJourneyView}
        />
      );
    } else {
      content = (
        <ClosedStage
          journey={journey}
          focusHeading={focusHeading}
          message={tripMessage}
          busy={tripBusy}
          opening={trip.pending === "travel_file"}
          onOpenFile={flow.openTravelFile}
          onNewTrip={flow.restart}
        />
      );
    }
  } else {
    content = (
      <SheetStage
        conversation={conversation}
        focusHeading={focusHeading}
        lastInput={state.lastInput}
        maxLength={config.max_message_chars}
        disabled={busy}
        demo={isDemoMode}
        onEdit={chat.editField}
        onResend={flow.submitText}
      />
    );
  }

  const showDock = conversation !== null && (stage === "ask" || stage === "listen" || stage === "sheet");
  // Journey stages (and `done`, when a search can start) put their own actions in the dock.
  const showActionDock = conversation !== null && (isJourneyStage(stage) || (stage === "done" && planner.available));
  const ready = conversation?.ready_for_confirmation === true;

  const dock = showDock ? (
    <footer className={cn(styles.dock, styles.safeX)} data-testid="voice-dock">
      {stage === "sheet" ? (
        <p id={statusId} role="status" className="text-center text-sm font-medium text-foreground [overflow-wrap:anywhere]" data-testid="sheet-status">
          {confirmationStatus(conversation)}
        </p>
      ) : null}
      {stage === "ask" && micUsable ? (
        <p id={hintId} className={cn("text-center text-sm text-muted-foreground", styles.compactHidden)} data-testid="talk-hint">
          {frVoice.talk.idleHint}
          <span className="hidden [@media(hover:hover)_and_(pointer:fine)]:block">{frVoice.talk.keyboardHint}</span>
        </p>
      ) : null}
      <div className={styles.dockRow}>
        <div className={styles.dockStart}>
          {stage === "ask" && micUsable && !state.textEntryOpen ? (
            <button type="button" className={cn(DOCK_BUTTON, DOCK_SECONDARY)} onClick={flow.openTextEntry} disabled={busy} data-testid="write-instead">
              <KeyboardIcon aria-hidden="true" />
              {frVoice.ask.writeInstead}
            </button>
          ) : null}
          {stage === "listen" ? (
            <button type="button" className={cn(DOCK_BUTTON, DOCK_ON_ACCENT)} onClick={() => capture.cancel("cancelled")} data-testid="listen-cancel">
              {frVoice.listen.cancel}
            </button>
          ) : null}
          {stage === "sheet" && state.reviewing ? (
            <button type="button" className={cn(DOCK_BUTTON, DOCK_SECONDARY)} onClick={flow.reopenConfirmation} data-testid="back-to-confirmation">
              {state.journeyStage ? frVoice.journey.backToProposals : frVoice.sheet.backToConfirmation}
            </button>
          ) : null}
          {stage === "sheet" && !state.reviewing && micUsable ? (
            <p id={hintId} className={cn("text-xs text-muted-foreground [overflow-wrap:anywhere]", styles.compactHidden)} data-testid="talk-hint">
              {frVoice.talk.idleHintSheet}
            </p>
          ) : null}
        </div>
        <div className={styles.dockTalk}>
          {micUsable ? (
            <TalkButton gesture={gesture} active={recording} disabled={!recording && busy} describedBy={hintId} />
          ) : null}
        </div>
        <div className={styles.dockEnd}>
          {stage === "ask" ? (
            <button type="button" className={cn(DOCK_BUTTON, DOCK_SECONDARY)} onClick={flow.openSheet} disabled={busy} data-testid="see-sheet">
              <ClipboardListIcon aria-hidden="true" />
              {frVoice.ask.seeSheet}
            </button>
          ) : null}
          {stage === "sheet" ? (
            <button
              type="button"
              className={cn(DOCK_BUTTON, DOCK_PRIMARY)}
              // Enabled by the server alone; the sentence above says what is missing.
              disabled={!ready || busy}
              aria-describedby={statusId}
              onClick={flow.confirm}
              data-testid="sheet-confirm"
            >
              {pending === "confirm" ? <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              {pending === "confirm" ? frVoice.sheet.confirming : frVoice.sheet.confirm}
            </button>
          ) : null}
        </div>
      </div>
    </footer>
  ) : showActionDock ? (
    // A distinct element (key): React must never reuse the talk dock's node for the slot the
    // stages portal into.
    <footer key="action-dock" className={cn(styles.dock, styles.safeX)} data-testid="voice-dock" data-dock="actions">
      <div ref={setDockSlot} />
    </footer>
  ) : null;

  const tripError = trip.error && (stage === "done" || isJourneyStage(stage)) ? trip.error : null;
  const tripRetry = tripError?.retry ?? null;
  const showBanners = stage !== "listen" && stage !== "loading";

  return (
    <StageFrame
      stage={stage}
      tone={stage === "listen" ? "accent" : "plain"}
      demo={isDemoMode}
      progress={conversation && stage !== "listen" && stage !== "loading" ? <ProgressDots missingFields={conversation.missing_fields} /> : null}
      showNavigation={stage !== "listen" && stage !== "think"}
      navigationDisabled={tripBusy}
      onRestart={flow.restart}
      announcement={stage === "loading" ? frVoice.chrome.loading : frVoice.announce[stage]}
      mainRef={mainRef}
      dock={dock}
    >
      {showBanners && (notice || state.hint || state.micNotice || state.problem || (error && stage !== "think") || tripError || (state.searchRestart && stage === "sheet")) ? (
        <div className={cn(styles.safeX, styles.noPrint, "mx-auto grid w-full max-w-3xl gap-2 pt-2")} data-testid="voice-banners">
          {state.searchRestart && stage === "sheet" ? (
            <Banner kind="notice" onDismiss={flow.dismissSearchRestart} testId="search-restart-notice">
              {frVoice.journey.restartNotice}
            </Banner>
          ) : null}
          {tripError ? (
            // A technical failure, never "no result": an alert with the server's own words
            // (they say that it is not an absence of result) and a way to try again — unlike
            // the calm `no_match` stage.
            <Banner
              kind="error"
              title={frVoice.journey.error.title}
              action={tripRetry ? { label: frVoice.journey.error.retry, onClick: () => void tripRetry(), disabled: tripBusy } : undefined}
              onDismiss={trip.dismissError}
              testId="journey-error"
            >
              {tripError.detail || frVoice.journey.error.fallback}
            </Banner>
          ) : null}
          {notice ? (
            <Banner kind="notice" onDismiss={chat.dismissNotice} testId="voice-notice">
              {notice}
            </Banner>
          ) : null}
          {state.hint ? (
            <Banner kind="notice" onDismiss={flow.dismissHint} testId="voice-hint">
              {frVoice.hints[state.hint]}
            </Banner>
          ) : null}
          {state.micNotice ? (
            <Banner kind="notice" onDismiss={flow.dismissMicNotice} testId="voice-mic-notice">
              {frVoice.mic[state.micNotice]}
            </Banner>
          ) : null}
          {state.problem ? (
            <Banner kind="error" title={frVoice.problem.rerecordTitle} onDismiss={flow.dismissProblem} testId="voice-problem">
              {`${state.problem}\n${frVoice.problem.rerecordNote}`}
            </Banner>
          ) : null}
          {error && stage !== "think" ? (
            <Banner
              kind="error"
              title={frVoice.problem.title}
              action={
                error.recovery === "retry"
                  ? { label: frVoice.chrome.retry, onClick: () => void chat.retry(), disabled: busy }
                  : error.recovery === "restart"
                    ? { label: frVoice.problem.restart, onClick: flow.restart }
                    : undefined
              }
              onDismiss={chat.dismissError}
              testId="voice-error"
            >
              {error.detail}
            </Banner>
          ) : null}
        </div>
      ) : null}

      <motion.div
        key={stage}
        className={styles.stageSlot}
        // Reduced motion: a cross-fade without movement.
        initial={{ opacity: 0, y: reducedMotion ? 0 : 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reducedMotion ? 0.12 : 0.24, ease: [0.22, 1, 0.36, 1] }}
      >
        <DockSlotContext.Provider value={dockSlot}>{content}</DockSlotContext.Provider>
      </motion.div>
    </StageFrame>
  );
}
