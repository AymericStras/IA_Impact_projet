"use client";

import { useId, useState } from "react";
import { frVoice } from "@/i18n/fr.voice";
import { cn } from "@/lib/utils";
import type { Feedback, Journey } from "@/types/journey";
import styles from "../voice.module.css";
import { JourneyIntro } from "./JourneyIntro";
import { ActionButton, StageActions } from "./StageActions";

interface FeedbackStageProps {
  journey: Journey;
  focusHeading: boolean;
  busy: boolean;
  sending: boolean;
  onSend: (feedback: Feedback) => void;
  onBack: () => void;
}

const copy = frVoice.journey.feedback;
const RATINGS = [1, 2, 3, 4, 5] as const;
/** `Feedback.comment` of the contract. */
const COMMENT_MAX = 1000;

/**
 * A rating from 1 to 5 and an optional comment. Native radio buttons behind large targets:
 * Tab reaches the group, the arrow keys move the rating, and nothing is sent before
 * « Envoyer mon avis ».
 */
export function FeedbackStage({ journey, focusHeading, busy, sending, onSend, onBack }: FeedbackStageProps) {
  const [rating, setRating] = useState<Feedback["rating"] | null>(null);
  const [comment, setComment] = useState("");
  const groupName = useId();
  const commentId = useId();
  const hintId = useId();

  const send = () => {
    if (rating === null) return;
    const trimmed = comment.trim();
    onSend({ rating, comment: trimmed === "" ? null : trimmed });
  };

  return (
    <div className={cn(styles.stage, styles.safeX, "max-w-2xl gap-5 py-6")} data-testid="stage-feedback">
      <JourneyIntro heading={copy.heading} focusHeading={focusHeading} message={copy.question} notices={journey.notices} />

      <fieldset className="grid min-w-0 gap-2" data-testid="feedback-rating">
        <legend className="mb-2 text-base font-medium text-foreground">{copy.ratingLabel}</legend>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,6.5rem),1fr))] gap-2">
          {RATINGS.map((value) => {
            const checked = rating === value;
            return (
              <label
                key={value}
                className={cn(
                  "relative flex min-h-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-full border-2 px-2 py-2 text-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                  checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-foreground hover:bg-muted",
                  busy && "pointer-events-none opacity-60",
                )}
                data-testid={`feedback-rating-${value}`}
                data-selected={checked}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={value}
                  checked={checked}
                  disabled={busy}
                  onChange={() => setRating(value)}
                  aria-label={copy.ratingSpoken(value, copy.ratings[value])}
                  className="absolute inset-0 size-full cursor-pointer text-base opacity-0"
                />
                <span className="text-2xl font-semibold leading-none tabular-nums" aria-hidden="true">
                  {value}
                </span>
                <span className="text-sm font-medium [overflow-wrap:anywhere]" aria-hidden="true">
                  {copy.ratings[value]}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-1.5">
        <label htmlFor={commentId} className="text-base font-medium text-foreground">
          {copy.commentLabel}
        </label>
        <textarea
          id={commentId}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          maxLength={COMMENT_MAX}
          rows={3}
          disabled={busy}
          placeholder={copy.commentPlaceholder}
          className="w-full min-w-0 rounded-xl border-2 border-input bg-card px-3 py-2 text-base text-foreground placeholder:text-muted-foreground disabled:opacity-60"
          data-testid="feedback-comment"
        />
      </div>
      {rating === null ? (
        <p id={hintId} className="text-sm text-muted-foreground" data-testid="feedback-hint">
          {copy.chooseFirst}
        </p>
      ) : null}

      <StageActions narrow>
        <ActionButton onClick={onBack} disabled={busy} testId="feedback-back">
          {frVoice.journey.back}
        </ActionButton>
        <ActionButton primary busy={sending} disabled={busy || rating === null} aria-describedby={rating === null ? hintId : undefined} onClick={send} testId="feedback-send">
          {sending ? copy.sending : copy.send}
        </ActionButton>
      </StageActions>
    </div>
  );
}
