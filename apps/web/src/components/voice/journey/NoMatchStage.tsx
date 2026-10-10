"use client";

import { CompassIcon } from "lucide-react";
import { frVoice } from "@/i18n/fr.voice";
import { cn } from "@/lib/utils";
import type { Journey } from "@/types/journey";
import styles from "../voice.module.css";
import { JourneyIntro } from "./JourneyIntro";
import { ActionButton, StageActions } from "./StageActions";

interface NoMatchStageProps {
  journey: Journey;
  focusHeading: boolean;
  message: string | null;
  busy: boolean;
  /** Absent when the server proposed no destination at all: there is none to go back to. */
  onOtherDestination?: () => void;
  onModify: () => void;
}

/**
 * The search worked and found nothing that fits. A result, said calmly — not an error:
 * no alert, no red, no « Réessayer » (trying again would give the same answer). What to do
 * next is the server's sentence; the two ways out are the ones the server allows: another
 * destination, or another request.
 */
export function NoMatchStage({ journey, focusHeading, message, busy, onOtherDestination, onModify }: NoMatchStageProps) {
  return (
    <div className={cn(styles.stage, styles.safeX, "max-w-2xl justify-center gap-4 py-6")} data-testid="stage-no_match">
      <JourneyIntro
        heading={frVoice.journey.noMatch.heading}
        focusHeading={focusHeading}
        message={message}
        notices={journey.notices}
        icon={
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground" aria-hidden="true">
            <CompassIcon className="size-7" />
          </span>
        }
      />
      <StageActions narrow>
        <ActionButton onClick={onModify} disabled={busy} primary={!onOtherDestination} testId="journey-modify">
          {frVoice.journey.changeRequest}
        </ActionButton>
        {onOtherDestination ? (
          <ActionButton primary onClick={onOtherDestination} disabled={busy} testId="journey-destinations">
            {frVoice.journey.changeDestination}
          </ActionButton>
        ) : null}
      </StageActions>
    </div>
  );
}
