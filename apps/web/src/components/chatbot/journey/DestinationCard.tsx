"use client";

import { useId, useState } from "react";
import { CheckIcon, FootprintsIcon, Loader2Icon, TrainFrontIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fr } from "@/i18n/fr";
import { formatDuration } from "@/lib/format";
import { DISPLAY, FLUID_BUTTON, TOUCH_TARGET, WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { DestinationOption } from "@/types/journey";
import { CHOICE_FOCUS, CHOICE_INPUT, JOURNEY_SUBHEADING } from "./journeyStyles";

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
      // Navy top half (name in white condensed type), white bottom half (places, activities,
      // the red action). The destination held by the server gets a 2px navy edge and a yellow pill.
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-card",
        selected ? "border-2 border-primary" : "border-border",
      )}
      data-testid="destination-card"
      data-destination={destination.id}
    >
      <div className={cn("flex flex-col items-start bg-primary text-primary-foreground tall:p-5 short:p-3.5", WRAP_ANYWHERE)}>
        {selected ? (
          <p className="mb-2.5 inline-flex items-center gap-1 rounded-full bg-highlight px-2.5 py-1 text-xs leading-tight font-bold text-highlight-foreground">
            <CheckIcon className="size-3" strokeWidth={3} aria-hidden="true" />
            {fr.journey.destinations.current}
          </p>
        ) : null}
        <h3 id={`${id}-title`} className={cn(DISPLAY, "text-2xl leading-[1.1] short:text-xl")}>
          {destination.title}
        </h3>
        <p className="mt-2 text-[0.9375rem]">{destination.theme_match}</p>
        <p className="mt-2.5 flex items-start gap-2 text-[0.8125rem] font-medium opacity-85">
          <TrainFrontIcon className="mt-px size-4 shrink-0" aria-hidden="true" />
          <span>
            {fr.journey.destinations.travel(formatDuration(destination.travel_minutes))} ·{" "}
            {fr.journey.destinations.station(destination.station)}
          </span>
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-4 tall:p-5 short:p-3.5">

      {destination.places.length > 0 ? (
        <div className={WRAP_ANYWHERE}>
          <h4 className={JOURNEY_SUBHEADING}>{fr.journey.destinations.places}</h4>
          <ul className="mt-1.5 grid gap-2">
            {destination.places.map((place, index) => (
              <li key={index} className="text-[0.9375rem]">
                <span className="font-bold">{place.title}</span>{" "}
                <span className="ml-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <FootprintsIcon className="size-3.5 shrink-0" aria-hidden="true" />
                  {fr.journey.destinations.walk(place.walk_minutes)}
                </span>{" "}
                <span className="block text-[0.8125rem] text-muted-foreground">{place.note}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {destination.activities.length > 0 ? (
        <fieldset className="min-w-0" disabled={disabled}>
          <legend className={JOURNEY_SUBHEADING}>{fr.journey.destinations.activities}</legend>
          <p className={cn("mt-1 text-[0.8125rem] text-muted-foreground", WRAP_ANYWHERE)}>{fr.journey.destinations.activitiesHint}</p>
          <ul className="mt-2 grid gap-1.5">
            {destination.activities.map((activity) => {
              const isChecked = checked.has(activity.id);
              return (
                <li
                  key={activity.id}
                  className={cn(
                    "relative flex items-start gap-3 rounded-xl border-2 bg-muted px-3 py-2.5 transition-colors pointer-coarse:min-h-[44px]",
                    CHOICE_FOCUS,
                    // A grey chip; selection = navy edge + ticked navy box, never colour alone.
                    isChecked ? "border-primary" : "border-transparent hover:border-input",
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
                      "mt-px flex size-5 shrink-0 items-center justify-center rounded-[0.3125rem] border-2 border-primary bg-card",
                      isChecked && "bg-primary text-primary-foreground",
                    )}
                  >
                    {isChecked ? <CheckIcon className="size-3.5" strokeWidth={3.5} /> : null}
                  </span>
                  <label htmlFor={`${id}-${activity.id}`} className={cn("flex-1 text-[0.9375rem]", WRAP_ANYWHERE)}>
                    <span className="font-bold">{activity.title}</span>{" "}
                    <span className="ml-1 text-xs font-semibold text-muted-foreground">{formatDuration(activity.duration_minutes)}</span>{" "}
                    <span className="block text-[0.8125rem] text-muted-foreground">{activity.description}</span>
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
      </div>
    </article>
  );
}
