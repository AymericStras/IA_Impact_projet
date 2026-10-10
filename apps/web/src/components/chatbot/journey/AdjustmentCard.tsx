"use client";

import { useId } from "react";
import { ArrowRightIcon, CheckIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fr } from "@/i18n/fr";
import { formatTimeNoWrap } from "@/lib/format";
import { FLUID_BUTTON, TOUCH_TARGET, WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Adjustment } from "@/types/journey";
import { JOURNEY_CARD, JOURNEY_CARD_TITLE, JOURNEY_PILL } from "./journeyStyles";

interface AdjustmentCardProps {
  adjustment: Adjustment;
  /** Shown on the card when the adjustments of the list do not share one reason. */
  showReason?: boolean;
  onAccept: () => void;
  pending?: boolean;
  disabled?: boolean;
}

/**
 * One adjustment the teacher may accept: what changes (the server's sentence), the
 * before → after value of each time change, and how many itineraries it unlocks.
 * Nothing is applied until the button of this card is pressed.
 */
export function AdjustmentCard({ adjustment, showReason = false, onAccept, pending = false, disabled = false }: AdjustmentCardProps) {
  const id = useId();
  return (
    <article
      aria-labelledby={`${id}-title`}
      className={cn("flex flex-col gap-4 short:gap-3", JOURNEY_CARD)}
      data-testid="adjustment-card"
      data-kind={adjustment.kind}
    >
      <div className={cn("grid justify-items-start gap-2", WRAP_ANYWHERE)}>
        <h3 id={`${id}-title`} className={JOURNEY_CARD_TITLE}>
          {adjustment.label}
        </h3>
        {showReason ? <p className="text-[0.8125rem] text-muted-foreground">{adjustment.reason}</p> : null}
        {adjustment.changes.map((change, index) => (
          // Before and after are both plainly legible (no strike-through): the teacher compares them.
          <p key={index} className="flex flex-wrap items-baseline gap-x-2 text-[0.9375rem]" data-testid="adjustment-change">
            <span className="font-medium text-muted-foreground">{fr.fields[change.field].label} :</span>{" "}
            <span className="font-medium tabular-nums">{formatTimeNoWrap(change.before)}</span>
            <ArrowRightIcon className="size-4 shrink-0 self-center text-primary" aria-hidden="true" />
            <span className="sr-only"> {fr.journey.adjustments.becomes} </span>
            <span className="font-heading text-xl leading-none font-extrabold tabular-nums">{formatTimeNoWrap(change.after)}</span>
          </p>
        ))}
        <p className={cn(JOURNEY_PILL, "items-start rounded-2xl")} data-testid="adjustment-unlocks">
          <ArrowRightIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{fr.journey.adjustments.unlocks(adjustment.unlocks)}</span>
        </p>
      </div>
      <div className="mt-auto flex flex-col">
        <Button
          type="button"
          variant="outline"
          onClick={onAccept}
          disabled={disabled || pending}
          aria-describedby={`${id}-title`}
          className={cn(FLUID_BUTTON, TOUCH_TARGET)}
        >
          {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <CheckIcon aria-hidden="true" />}
          {pending ? fr.journey.adjustments.accepting : fr.journey.adjustments.accept}
        </Button>
      </div>
    </article>
  );
}
