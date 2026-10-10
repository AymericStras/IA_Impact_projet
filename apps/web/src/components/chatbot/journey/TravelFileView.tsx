"use client";

import { FootprintsIcon, PrinterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fr } from "@/i18n/fr";
import { formatDay } from "@/lib/format";
import { DISPLAY, FLUID_BUTTON, TOUCH_TARGET, WRAP_ANYWHERE } from "@/lib/ui";
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
      className="grid min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-card"
      data-testid="travel-file"
      data-print-area=""
    >
      {/* Navy block: the file's title in white condensed type. Printed as plain ink. */}
      <div className={cn("bg-primary text-primary-foreground tall:p-5 short:p-3.5", WRAP_ANYWHERE)} data-print-plain="">
        <p className="text-[0.6875rem] leading-snug font-bold tracking-[0.09em] uppercase opacity-80">{fr.journey.travelFile.title}</p>
        <h3 id="travel-file-title" className={cn(DISPLAY, "mt-1 text-[1.75rem] leading-[1.1] short:text-2xl")}>
          {file.title}
        </h3>
        <p className="mt-2 text-[0.875rem] font-medium opacity-85">
          {fr.journey.travelFile.reference(file.reference)} · {formatDay(file.itinerary.outbound.departure)} ·{" "}
          {fr.journey.itinerary.participants(file.itinerary.participants_count)}
        </p>
      </div>

      <div className="grid min-w-0 gap-5 tall:p-5 short:gap-4 short:p-3.5">
      <JourneyNotices notices={notices} />

      <section aria-labelledby="travel-file-schedule" className={WRAP_ANYWHERE}>
        <h4 id="travel-file-schedule" className={JOURNEY_SUBHEADING}>
          {fr.journey.travelFile.schedule}
        </h4>
        {/*
          The day as a timeline: a continuous navy line, one white stop per line of the
          server's schedule (shown verbatim, nothing is parsed), the first and last stops
          filled in yellow inside their navy ring.
        */}
        <ol className="mt-3 grid text-[0.9375rem] font-semibold" data-testid="travel-file-schedule">
          {file.schedule.map((line, index) => (
            <li key={index} className="group/stop relative flex gap-3.5 pb-4 last:pb-0">
              <span
                aria-hidden="true"
                className="absolute top-3 bottom-0 left-[0.3125rem] border-l-4 border-primary group-last/stop:hidden"
              />
              <span
                aria-hidden="true"
                className="relative mt-[0.1875rem] size-3.5 shrink-0 rounded-full border-[3px] border-primary bg-card group-first/stop:bg-highlight group-last/stop:bg-highlight"
              />
              <span className="min-w-0 flex-1">{line}</span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="travel-file-places" className={WRAP_ANYWHERE}>
        <h4 id="travel-file-places" className={JOURNEY_SUBHEADING}>
          {fr.journey.travelFile.places}
        </h4>
        <ul className="mt-1.5 grid gap-2">
          {file.places.map((place, index) => (
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
      </section>

      <section aria-labelledby="travel-file-safety" className={WRAP_ANYWHERE}>
        <h4 id="travel-file-safety" className={JOURNEY_SUBHEADING}>
          {fr.journey.travelFile.safety}
        </h4>
        <ul className="mt-1.5 grid list-disc gap-1.5 pl-5 text-[0.9375rem] marker:text-primary">
          {file.safety_advice.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="travel-file-contacts" className={WRAP_ANYWHERE}>
        <h4 id="travel-file-contacts" className={JOURNEY_SUBHEADING}>
          {fr.journey.travelFile.contacts}
        </h4>
        <ul className="mt-1.5 grid list-disc gap-1.5 pl-5 text-[0.9375rem] marker:text-primary">
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
          <ul className="mt-1.5 grid list-disc gap-1.5 pl-5 text-[0.9375rem] marker:text-primary">
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
      </div>
    </article>
  );
}
