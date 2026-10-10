"use client";

import { HeartHandshakeIcon, PlusIcon } from "lucide-react";
import { frVoice } from "@/i18n/fr.voice";
import { WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Journey } from "@/types/journey";
import styles from "../voice.module.css";
import { JourneyIntro } from "./JourneyIntro";
import { ActionButton, StageActions } from "./StageActions";

interface ClosedStageProps {
  journey: Journey;
  focusHeading: boolean;
  message: string | null;
  busy: boolean;
  opening: boolean;
  onOpenFile: () => void;
  onNewTrip: () => void;
}

const copy = frVoice.journey.closed;

/** The end: thanks, the feedback as the server recorded it, and a new trip. */
export function ClosedStage({ journey, focusHeading, message, busy, opening, onOpenFile, onNewTrip }: ClosedStageProps) {
  const feedback = journey.feedback;
  return (
    <div className={cn(styles.stage, styles.safeX, "max-w-2xl justify-center gap-5 py-6")} data-testid="stage-closed">
      <JourneyIntro
        heading={copy.heading}
        focusHeading={focusHeading}
        message={message}
        notices={journey.notices}
        icon={
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground" aria-hidden="true">
            <HeartHandshakeIcon className="size-7" />
          </span>
        }
      />
      {feedback ? (
        <section className="rounded-2xl border bg-card p-4" data-testid="closed-feedback">
          <p className="text-xl font-semibold text-foreground">{copy.rating(feedback.rating)}</p>
          {feedback.comment ? (
            <>
              <h2 className="mt-2 text-sm font-medium text-muted-foreground">{copy.comment}</h2>
              {/* The teacher's own text, as a text node. */}
              <p className={cn("whitespace-pre-wrap text-base text-foreground", WRAP_ANYWHERE)}>{feedback.comment}</p>
            </>
          ) : null}
        </section>
      ) : null}

      <StageActions narrow>
        <ActionButton busy={opening} onClick={onOpenFile} disabled={busy} testId="closed-open-file">
          {copy.reopenFile}
        </ActionButton>
        <ActionButton primary onClick={onNewTrip} disabled={busy} testId="closed-new">
          <PlusIcon aria-hidden="true" />
          {copy.newTrip}
        </ActionButton>
      </StageActions>
    </div>
  );
}
