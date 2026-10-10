"use client";

import { useId, useState } from "react";
import { CheckIcon, ClockIcon, FootprintsIcon, MapPinIcon, PlusIcon, TrainFrontIcon } from "lucide-react";
import { frVoice } from "@/i18n/fr.voice";
import { WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { DestinationOption, Journey } from "@/types/journey";
import styles from "../voice.module.css";
import { Carousel } from "./Carousel";
import { JourneyIntro } from "./JourneyIntro";
import { ActionButton, StageActions } from "./StageActions";
import { formatDuration } from "./journeyDisplay";

interface DestinationsStageProps {
  journey: Journey;
  focusHeading: boolean;
  /** The server's line, when the server is on this stage. */
  message: string | null;
  /** A journey request is in flight. */
  busy: boolean;
  /** The destination request itself is in flight. */
  choosing: boolean;
  onChoose: (destinationId: string, activityIds: string[]) => void;
  onModify: () => void;
  /** Present when the teacher came back here from a later stage: return without choosing. */
  onBack?: () => void;
}

const copy = frVoice.journey.destinations;

function DestinationCard({
  destination,
  picked,
  disabled,
  onToggle,
}: {
  destination: DestinationOption;
  picked: readonly string[];
  disabled: boolean;
  onToggle: (activityId: string) => void;
}) {
  const descriptionPrefix = useId();
  return (
    <article className="grid gap-4 rounded-2xl border bg-card shadow-card p-4 @2xl/voice:p-6" data-testid={`destination-${destination.id}`}>
      <div className="grid gap-2">
        <h2 className={cn("text-[clamp(1.5rem,6cqi,2.25rem)] font-heading font-extrabold leading-tight tracking-tight text-foreground", WRAP_ANYWHERE)}>
          {destination.title}
        </h2>
        <p className={cn("text-lg leading-relaxed text-foreground", WRAP_ANYWHERE)} data-testid="destination-why">
          {destination.theme_match}
        </p>
        <ul className="flex flex-wrap gap-2 text-base font-medium text-foreground">
          <li className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-accent-foreground" data-testid="destination-travel">
            <ClockIcon className="size-4 shrink-0" aria-hidden="true" />
            {copy.travel(formatDuration(destination.travel_minutes))}
          </li>
          <li className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1", WRAP_ANYWHERE)}>
            <TrainFrontIcon className="size-4 shrink-0" aria-hidden="true" />
            {copy.station(destination.station)}
          </li>
        </ul>
      </div>

      <section className="grid gap-2" aria-label={copy.placesTitle}>
        <h3 className="text-sm font-medium text-muted-foreground">{copy.placesTitle}</h3>
        <ul className="grid gap-2">
          {destination.places.map((place) => (
            <li key={place.title} className={cn("flex items-start gap-2", WRAP_ANYWHERE)}>
              <MapPinIcon className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-base font-semibold text-foreground">{place.title}</p>
                <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-foreground">
                  <FootprintsIcon className="size-3.5 shrink-0" aria-hidden="true" />
                  {copy.walk(place.walk_minutes)}
                </p>
                {place.note ? <p className="text-sm text-muted-foreground">{place.note}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-2" aria-label={copy.activitiesTitle}>
        <h3 className="text-sm font-medium text-muted-foreground">{copy.activitiesTitle}</h3>
        <ul className="grid gap-2 @2xl/voice:grid-cols-2">
          {destination.activities.map((activity) => {
            const chosen = picked.includes(activity.id);
            return (
              <li key={activity.id} className="min-w-0">
                <button
                  type="button"
                  aria-pressed={chosen}
                  // An explicit name: title and duration, read as one phrase; the description follows.
                  aria-label={copy.activityLabel(activity.title, formatDuration(activity.duration_minutes))}
                  aria-describedby={activity.description ? `${descriptionPrefix}-${activity.id}` : undefined}
                  disabled={disabled}
                  onClick={() => onToggle(activity.id)}
                  className={cn(
                    "flex min-h-14 w-full items-start gap-3 rounded-xl border-2 px-3 py-2.5 text-left disabled:pointer-events-none disabled:opacity-60",
                    chosen ? "border-primary bg-accent text-accent-foreground" : "border-input bg-card text-foreground hover:bg-muted",
                  )}
                  data-testid={`activity-${activity.id}`}
                >
                  {/* State by shape and words, not colour alone: a filled tick, or an empty plus. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2",
                      chosen ? "border-primary bg-primary text-primary-foreground" : "border-input text-muted-foreground",
                    )}
                  >
                    {chosen ? <CheckIcon className="size-4" strokeWidth={3} /> : <PlusIcon className="size-4" />}
                  </span>
                  <span className={cn("grid gap-0.5", WRAP_ANYWHERE)}>
                    <span className="text-base font-semibold">
                      {activity.title}
                      <span className="font-normal"> · {formatDuration(activity.duration_minutes)}</span>
                    </span>
                    {activity.description ? (
                      <span id={`${descriptionPrefix}-${activity.id}`} className="text-sm">
                        {activity.description}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="text-sm text-muted-foreground" data-testid="activities-hint">
          {copy.activitiesHint}
        </p>
      </section>
    </article>
  );
}

/**
 * The destinations the server recommends, one per screen. Local state is only what the
 * server does not hold yet: which card is looked at and which activities are ticked on it.
 * The cards open on the server's current choice when there is one.
 */
export function DestinationsStage({ journey, focusHeading, message, busy, choosing, onChoose, onModify, onBack }: DestinationsStageProps) {
  const { destinations } = journey;
  const [index, setIndex] = useState(() => Math.max(0, destinations.findIndex((item) => item.id === journey.selected_destination_id)));
  const [picks, setPicks] = useState<Record<string, string[]>>(() =>
    journey.selected_destination_id ? { [journey.selected_destination_id]: journey.selected_activity_ids } : {},
  );
  const current = destinations[Math.min(index, destinations.length - 1)] ?? null;
  const picked = current ? (picks[current.id] ?? []) : [];

  const toggle = (activityId: string) => {
    if (!current) return;
    setPicks((all) => {
      const mine = all[current.id] ?? [];
      return { ...all, [current.id]: mine.includes(activityId) ? mine.filter((id) => id !== activityId) : [...mine, activityId] };
    });
  };

  return (
    <div className={cn(styles.stage, styles.safeX, "max-w-3xl gap-4 py-5")} data-testid="stage-destinations">
      <JourneyIntro heading={copy.heading} focusHeading={focusHeading} message={message} notices={journey.notices} />

      {current ? (
        <Carousel
          items={destinations}
          index={index}
          onIndexChange={setIndex}
          label={copy.listLabel}
          previousLabel={copy.previous}
          nextLabel={copy.next}
          slideLabel={(item, position, total) => copy.slide(position, total, item.title)}
          disabled={busy}
          testId="destinations-carousel"
        >
          {(destination) => <DestinationCard destination={destination} picked={picks[destination.id] ?? []} disabled={busy} onToggle={toggle} />}
        </Carousel>
      ) : (
        <p className="text-lg text-foreground" data-testid="destinations-empty">
          {copy.empty}
        </p>
      )}

      <StageActions>
        {onBack ? (
          <ActionButton onClick={onBack} disabled={busy} testId="journey-back">
            {frVoice.journey.back}
          </ActionButton>
        ) : null}
        <ActionButton onClick={onModify} disabled={busy} testId="journey-modify">
          {frVoice.journey.changeRequest}
        </ActionButton>
        {current ? (
          <ActionButton
            primary
            busy={choosing}
            disabled={busy}
            // Sent in the order of the card, as ticked; an empty list is the server's default.
            onClick={() => onChoose(current.id, current.activities.map((activity) => activity.id).filter((id) => picked.includes(id)))}
            testId="destination-choose"
          >
            {choosing ? copy.choosing : copy.choose}
          </ActionButton>
        ) : null}
      </StageActions>
    </div>
  );
}
