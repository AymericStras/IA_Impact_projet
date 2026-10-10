import { fr } from "@/i18n/fr";
import { WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Feedback } from "@/types/journey";
import { JOURNEY_CARD } from "./journeyStyles";

/** The feedback the server recorded, shown back once the journey is closed. */
export function FeedbackGiven({ feedback }: { feedback: Feedback }) {
  return (
    <div className={cn(JOURNEY_CARD, WRAP_ANYWHERE)} data-testid="feedback-given">
      <p className="font-heading text-xl leading-tight font-extrabold">{fr.journey.feedback.given(feedback.rating)}</p>
      {feedback.comment ? <p className="mt-1.5 text-[0.9375rem] whitespace-pre-wrap">{feedback.comment}</p> : null}
    </div>
  );
}
