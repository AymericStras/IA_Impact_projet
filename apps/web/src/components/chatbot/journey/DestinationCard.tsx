"use client";

import { useId, useState } from "react";
import { CheckIcon, FootprintsIcon, Loader2Icon, TrainFrontIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fr } from "@/i18n/fr";
import { formatDuration } from "@/lib/format";
import { FLUID_BUTTON, TOUCH_TARGET, WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { DestinationOption } from "@/types/journey";
import { CHOICE_FOCUS, CHOICE_INPUT, JOURNEY_CARD, JOURNEY_SUBHEADING } from "./journeyStyles";

interface DestinationCardProps {
  destination: DestinationOption;
  /** True for the destination the server holds as selected. */
  selected?: boolean;
  /** Activities to tick initially (the server's `selected_activity_ids` for the selected destination). */
  initialActivityIds?: string[];
  /** Called with the ticked activity ids, in the order the server listed them. */
  onChoose: (activityIds: string[]) => void;
  pending?: boolean;
  disabled?: boolean;
}

/** One proposed destination: why it fits, travel time, places, and the activities to pick. */
export function DestinationCard({
  destination,
  selected = false,
  initialActivityIds = [],
  onChoose,
  pending = false,
  disabled = false,
}: DestinationCardProps) {
  const id = useId();
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(initialActivityIds));

  const toggle = (activityId: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(activityId)) next.delete(activityId);
      else next.add(activityId);
      return next;
    });

  return (
    <article
      aria-labelledby={`${id}-title`}
      className={cn("flex flex-col gap-3", JOURNEY_CARD, selected && "border-primary/50")}
      data-testid="destination-card"
      data-destination={destination.id}
    >
      <div className={WRAP_ANYWHERE}>
        <h3 id={`${id}-title`} className="text-sm font-semibold">
          {destination.title}
        </h3>
        {selected ? (
          <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
            <CheckIcon className="size-3" aria-hidden="true" />
            {fr.journey.destinations.current}
          </p>
        ) : null}
        <p className="mt-1 text-sm">{destination.theme_match}</p>
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
          <TrainFrontIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {fr.journey.destinations.travel(formatDuration(destination.travel_minutes))} ·{" "}
            {fr.journey.destinations.station(destination.station)}
          </span>
        </p>
      </div>

      {destination.places.length > 0 ? (
        <div className={WRAP_ANYWHERE}>
          <h4 className={JOURNEY_SUBHEADING}>{fr.journey.destinations.places}</h4>
          <ul className="mt-1 grid gap-1.5">
            {destination.places.map((place, index) => (
              <li key={index} className="text-sm">
                <span className="font-medium">{place.title}</span>{" "}
                <span className="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <FootprintsIcon className="size-3.5 shrink-0" aria-hidden="true" />
                  {fr.journey.destinations.walk(place.walk_minutes)}
                </span>{" "}
                <span className="block text-xs text-muted-foreground">{place.note}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {destination.activities.length > 0 ? (
        <fieldset className="min-w-0" disabled={disabled}>
          <legend className={JOURNEY_SUBHEADING}>{fr.journey.destinations.activities}</legend>
          <p className={cn("mt-0.5 text-xs text-muted-foreground", WRAP_ANYWHERE)}>{fr.journey.destinations.activitiesHint}</p>
          <ul className="mt-1.5 grid gap-1">
            {destination.activities.map((activity) => {
              const isChecked = checked.has(activity.id);
              return (
                <li
                  key={activity.id}
                  className={cn(
                    "relative flex items-start gap-2.5 rounded-lg px-2 py-1.5 pointer-coarse:min-h-[44px] pointer-coarse:py-2.5",
                    CHOICE_FOCUS,
                    isChecked && "bg-accent/50",
                  )}
                >
                  <input
                    type="checkbox"
                    id={`${id}-${activity.id}`}
                    checked={isChecked}
                    onChange={() => toggle(activity.id)}
                    className={cn("peer", CHOICE_INPUT)}
                    data-focus-inside=""
                  />
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input bg-card",
                      isChecked && "border-primary bg-primary text-primary-foreground",
                    )}
                  >
                    {isChecked ? <CheckIcon className="size-3" strokeWidth={3} /> : null}
                  </span>
                  <label htmlFor={`${id}-${activity.id}`} className={cn("flex-1 text-sm", WRAP_ANYWHERE)}>
                    <span className="font-medium">{activity.title}</span>{" "}
                    <span className="ml-1 text-xs text-muted-foreground">{formatDuration(activity.duration_minutes)}</span>{" "}
                    <span className="block text-xs text-muted-foreground">{activity.description}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}

      <div className="mt-auto flex flex-col">
        <Button
          type="button"
          onClick={() => onChoose(destination.activities.filter((activity) => checked.has(activity.id)).map((activity) => activity.id))}
          disabled={disabled || pending}
          aria-describedby={`${id}-title`}
          className={cn(FLUID_BUTTON, TOUCH_TARGET)}
        >
          {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          {pending ? fr.journey.destinations.choosing : fr.journey.destinations.choose}
        </Button>
      </div>
    </article>
  );
}
