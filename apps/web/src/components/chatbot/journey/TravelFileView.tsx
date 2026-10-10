"use client";

import { FootprintsIcon, PrinterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fr } from "@/i18n/fr";
import { formatDay } from "@/lib/format";
import { FLUID_BUTTON, TOUCH_TARGET, WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { TravelFile } from "@/types/journey";
import { JourneyNotices } from "./JourneyNotices";
import { JOURNEY_SUBHEADING } from "./journeyStyles";

interface TravelFileViewProps {
  file: TravelFile;
  /** `Journey.notices`: repeated inside the file so the printed page carries the simulation label. */
  notices: string[];
}

/**
 * The travel file of a confirmed booking, as the server built it. This element is the print
 * area (`data-print-area`, see globals.css): « Imprimer le dossier » prints it and nothing else.
 */
export function TravelFileView({ file, notices }: TravelFileViewProps) {
  return (
    <article
      aria-labelledby="travel-file-title"
      className="grid min-w-0 gap-4 rounded-xl border bg-card tall:p-4 short:p-3"
      data-testid="travel-file"
      data-print-area=""
    >
      <div className={WRAP_ANYWHERE}>
        <p className={JOURNEY_SUBHEADING}>{fr.journey.travelFile.title}</p>
        <h3 id="travel-file-title" className="mt-0.5 text-sm font-semibold">
          {file.title}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {fr.journey.travelFile.reference(file.reference)} · {formatDay(file.itinerary.outbound.departure)} ·{" "}
          {fr.journey.itinerary.participants(file.itinerary.participants_count)}
        </p>
      </div>

      <JourneyNotices notices={notices} />

      <section aria-labelledby="travel-file-schedule" className={WRAP_ANYWHERE}>
        <h4 id="travel-file-schedule" className={JOURNEY_SUBHEADING}>
          {fr.journey.travelFile.schedule}
        </h4>
        <ol className="mt-1 grid gap-1 text-sm" data-testid="travel-file-schedule">
          {file.schedule.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="travel-file-places" className={WRAP_ANYWHERE}>
        <h4 id="travel-file-places" className={JOURNEY_SUBHEADING}>
          {fr.journey.travelFile.places}
        </h4>
        <ul className="mt-1 grid gap-1.5">
          {file.places.map((place, index) => (
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
      </section>

      <section aria-labelledby="travel-file-safety" className={WRAP_ANYWHERE}>
        <h4 id="travel-file-safety" className={JOURNEY_SUBHEADING}>
          {fr.journey.travelFile.safety}
        </h4>
        <ul className="mt-1 grid list-disc gap-1 pl-5 text-sm">
          {file.safety_advice.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="travel-file-contacts" className={WRAP_ANYWHERE}>
        <h4 id="travel-file-contacts" className={JOURNEY_SUBHEADING}>
          {fr.journey.travelFile.contacts}
        </h4>
        <ul className="mt-1 grid list-disc gap-1 pl-5 text-sm">
          {file.useful_contacts.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      </section>

      {file.official_links.length > 0 ? (
        <section aria-labelledby="travel-file-links" className={WRAP_ANYWHERE}>
          <h4 id="travel-file-links" className={JOURNEY_SUBHEADING}>
            {fr.journey.travelFile.links}
          </h4>
          {/* Server strings are never turned into `href`s: shown as text. */}
          <ul className="mt-1 grid list-disc gap-1 pl-5 text-sm">
            {file.official_links.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-col @[24rem]/journey:flex-row @[24rem]/journey:justify-end" data-print-hidden="">
        <Button type="button" variant="outline" onClick={() => window.print()} className={cn(FLUID_BUTTON, TOUCH_TARGET)}>
          <PrinterIcon aria-hidden="true" />
          {fr.journey.travelFile.print}
        </Button>
      </div>
    </article>
  );
}
