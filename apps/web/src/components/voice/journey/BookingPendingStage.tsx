"use client";

import { CheckIcon, CircleIcon, Loader2Icon } from "lucide-react";
import { frVoice } from "@/i18n/fr.voice";
import { WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Journey } from "@/types/journey";
import styles from "../voice.module.css";
import { JourneyIntro } from "./JourneyIntro";
import { ActionButton, StageActions } from "./StageActions";

interface BookingPendingStageProps {
  journey: Journey;
  focusHeading: boolean;
  message: string | null;
  busy: boolean;
  /** A check of the answer is in flight (the automatic one, or the teacher's). */
  checking: boolean;
  onCheck: () => void;
}

const copy = frVoice.journey.pending;

/**
 * The request is sent and the answer is awaited. Same language as the think stage: the
 * real steps, each with its actual state in words. The choice can no longer be changed
 * here (the server refuses it), so this stage offers one thing: checking the answer.
 */
export function BookingPendingStage({ journey, focusHeading, message, busy, checking, onCheck }: BookingPendingStageProps) {
  const booking = journey.booking;

  return (
    <div className={cn(styles.stage, styles.safeX, "max-w-2xl justify-center gap-5 py-6")} data-testid="stage-booking_pending">
      <JourneyIntro heading={copy.heading} focusHeading={focusHeading} message={message} notices={journey.notices} />

      <ol className="grid gap-3" aria-label={copy.stepsLabel}>
        <li className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-lg [overflow-wrap:anywhere]" data-testid="pending-step-sent" data-state="done">
          <span className="flex size-6 items-center justify-center rounded-full bg-success text-success-foreground">
            <CheckIcon className="size-4" strokeWidth={3} aria-hidden="true" />
          </span>
          <span className="font-medium text-foreground">{copy.sent}</span>
          <span className="text-sm text-muted-foreground">{frVoice.think.stepDone}</span>
        </li>
        <li
          className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-lg [overflow-wrap:anywhere]"
          data-testid="pending-step-answer"
          data-state={checking ? "active" : "waiting"}
          aria-current="step"
        >
          {checking ? (
            <Loader2Icon className="size-6 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <CircleIcon className="size-6 text-input" aria-hidden="true" />
          )}
          <span className="font-medium text-foreground">{copy.answer}</span>
          <span className="text-sm text-muted-foreground" role="status">
            {checking ? frVoice.think.stepActive : frVoice.think.stepWaiting}
          </span>
        </li>
      </ol>

      {booking ? (
        <section className="rounded-2xl border bg-card p-4" data-testid="pending-booking">
          <p className={cn("text-xl font-semibold text-foreground tabular-nums", WRAP_ANYWHERE)} data-testid="booking-reference">
            {copy.reference(booking.reference)}
          </p>
          {/* The booking's own line, unless the stage line above already says exactly that. */}
          {booking.message && booking.message !== message ? <p className={cn("mt-1 text-base text-foreground", WRAP_ANYWHERE)}>{booking.message}</p> : null}
        </section>
      ) : null}
      <p className="text-sm text-muted-foreground">{copy.autoNote}</p>

      <StageActions narrow>
        <ActionButton primary busy={checking} disabled={busy} onClick={onCheck} testId="booking-check">
          {checking ? copy.checking : copy.check}
        </ActionButton>
      </StageActions>
    </div>
  );
}
