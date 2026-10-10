"use client";

import { CheckIcon } from "lucide-react";
import { frVoice } from "@/i18n/fr.voice";
import { WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Journey } from "@/types/journey";
import styles from "../voice.module.css";
import { JourneyIntro } from "./JourneyIntro";
import { ActionButton, StageActions } from "./StageActions";

interface BookedStageProps {
  journey: Journey;
  focusHeading: boolean;
  message: string | null;
  busy: boolean;
  /** The travel file is being fetched. */
  opening: boolean;
  onOpenFile: () => void;
  onFeedback: () => void;
}

/**
 * The server confirmed the booking. Success in words and icon, the server's own message
 * (which says that the booking is simulated), then one thing to do: open the travel file.
 */
export function BookedStage({ journey, focusHeading, message, busy, opening, onOpenFile, onFeedback }: BookedStageProps) {
  const booking = journey.booking;
  return (
    <div className={cn(styles.stage, styles.safeX, "max-w-2xl justify-center gap-5 py-6")} data-testid="stage-booked">
      <JourneyIntro
        heading={frVoice.journey.booked.heading}
        focusHeading={focusHeading}
        message={message}
        notices={journey.notices}
        icon={
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground" aria-hidden="true">
            <CheckIcon className="size-7" strokeWidth={3} />
          </span>
        }
      />
      {booking ? (
        <section className="rounded-2xl border border-success/40 bg-success-soft/60 p-4" data-testid="booked-booking">
          <p className={cn("text-xl font-semibold text-foreground tabular-nums", WRAP_ANYWHERE)} data-testid="booking-reference">
            {frVoice.journey.pending.reference(booking.reference)}
          </p>
          {/* The booking's own line, unless the stage line above already says exactly that. */}
          {booking.message && booking.message !== message ? <p className={cn("mt-1 text-base text-foreground", WRAP_ANYWHERE)}>{booking.message}</p> : null}
        </section>
      ) : null}

      <StageActions narrow>
        <ActionButton onClick={onFeedback} disabled={busy} testId="booked-feedback">
          {frVoice.journey.booked.giveFeedback}
        </ActionButton>
        <ActionButton primary busy={opening} disabled={busy} onClick={onOpenFile} testId="booked-open-file">
          {opening ? frVoice.journey.booked.openingFile : frVoice.journey.booked.openFile}
        </ActionButton>
      </StageActions>
    </div>
  );
}
