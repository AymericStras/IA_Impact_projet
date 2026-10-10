import { ArrowRightIcon } from "lucide-react";
import { fr } from "@/i18n/fr";
import { formatClock } from "@/lib/format";
import { WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { TrainLeg } from "@/types/journey";
import { JOURNEY_PILL, JOURNEY_SUBHEADING } from "./journeyStyles";

interface TrainLegRowProps {
  /** « Aller » or « Retour ». */
  heading: string;
  leg: TrainLeg;
}

/** One train leg: departure time and station, arrival time and station, and the server's line label. */
export function TrainLegRow({ heading, leg }: TrainLegRowProps) {
  return (
    <div className={WRAP_ANYWHERE} data-testid="train-leg">
      <h4 className={JOURNEY_SUBHEADING}>{heading}</h4>
      <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[0.9375rem]">
        <span>
          <time dateTime={leg.departure} className="font-heading text-lg leading-none font-extrabold tabular-nums">
            {formatClock(leg.departure)}
          </time>{" "}
          {leg.from_station}
        </span>
        <ArrowRightIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="sr-only"> {fr.journey.itinerary.to} </span>
        <span>
          <time dateTime={leg.arrival} className="font-heading text-lg leading-none font-extrabold tabular-nums">
            {formatClock(leg.arrival)}
          </time>{" "}
          {leg.to_station}
        </span>
      </p>
      <p className={cn(JOURNEY_PILL, "mt-1.5")}>{leg.line}</p>
    </div>
  );
}
