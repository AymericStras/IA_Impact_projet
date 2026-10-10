"use client";

import { useId } from "react";
import { ArrowRightIcon, CheckIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fr } from "@/i18n/fr";
import { formatTimeNoWrap } from "@/lib/format";
import { FLUID_BUTTON, TOUCH_TARGET, WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Adjustment } from "@/types/journey";
import { JOURNEY_CARD } from "./journeyStyles";

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
      className={cn("flex flex-col gap-2.5", JOURNEY_CARD)}
      data-testid="adjustment-card"
      data-kind={adjustment.kind}
    >
      <div className={cn("grid gap-1.5", WRAP_ANYWHERE)}>
        <h3 id={`${id}-title`} className="text-sm font-semibold">
          {adjustment.label}
        </h3>
        {showReason ? <p className="text-xs text-muted-foreground">{adjustment.reason}</p> : null}
        {adjustment.changes.map((change, index) => (
          <p key={index} className="flex flex-wrap items-center gap-x-1.5 text-sm" data-testid="adjustment-change">
            <span className="text-muted-foreground">{fr.fields[change.field].label} :</span>{" "}
            <span className="tabular-nums">{formatTimeNoWrap(change.before)}</span>
            <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only"> {fr.journey.adjustments.becomes} </span>
            <span className="font-semibold tabular-nums">{formatTimeNoWrap(change.after)}</span>
          </p>
        ))}
        <p className="flex items-start gap-1.5 text-sm font-medium text-primary" data-testid="adjustment-unlocks">
          <ArrowRightIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
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
          className={cn("border-primary/40 text-primary", FLUID_BUTTON, TOUCH_TARGET)}
        >
          {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <CheckIcon aria-hidden="true" />}
          {pending ? fr.journey.adjustments.accepting : fr.journey.adjustments.accept}
        </Button>
      </div>
    </article>
  );
}
