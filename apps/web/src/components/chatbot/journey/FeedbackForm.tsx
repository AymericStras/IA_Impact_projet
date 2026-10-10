"use client";

import { useId, useState, type FormEvent } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fr } from "@/i18n/fr";
import { FLUID_BUTTON, TOUCH_TARGET, WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Feedback } from "@/types/journey";
import { CHOICE_FOCUS, CHOICE_INPUT, JOURNEY_CARD, JOURNEY_CARD_TITLE, JOURNEY_SUBHEADING } from "./journeyStyles";

const RATINGS = [1, 2, 3, 4, 5] as const;
/** Same limit as the server; the server remains the authority. */
const COMMENT_MAX_LENGTH = 1000;

interface FeedbackFormProps {
  onSubmit: (feedback: Feedback) => void;
  pending?: boolean;
  disabled?: boolean;
}

/**
 * Feedback after a confirmed booking: a 1–5 rating (native radio group: arrow keys move,
 * Tab enters and leaves) and an optional comment.
 */
export function FeedbackForm({ onSubmit, pending = false, disabled = false }: FeedbackFormProps) {
  const id = useId();
  const [rating, setRating] = useState<Feedback["rating"] | null>(null);
  const [comment, setComment] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (rating === null) return;
    const trimmed = comment.trim();
    onSubmit(trimmed ? { rating, comment: trimmed } : { rating });
  };

  return (
    <form onSubmit={submit} aria-labelledby={`${id}-title`} className={cn("grid gap-4 short:gap-3", JOURNEY_CARD)} data-testid="feedback-form">
      <h3 id={`${id}-title`} className={cn(JOURNEY_CARD_TITLE, WRAP_ANYWHERE)}>
        {fr.journey.feedback.title}
      </h3>
      <fieldset className="min-w-0" disabled={disabled || pending}>
        <legend className={JOURNEY_SUBHEADING}>{fr.journey.feedback.ratingLegend}</legend>
        <div className="mt-2 flex flex-wrap gap-2.5">
          {RATINGS.map((value) => (
            <label
              key={value}
              className={cn(
                "relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border-2 border-primary px-3 py-1.5 font-heading text-lg leading-none font-extrabold transition-colors",
                CHOICE_FOCUS,
                rating === value ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
              )}
            >
              <input
                type="radio"
                name={`${id}-rating`}
                value={value}
                checked={rating === value}
                onChange={() => setRating(value)}
                aria-label={fr.journey.feedback.rating(value)}
                // Stretched over the cell's border too, so the hit area is the full 44 px cell.
                className={cn(CHOICE_INPUT, "-inset-0.5 h-[calc(100%+4px)] w-[calc(100%+4px)]")}
                data-focus-inside=""
              />
              <span aria-hidden="true">{value}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid min-w-0 gap-1.5">
        <Label className="px-1 text-[0.8125rem] font-semibold" htmlFor={`${id}-comment`}>{fr.journey.feedback.commentLabel}</Label>
        <Textarea
          id={`${id}-comment`}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          maxLength={COMMENT_MAX_LENGTH}
          disabled={disabled || pending}
          rows={2}
        />
      </div>
      <div className="flex flex-col @[24rem]/journey:flex-row @[24rem]/journey:justify-end">
        <Button type="submit" disabled={rating === null || disabled || pending} className={cn(FLUID_BUTTON, TOUCH_TARGET)}>
          {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          {pending ? fr.journey.feedback.submitting : fr.journey.feedback.submit}
        </Button>
      </div>
    </form>
  );
}
