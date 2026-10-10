"use client";

import { PrinterIcon } from "lucide-react";
import { frVoice } from "@/i18n/fr.voice";
import { formatDate } from "@/lib/format";
import { WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { TravelFile } from "@/types/journey";
import styles from "../voice.module.css";
import { JourneyIntro } from "./JourneyIntro";
import { ActionButton, StageActions } from "./StageActions";

interface TravelFileStageProps {
  file: TravelFile;
  /** `journey.notices`: printed with the file, so the paper also says it is simulated. */
  notices: readonly string[];
  focusHeading: boolean;
  onPrint: () => void;
  onBack: () => void;
  /** Present while the feedback has not been given. */
  onFeedback?: () => void;
}

const copy = frVoice.journey.file;

function FileList({ title, items, ordered = false, testId }: { title: string; items: readonly string[]; ordered?: boolean; testId: string }) {
  if (items.length === 0) return null;
  const List = ordered ? "ol" : "ul";
  return (
    <section className={cn(styles.printBlock, "grid gap-2 rounded-2xl border bg-card shadow-card p-4")} aria-label={title} data-testid={testId}>
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <List className="grid gap-1.5">
        {items.map((item) => (
          // Server text, as a text node: a link is shown as text, never turned into an `href`.
          <li key={item} className={cn("text-lg leading-snug text-foreground", ordered && "tabular-nums", WRAP_ANYWHERE)}>
            {item}
          </li>
        ))}
      </List>
    </section>
  );
}

/**
 * The travel file of a confirmed booking, as a readable page: the day's timetable (the
 * server's own lines), the places, the safety advice and the contacts. « Imprimer » prints
 * this stage alone (print rules in voice.module.css).
 */
export function TravelFileStage({ file, notices, focusHeading, onPrint, onBack, onFeedback }: TravelFileStageProps) {
  const date = file.requirements.departure.date;
  return (
    <div className={cn(styles.stage, styles.safeX, "max-w-3xl gap-4 py-5")} data-testid="stage-travel_file">
      <JourneyIntro heading={file.title || copy.fallbackHeading} focusHeading={focusHeading} notices={notices} />
      <p className={cn("text-lg font-semibold text-foreground tabular-nums", WRAP_ANYWHERE)} data-testid="file-reference">
        {frVoice.journey.pending.reference(file.reference)}
        {date ? <span className="block text-base font-normal">{formatDate(date, new Date(), true)}</span> : null}
        <span className="block text-base font-normal">{frVoice.journey.itinerary.participants(file.itinerary.participants_count)}</span>
      </p>

      <FileList title={copy.scheduleTitle} items={file.schedule} ordered testId="file-schedule" />

      {file.places.length > 0 ? (
        <section className={cn(styles.printBlock, "grid gap-2 rounded-2xl border bg-card shadow-card p-4")} aria-label={copy.placesTitle} data-testid="file-places">
          <h2 className="text-sm font-medium text-muted-foreground">{copy.placesTitle}</h2>
          <ul className="grid gap-2">
            {file.places.map((place) => (
              <li key={place.title} className={cn("grid gap-0.5", WRAP_ANYWHERE)}>
                <span className="text-lg font-semibold leading-snug text-foreground">{place.title}</span>
                <span className="text-base text-foreground">{frVoice.journey.destinations.walk(place.walk_minutes)}</span>
                {place.note ? <span className="text-sm text-muted-foreground">{place.note}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <FileList title={copy.safetyTitle} items={file.safety_advice} testId="file-safety" />
      <FileList title={copy.contactsTitle} items={file.useful_contacts} testId="file-contacts" />
      <FileList title={copy.linksTitle} items={file.official_links} testId="file-links" />

      <StageActions>
        <ActionButton onClick={onBack} testId="file-back">
          {copy.back}
        </ActionButton>
        {onFeedback ? (
          <ActionButton onClick={onFeedback} testId="file-feedback">
            {frVoice.journey.booked.giveFeedback}
          </ActionButton>
        ) : null}
        <ActionButton primary onClick={onPrint} testId="file-print">
          <PrinterIcon aria-hidden="true" />
          {copy.print}
        </ActionButton>
      </StageActions>
    </div>
  );
}
