"use client";

import { useId, type ReactNode } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { fr } from "@/i18n/fr";
import { formatClock, formatDay, formatDuration } from "@/lib/format";
import { WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Itinerary } from "@/types/journey";
import { JOURNEY_CARD, JOURNEY_SUBHEADING } from "./journeyStyles";
import { TrainLegRow } from "./TrainLegRow";

interface ItineraryCardProps {
  itinerary: Itinerary;
  /** Actions shown at the bottom of the card (choose, etc.); `titleId` names the card for them. */
  children?: (titleId: string) => ReactNode;
  className?: string;
}

/**
 * One itinerary, in full: both train legs, the timed activities, free time on site and the
 * feasibility checks. Every figure and every check result is the server's.
 */
export function ItineraryCard({ itinerary, children, className }: ItineraryCardProps) {
  const id = useId();
  const titleId = `${id}-title`;
  return (
    <article
      aria-labelledby={titleId}
      className={cn("flex flex-col gap-3", JOURNEY_CARD, className)}
      data-testid="itinerary-card"
      data-itinerary={itinerary.id}
    >
      <div className={WRAP_ANYWHERE}>
        <h3 id={titleId} className="text-sm font-semibold">
          {itinerary.label}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {itinerary.title} · {formatDay(itinerary.outbound.departure)} ·{" "}
          {fr.journey.itinerary.participants(itinerary.participants_count)}
        </p>
      </div>

      <TrainLegRow heading={fr.journey.itinerary.outbound} leg={itinerary.outbound} />

      {itinerary.activities.length > 0 ? (
        <div className={WRAP_ANYWHERE}>
          <h4 className={JOURNEY_SUBHEADING}>{fr.journey.itinerary.activities}</h4>
          <ul className="mt-0.5 grid gap-0.5">
            {itinerary.activities.map((activity, index) => (
              <li key={index} className="flex flex-wrap gap-x-2 text-sm">
                <span className="font-medium tabular-nums">
                  {fr.journey.itinerary.activityTime(formatClock(activity.start), formatClock(activity.end))}
                </span>{" "}
                <span>{activity.title}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground" data-testid="itinerary-free-time">
            {fr.journey.itinerary.freeTime(formatDuration(itinerary.free_minutes))}
          </p>
        </div>
      ) : null}

      <TrainLegRow heading={fr.journey.itinerary.return} leg={itinerary.return} />

      {itinerary.checks.length > 0 ? (
        <div className={WRAP_ANYWHERE}>
          <h4 className={JOURNEY_SUBHEADING}>{fr.journey.itinerary.checks}</h4>
          <ul className="mt-0.5 grid gap-0.5">
            {itinerary.checks.map((check, index) => (
              <li key={index} className="flex items-start gap-1.5 text-xs" data-ok={check.ok}>
                {check.ok ? (
                  <CheckIcon className="mt-px size-3.5 shrink-0 text-success" strokeWidth={3} aria-hidden="true" />
                ) : (
                  <XIcon className="mt-px size-3.5 shrink-0 text-destructive" strokeWidth={3} aria-hidden="true" />
                )}
                <span>
                  <span className="sr-only">{check.ok ? fr.journey.itinerary.checkOk : fr.journey.itinerary.checkFailed} : </span>
                  {check.label}
                  {check.ok ? null : <span className="font-medium"> — {fr.journey.itinerary.checkFailed}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {children ? <div className="mt-auto flex flex-col gap-2">{children(titleId)}</div> : null}
    </article>
  );
}
