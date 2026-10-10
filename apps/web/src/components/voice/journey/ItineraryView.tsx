"use client";

import { CheckIcon, HourglassIcon, UsersIcon, XIcon } from "lucide-react";
import { frVoice } from "@/i18n/fr.voice";
import { WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Itinerary, TrainLeg } from "@/types/journey";
import styles from "../voice.module.css";
import { clockTime, formatDuration } from "./journeyDisplay";

const copy = frVoice.journey.itinerary;

function Leg({ kind, leg }: { kind: "outbound" | "return"; leg: TrainLeg }) {
  return (
    <li className={cn(styles.timelineItem, WRAP_ANYWHERE)} data-kind="leg" data-testid={`timeline-${kind}`}>
      <p className="text-lg font-semibold leading-snug text-foreground tabular-nums">
        <span className="sr-only">{copy.departureAt} </span>
        <span className="whitespace-nowrap">{clockTime(leg.departure)}</span>
        <span aria-hidden="true"> → </span>
        <span className="sr-only">, {copy.arrivalAt} </span>
        <span className="whitespace-nowrap">{clockTime(leg.arrival)}</span>
      </p>
      <p className="text-base text-foreground">
        <span className="font-medium">{kind === "outbound" ? copy.outbound : copy.return} · </span>
        <span aria-hidden="true">{copy.leg(leg.from_station, leg.to_station)}</span>
        <span className="sr-only">{copy.legSpoken(leg.from_station, leg.to_station)}</span>
      </p>
      {/* The server's own wording of the line, which says that the timetable is simulated. */}
      <p className="text-sm text-muted-foreground">{leg.line}</p>
    </li>
  );
}

interface ItineraryViewProps {
  itinerary: Itinerary;
  testId?: string;
}

/**
 * One itinerary, in full: the day as a timeline (outbound train, timed activities, return
 * train), the free time and the feasibility checks — all as computed by the server. The
 * client adds no judgement: a check the server marks as failed is shown as failed.
 */
export function ItineraryView({ itinerary, testId }: ItineraryViewProps) {
  return (
    <article className="grid gap-4 rounded-2xl border bg-card p-4 @2xl/voice:p-6" data-testid={testId ?? `itinerary-${itinerary.id}`}>
      <div className="grid gap-1">
        <h2 className={cn("text-[clamp(1.5rem,6cqi,2.25rem)] font-semibold leading-tight tracking-tight text-foreground", WRAP_ANYWHERE)}>
          {itinerary.label}
        </h2>
        <p className={cn("text-lg text-foreground", WRAP_ANYWHERE)}>{itinerary.title}</p>
      </div>

      <ol className={styles.timeline} aria-label={copy.timelineLabel} data-testid="itinerary-timeline">
        <Leg kind="outbound" leg={itinerary.outbound} />
        {itinerary.activities.map((activity) => (
          <li key={`${activity.start}-${activity.title}`} className={cn(styles.timelineItem, WRAP_ANYWHERE)} data-kind="activity" data-testid="timeline-activity">
            <p className="text-lg font-semibold leading-snug text-foreground tabular-nums">
              <span className="whitespace-nowrap">{clockTime(activity.start)}</span>
              {" – "}
              <span className="whitespace-nowrap">{clockTime(activity.end)}</span>
            </p>
            <p className="text-base text-foreground">
              <span className="sr-only">{copy.activity} : </span>
              {activity.title}
            </p>
          </li>
        ))}
        <Leg kind="return" leg={itinerary.return} />
      </ol>

      <ul className="flex flex-wrap gap-2 text-base font-medium">
        <li className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-accent-foreground" data-testid="itinerary-free-time">
          <HourglassIcon className="size-4 shrink-0" aria-hidden="true" />
          {copy.freeTime(formatDuration(itinerary.free_minutes))}
        </li>
        <li className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-foreground">
          <UsersIcon className="size-4 shrink-0" aria-hidden="true" />
          {copy.participants(itinerary.participants_count)}
        </li>
      </ul>

      {itinerary.checks.length > 0 ? (
        <section className="grid gap-2" aria-label={copy.checksTitle}>
          <h3 className="text-sm font-medium text-muted-foreground">{copy.checksTitle}</h3>
          <ul className="grid gap-1.5" data-testid="itinerary-checks">
            {itinerary.checks.map((check) => (
              <li key={check.label} className={cn("flex items-start gap-2 text-base text-foreground", WRAP_ANYWHERE)} data-ok={check.ok}>
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                    check.ok ? "bg-success text-success-foreground" : "bg-destructive text-destructive-foreground",
                  )}
                >
                  {check.ok ? <CheckIcon className="size-3.5" strokeWidth={3} /> : <XIcon className="size-3.5" strokeWidth={3} />}
                </span>
                <span>
                  <span className="sr-only">{check.ok ? copy.checkOk : copy.checkFailed} : </span>
                  {check.label}
                  {check.ok ? null : <span className="font-semibold text-destructive"> ({copy.checkFailed})</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
