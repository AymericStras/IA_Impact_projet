"use client";

import { fr } from "@/i18n/fr";
import { WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Booking, Itinerary } from "@/types/journey";
import { ItineraryList } from "./ItineraryList";
import { JOURNEY_CARD, JOURNEY_SUBHEADING } from "./journeyStyles";

interface BookingRefusedProps {
  booking: Booking;
  /** `Journey.alternatives`: the other itineraries the server offers after the refusal. */
  alternatives: Itinerary[];
  onChoose: (itineraryId: string) => void;
  busy?: boolean;
}

/** The booking was refused: the server's message, then the alternatives as itinerary cards. */
export function BookingRefused({ booking, alternatives, onChoose, busy = false }: BookingRefusedProps) {
  return (
    <div className="grid min-w-0 gap-3" data-testid="booking-refused">
      <div className={cn(JOURNEY_CARD, WRAP_ANYWHERE)}>
        <p className="text-sm" data-testid="booking-message">
          {booking.message}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{fr.journey.pending.reference(booking.reference)}</p>
      </div>
      {alternatives.length > 0 ? (
        <>
          <h3 className={JOURNEY_SUBHEADING}>{fr.journey.refused.alternatives}</h3>
          <ItineraryList itineraries={alternatives} onChoose={onChoose} busy={busy} />
        </>
      ) : null}
    </div>
  );
}
