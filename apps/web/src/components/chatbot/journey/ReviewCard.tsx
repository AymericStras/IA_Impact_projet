"use client";

import { InfoIcon, Loader2Icon, SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fr } from "@/i18n/fr";
import { FLUID_BUTTON, TOUCH_TARGET, WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Itinerary } from "@/types/journey";
import { ItineraryCard } from "./ItineraryCard";

interface ReviewCardProps {
  /** The itinerary the server holds as selected. */
  itinerary: Itinerary;
  onSubmit: () => void;
  /** Shows the other itineraries again; absent when there is no other one to show. */
  onOtherItinerary?: () => void;
  submitting?: boolean;
  busy?: boolean;
}

/** Last check before anything is sent: the chosen itinerary in full, and what sending means. */
export function ReviewCard({ itinerary, onSubmit, onOtherItinerary, submitting = false, busy = false }: ReviewCardProps) {
  return (
    <div className="grid min-w-0 gap-3" data-testid="journey-review">
      <ItineraryCard itinerary={itinerary} />
      <p className="flex items-start gap-2 text-sm font-medium" data-testid="review-not-booked">
        <InfoIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <span className={cn("flex-1", WRAP_ANYWHERE)}>{fr.journey.review.notBooked}</span>
      </p>
      <div className="flex flex-col gap-2 @[30rem]/journey:flex-row @[30rem]/journey:justify-end">
        {onOtherItinerary ? (
          <Button type="button" variant="outline" onClick={onOtherItinerary} disabled={busy} className={cn(FLUID_BUTTON, TOUCH_TARGET)}>
            {fr.journey.review.otherItinerary}
          </Button>
        ) : null}
        <Button type="button" onClick={onSubmit} disabled={busy} className={cn(FLUID_BUTTON, TOUCH_TARGET)} data-testid="booking-submit">
          {submitting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <SendIcon aria-hidden="true" />}
          {submitting ? fr.journey.review.submitting : fr.journey.review.submit}
        </Button>
      </div>
    </div>
  );
}
