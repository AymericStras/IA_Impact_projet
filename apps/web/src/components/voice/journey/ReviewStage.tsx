"use client";

import { InfoIcon } from "lucide-react";
import { frVoice } from "@/i18n/fr.voice";
import { WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Journey } from "@/types/journey";
import styles from "../voice.module.css";
import { ItineraryView } from "./ItineraryView";
import { JourneyIntro } from "./JourneyIntro";
import { ActionButton, StageActions } from "./StageActions";
import { changeSpoken, changeText, selectedItinerary } from "./journeyDisplay";

interface ReviewStageProps {
  journey: Journey;
  focusHeading: boolean;
  message: string | null;
  busy: boolean;
  sending: boolean;
  onSend: () => void;
  onOtherItinerary: () => void;
  onOtherDestination: () => void;
  onModify: () => void;
}

const copy = frVoice.journey.review;

/**
 * Last look before anything is sent: the chosen itinerary in full, the adjustments the
 * teacher accepted on the way (with their before and after values), and the plain
 * statement that nothing is booked yet.
 */
export function ReviewStage({ journey, focusHeading, message, busy, sending, onSend, onOtherItinerary, onOtherDestination, onModify }: ReviewStageProps) {
  const itinerary = selectedItinerary(journey);

  return (
    <div className={cn(styles.stage, styles.safeX, "max-w-3xl gap-4 py-5")} data-testid="stage-review">
      <JourneyIntro heading={copy.heading} focusHeading={focusHeading} message={message} notices={journey.notices} />

      <p className="flex items-start gap-2 rounded-xl border border-primary/20 bg-accent/50 px-3 py-2.5 text-base font-medium text-foreground" data-testid="review-not-booked">
        <InfoIcon className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
        {copy.notBooked}
      </p>

      {itinerary ? (
        <ItineraryView itinerary={itinerary} testId="review-itinerary" />
      ) : (
        <p className="text-lg text-foreground" data-testid="review-missing">
          {copy.missing}
        </p>
      )}

      {journey.accepted_adjustments.length > 0 ? (
        <section className="grid gap-2 rounded-2xl border bg-card p-4" aria-labelledby="review-accepted-title" data-testid="review-accepted">
          <h2 id="review-accepted-title" className="text-sm font-medium text-muted-foreground">
            {copy.acceptedTitle}
          </h2>
          <ul className="grid gap-2">
            {journey.accepted_adjustments.map((adjustment) => (
              <li key={adjustment.id} className={cn("grid gap-0.5 text-base text-foreground", WRAP_ANYWHERE)}>
                <span className="font-semibold">{adjustment.label}</span>
                {adjustment.changes.map((change) => (
                  <span key={change.field} className="tabular-nums">
                    <span aria-hidden="true">{changeText(change)}</span>
                    <span className="sr-only">{changeSpoken(change)}</span>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <StageActions>
        <ActionButton onClick={onOtherItinerary} disabled={busy} testId="review-other-itinerary">
          {copy.otherItinerary}
        </ActionButton>
        <ActionButton onClick={onOtherDestination} disabled={busy} testId="journey-destinations">
          {frVoice.journey.changeDestination}
        </ActionButton>
        <ActionButton onClick={onModify} disabled={busy} testId="journey-modify">
          {frVoice.journey.changeRequest}
        </ActionButton>
        <ActionButton primary busy={sending} disabled={busy || itinerary === null} onClick={onSend} testId="review-send">
          {sending ? copy.sending : copy.send}
        </ActionButton>
      </StageActions>
    </div>
  );
}
