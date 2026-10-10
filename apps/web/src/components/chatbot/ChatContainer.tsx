"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { InfoIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useConversation } from "@/hooks/useConversation";
import { useJourney } from "@/hooks/useJourney";
import { useHeightVariable, useKeyboardInset } from "@/hooks/useViewportTracking";
import { fr } from "@/i18n/fr";
import { isDemoMode } from "@/lib/env";
import { TOUCH_TARGET, WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { ConversationService, JourneyService } from "@/services";
import { ConfirmationCard } from "./ConfirmationCard";
import { ConversationThread } from "./ConversationThread";
import { ErrorMessage } from "./ErrorMessage";
import { JourneyInterruptedNotice } from "./journey/JourneyInterruptedNotice";
import { JOURNEY_REGION_ID, JourneyPanel } from "./journey/JourneyPanel";
import { LoadingState } from "./LoadingState";
import { MessageComposer } from "./MessageComposer";
import { RequirementsPanel } from "./RequirementsPanel";
import { TopBar } from "./TopBar";

const PANEL_ID = "requirements-panel";

interface ChatContainerProps {
  /** Injectable service (tests); defaults to the one selected by NEXT_PUBLIC_DEMO_MODE. */
  service?: ConversationService;
  /** Injectable journey service (tests); same default rule. */
  journeyService?: JourneyService;
}

/**
 * Orchestrates the page: top bar, conversation thread + composer,
 * "Votre projet" panel. All business state comes from `useConversation`, and from
 * `useJourney` for what follows the confirmation (docs/PLANNER_CONTRACT.md): the journey is
 * shown under the confirmed card while the project is CONFIRMED and the server's
 * `planner_mode` is not "off".
 *
 * The page is a viewport-high shell (`.app-shell`): only the thread (and, in two-column
 * layouts, the panel column) scrolls. The composer is a normal flex item below the thread,
 * so it can never cover a message or the confirmation card. If the shell cannot hold its
 * minimum content (extreme zoom, very large text) it scrolls as a whole instead of
 * squeezing the thread to nothing.
 *
 * Responsive behaviour is driven by the tiers declared in globals.css (`wide`, `single`,
 * `short`, `narrow`…), which are container queries on the shell.
 */
export function ChatContainer({ service, journeyService }: ChatContainerProps) {
  const chat = useConversation(service);
  const [draft, setDraft] = useState("");
  const [editRequest, setEditRequest] = useState(0);
  const [journeyView, setJourneyView] = useState("");
  const [journeyInterrupted, setJourneyInterrupted] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const { conversation, config, pending, error, notice } = chat;
  const busy = pending !== null;
  const latestAssistant = conversation?.assistant_message ?? null;
  const confirmed =
    conversation?.state === "CONFIRMED" ? (conversation.confirmed_requirements ?? null) : null;

  // Unknown until `GET /config` answers: no journey is offered before the server says so.
  const plannerMode = config.planner_mode ?? "off";
  const conversationId = conversation?.conversation_id ?? null;
  const journeyEnabled = confirmed !== null && plannerMode !== "off";
  const journey = useJourney({
    conversationId,
    enabled: journeyEnabled,
    // An accepted time adjustment changed the requirements on the server: show them.
    onRequirementsChanged: chat.refresh,
    service: journeyService,
  });

  // Editing a requirement clears the confirmation, and the journey with it (on the server
  // too). Say so when proposals were on screen; a new confirmation or conversation clears it.
  const hasJourney = journeyEnabled && journey.journey !== null;
  const previousRef = useRef({ conversationId, confirmed: false, hadJourney: false });
  useEffect(() => {
    const previous = previousRef.current;
    const isConfirmed = confirmed !== null;
    if (previous.conversationId !== conversationId || isConfirmed) setJourneyInterrupted(false);
    else if (previous.confirmed && previous.hadJourney) setJourneyInterrupted(true);
    previousRef.current = { conversationId, confirmed: isConfirmed, hadJourney: hasJourney };
  }, [conversationId, confirmed, hasJourney]);

  useKeyboardInset(shellRef);
  // The expanded panel (single-column layouts) is capped to the conversation area.
  useHeightVariable(threadRef, mainRef, "--thread-height", conversation !== null);

  // The journey sits under the JSON block: bring its start into view on request. Only the
  // thread moves (instantly): `scrollIntoView` would also scroll the shell around it.
  const showJourney = useCallback(() => {
    const target = document.getElementById(JOURNEY_REGION_ID);
    const scroller = target?.closest<HTMLElement>("[data-thread-scroll]");
    if (!target || !scroller) return;
    scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
  }, []);

  const sendText = useCallback(
    async (content: string, source: "text" | "audio") => {
      const outcome = await chat.send(content, source);
      // Nothing was applied and no error block holds the text: give it back to the user.
      if (outcome === "draft_kept") setDraft((current) => current || content);
    },
    [chat],
  );

  const dismissError = useCallback(() => {
    if (error?.failedContent) setDraft((current) => current || (error.failedContent ?? ""));
    chat.dismissError();
  }, [chat, error]);

  const footerKey = [
    error ? "error" : "",
    confirmed ? "confirmed" : conversation?.ready_for_confirmation ? "confirm" : "",
    journeyEnabled ? journeyView : "",
  ].join("|");

  return (
    <TooltipProvider>
      <div ref={shellRef} className="app-shell flex flex-col overflow-x-hidden overflow-y-auto" data-testid="app-shell">
        <a
          href="#composer-input"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          {fr.app.skipToComposer}
        </a>
        <TopBar onRestart={() => void chat.restart()} disabled={busy} />

        {isDemoMode ? (
          <p className="sr-only" role="note">
            {fr.demo.description}
          </p>
        ) : null}

        {/* Discreet announcement of the latest reply for screen readers. */}
        <div aria-live="polite" aria-atomic="true" className="sr-only" aria-label={fr.conversation.liveRegionLabel}>
          {latestAssistant}
        </div>

        <main
          ref={mainRef}
          className={cn(
            "px-safe mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col",
            "wide:grid wide:grid-cols-[minmax(0,1fr)_17.5rem] wide:grid-rows-[minmax(0,1fr)] wide:gap-4",
            "roomy:grid-cols-[minmax(0,1fr)_22rem] roomy:gap-6 spacious:grid-cols-[minmax(0,1fr)_24rem]",
          )}
        >
          <aside
            className={cn(
              "thin-scrollbar relative z-10 shrink-0",
              "single:tall:pt-3 single:tall:pb-1 single:short:pt-1.5",
              "wide:order-2 wide:min-h-0 wide:overflow-y-auto wide:tall:py-6 wide:short:py-2",
            )}
            data-testid="panel-region"
          >
            {conversation ? (
              <RequirementsPanel
                id={PANEL_ID}
                requirements={conversation.requirements}
                missingFields={conversation.missing_fields}
                pendingClarification={conversation.pending_clarification ?? null}
                state={conversation.state}
                disabled={busy}
                onEdit={chat.editField}
                editRequest={editRequest}
              />
            ) : null}
          </aside>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col wide:order-1" aria-label={fr.conversation.heading}>
            {conversation ? (
              <ConversationThread
                ref={threadRef}
                className="flex-1"
                messages={conversation.messages}
                optimisticMessage={chat.optimisticMessage}
                typing={pending === "message"}
                optimisticFailed={Boolean(error && chat.optimisticMessage)}
                footerKey={footerKey}
              >
                {error ? (
                  <ErrorMessage
                    detail={error.detail}
                    onRetry={
                      error.recovery === "retry"
                        ? () => void chat.retry()
                        : error.recovery === "restart"
                          ? () => void chat.restart()
                          : undefined
                    }
                    retryLabel={error.recovery === "restart" ? fr.app.newConversation : undefined}
                    onDismiss={dismissError}
                  />
                ) : null}
                {journeyInterrupted && !journeyEnabled ? <JourneyInterruptedNotice /> : null}
                <ConfirmationCard
                  ready={conversation.ready_for_confirmation}
                  confirmedRequirements={confirmed}
                  onConfirm={() => void chat.confirm()}
                  onEdit={() => setEditRequest((n) => n + 1)}
                  pending={pending === "confirm"}
                  onContinue={journeyEnabled ? showJourney : undefined}
                />
                {journeyEnabled ? (
                  <JourneyPanel
                    state={journey}
                    simulated={plannerMode === "simulated"}
                    onEditRequest={() => setEditRequest((n) => n + 1)}
                    onViewChange={setJourneyView}
                  />
                ) : null}
              </ConversationThread>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto py-4">
                {chat.status === "failed" ? (
                  <ErrorMessage detail={error?.detail ?? fr.errors.initFailed} onRetry={() => void chat.retry()} />
                ) : (
                  <LoadingState />
                )}
              </div>
            )}

            <div
              className="shrink-0 tall:pt-2 tall:pb-[max(0.75rem,env(safe-area-inset-bottom))] short:pt-1 short:pb-[max(0.25rem,env(safe-area-inset-bottom))]"
              data-testid="composer-region"
            >
              {notice ? (
                <div
                  role="status"
                  className="mb-2 flex items-start gap-2 rounded-xl border border-primary/20 bg-accent/50 px-3 py-2 text-sm"
                  data-testid="notice"
                >
                  <InfoIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <p className={cn("flex-1", WRAP_ANYWHERE)}>{notice}</p>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={chat.dismissNotice}
                    aria-label={fr.errors.dismiss}
                    className={cn("shrink-0", TOUCH_TARGET)}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </div>
              ) : null}
              <MessageComposer
                value={draft}
                onChange={setDraft}
                onSend={(content) => void sendText(content, "text")}
                onSendTranscript={(content) => void sendText(content, "audio")}
                onTranscribe={chat.transcribe}
                disabled={busy || !conversation}
                sending={pending === "message"}
                maxLength={config.max_message_chars}
                maxAudioSeconds={config.max_audio_seconds}
              />
            </div>
          </section>
        </main>
      </div>
    </TooltipProvider>
  );
}
