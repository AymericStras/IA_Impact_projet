"use client";

import { useState, type ReactNode } from "react";
import { frVoice } from "@/i18n/fr.voice";
import { cn } from "@/lib/utils";
import type { Itinerary } from "@/types/journey";
import styles from "../voice.module.css";
import { Carousel } from "./Carousel";
import { ItineraryView } from "./ItineraryView";
import { JourneyIntro } from "./JourneyIntro";
import { ActionButton, StageActions } from "./StageActions";

interface ItinerariesStageProps {
  /** `data-testid` suffix and the stage this screen stands for. */
  stage: "itineraries" | "booking_refused";
  heading: string;
  listLabel: string;
  /** The itineraries to choose from, in the server's order (its ranking). */
  itineraries: readonly Itinerary[];
  /** The server's current choice: the cards open on it. */
  selectedId: string | null;
  notices: readonly string[];
  focusHeading: boolean;
  message: string | null;
  /** Shown between the intro and the cards (the refusal message, …). */
  lead?: ReactNode;
  busy: boolean;
  choosing: boolean;
  onChoose: (itineraryId: string) => void;
  onOtherDestination: () => void;
  onModify: () => void;
}

const copy = frVoice.journey.itinerary;

/**
 * Itineraries one per screen — the proposals after a destination was chosen, and the
 * alternatives after a refused booking. Order, content and feasibility are the server's.
 */
export function ItinerariesStage({
  stage,
  heading,
  listLabel,
  itineraries,
  selectedId,
  notices,
  focusHeading,
  message,
  lead,
  busy,
  choosing,
  onChoose,
  onOtherDestination,
  onModify,
}: ItinerariesStageProps) {
  const [index, setIndex] = useState(() => Math.max(0, itineraries.findIndex((item) => item.id === selectedId)));
  const current = itineraries[Math.min(index, itineraries.length - 1)] ?? null;

  return (
    <div className={cn(styles.stage, styles.safeX, "max-w-3xl gap-4 py-5")} data-testid={`stage-${stage}`}>
      <JourneyIntro heading={heading} focusHeading={focusHeading} message={message} notices={notices} />
      {lead}

      {current ? (
        <Carousel
          items={itineraries}
          index={index}
          onIndexChange={setIndex}
          label={listLabel}
          previousLabel={copy.previous}
          nextLabel={copy.next}
          slideLabel={(item, position, total) => copy.slide(position, total, item.label)}
          disabled={busy}
          testId="itineraries-carousel"
        >
          {(itinerary) => <ItineraryView itinerary={itinerary} />}
        </Carousel>
      ) : (
        <p className="text-lg text-foreground" data-testid="itineraries-empty">
          {copy.empty}
        </p>
      )}

      <StageActions>
        <ActionButton onClick={onOtherDestination} disabled={busy} testId="journey-destinations">
          {frVoice.journey.changeDestination}
        </ActionButton>
        <ActionButton onClick={onModify} disabled={busy} testId="journey-modify">
          {frVoice.journey.changeRequest}
        </ActionButton>
        {current ? (
          <ActionButton primary busy={choosing} disabled={busy} onClick={() => onChoose(current.id)} testId="itinerary-choose">
            {choosing ? copy.choosing : copy.choose}
          </ActionButton>
        ) : null}
      </StageActions>
    </div>
  );
}
