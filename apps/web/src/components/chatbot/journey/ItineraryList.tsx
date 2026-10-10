"use client";

import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fr } from "@/i18n/fr";
import { FLUID_BUTTON, TOUCH_TARGET } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Itinerary } from "@/types/journey";
import { ItineraryCard } from "./ItineraryCard";

interface ItineraryListProps {
  /** Itineraries in the server's order (`Journey.itineraries` or `Journey.alternatives`). */
  itineraries: Itinerary[];
  onChoose: (itineraryId: string) => void;
  /** Marks the itinerary the server holds as selected. */
  selectedItineraryId?: string | null;
  busy?: boolean;
}

/** Itineraries side by side when the width allows, so that they can be compared line by line. */
export function ItineraryList({ itineraries, onChoose, selectedItineraryId = null, busy = false }: ItineraryListProps) {
  // Only remembers which button was pressed, to put the spinner on that card.
  const [submitted, setSubmitted] = useState<string | null>(null);
  return (
    <ul
      aria-label={fr.journey.itinerary.listLabel}
      className="grid min-w-0 gap-3 @[40rem]/journey:grid-cols-2 @[62rem]/journey:grid-cols-3"
      data-testid="itinerary-list"
    >
      {itineraries.map((itinerary) => {
        const pending = busy && submitted === itinerary.id;
        return (
          <li key={itinerary.id} className="flex min-w-0 flex-col *:flex-1">
            <ItineraryCard itinerary={itinerary} className={itinerary.id === selectedItineraryId ? "border-primary/50" : undefined}>
              {(titleId) => (
                <Button
                  type="button"
                  onClick={() => {
                    setSubmitted(itinerary.id);
                    onChoose(itinerary.id);
                  }}
                  disabled={busy}
                  aria-describedby={titleId}
                  className={cn(FLUID_BUTTON, TOUCH_TARGET)}
                >
                  {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
                  {pending ? fr.journey.itinerary.choosing : fr.journey.itinerary.choose}
                </Button>
              )}
            </ItineraryCard>
          </li>
        );
      })}
    </ul>
  );
}
