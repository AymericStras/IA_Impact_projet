"use client";

import { useState } from "react";
import { fr } from "@/i18n/fr";
import { WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { DestinationOption } from "@/types/journey";
import { DestinationCard } from "./DestinationCard";

interface DestinationListProps {
  /** `Journey.destinations`, in the server's order (already ranked). */
  destinations: DestinationOption[];
  selectedDestinationId?: string | null;
  selectedActivityIds?: string[];
  /** `Journey.departure_stations`: the stations a city was expanded into. */
  departureStations?: string[];
  onChoose: (destinationId: string, activityIds: string[]) => void;
  /** True while any journey request is in flight. */
  busy?: boolean;
}

/** The proposed destinations as comparable cards. Order and content come from the server. */
export function DestinationList({
  destinations,
  selectedDestinationId = null,
  selectedActivityIds = [],
  departureStations = [],
  onChoose,
  busy = false,
}: DestinationListProps) {
  // Only remembers which button was pressed, to put the spinner on that card.
  const [submitted, setSubmitted] = useState<string | null>(null);
  return (
    <div className="grid min-w-0 gap-2">
      {departureStations.length > 1 ? (
        <p className={cn("text-xs text-muted-foreground", WRAP_ANYWHERE)} data-testid="departure-stations">
          {fr.journey.destinations.departureStations(departureStations.join(", "))}
        </p>
      ) : null}
      <ul aria-label={fr.journey.destinations.listLabel} className="grid min-w-0 gap-3 @[40rem]/journey:grid-cols-2" data-testid="destination-list">
        {destinations.map((destination) => (
          <li key={destination.id} className="flex min-w-0 flex-col *:flex-1">
            <DestinationCard
              destination={destination}
              selected={destination.id === selectedDestinationId}
              initialActivityIds={destination.id === selectedDestinationId ? selectedActivityIds : []}
              onChoose={(activityIds) => {
                setSubmitted(destination.id);
                onChoose(destination.id, activityIds);
              }}
              pending={busy && submitted === destination.id}
              disabled={busy}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
