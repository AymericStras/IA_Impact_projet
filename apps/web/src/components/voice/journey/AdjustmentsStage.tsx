"use client";

import { useId, useState } from "react";
import { frVoice } from "@/i18n/fr.voice";
import { WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Journey } from "@/types/journey";
import styles from "../voice.module.css";
import { JourneyIntro } from "./JourneyIntro";
import { ActionButton, StageActions } from "./StageActions";
import { adjustmentReasons, changeSpoken, changeText } from "./journeyDisplay";

interface AdjustmentsStageProps {
  journey: Journey;
  focusHeading: boolean;
  message: string | null;
  busy: boolean;
  accepting: boolean;
  /** The explicit acceptance: the only thing here that changes anything. */
  onAccept: (adjustmentId: string) => void;
  onOtherDestination: () => void;
  onModify: () => void;
}

const copy = frVoice.journey.adjustments;

/**
 * Nothing fits as asked: the server's reason, then its adjustments as a single-choice list
 * — every one it sent, in its order, with what changes and how many itineraries it unlocks.
 * Selecting an option changes nothing; only « Accepter cet ajustement » does, and the
 * screen says so. Native radio buttons: arrow keys move the selection, as expected.
 */
export function AdjustmentsStage({ journey, focusHeading, message, busy, accepting, onAccept, onOtherDestination, onModify }: AdjustmentsStageProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const groupName = useId();
  const consentId = useId();
  const reasons = adjustmentReasons(journey.adjustments);
  // The selection only counts while the server still offers it.
  const chosen = journey.adjustments.find((adjustment) => adjustment.id === selected) ?? null;

  return (
    <div className={cn(styles.stage, styles.safeX, "max-w-3xl gap-4 py-5")} data-testid="stage-adjustments">
      <JourneyIntro heading={copy.heading} focusHeading={focusHeading} message={message} notices={journey.notices} />

      {reasons.map((reason) => (
        <p key={reason} className={cn("text-lg leading-relaxed text-foreground", WRAP_ANYWHERE)} data-testid="adjustments-reason">
          {reason}
        </p>
      ))}

      <fieldset className="grid min-w-0 gap-2" data-testid="adjustments-options">
        <legend className="mb-2 text-base font-medium text-foreground">{copy.intro}</legend>
        {journey.adjustments.map((adjustment) => {
          const checked = adjustment.id === selected;
          return (
            <label
              key={adjustment.id}
              className={cn(
                "relative flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border-2 px-3 py-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                checked ? "border-primary bg-accent text-accent-foreground" : "border-input bg-card text-foreground hover:bg-muted",
                busy && "pointer-events-none opacity-60",
              )}
              data-testid={`adjustment-${adjustment.id}`}
              data-kind={adjustment.kind}
              data-selected={checked}
            >
              <input
                type="radio"
                name={groupName}
                value={adjustment.id}
                checked={checked}
                disabled={busy}
                onChange={() => setSelected(adjustment.id)}
                // The native control covers the whole option (one large touch target); the
                // mark next to it is its visible state.
                className="absolute inset-0 size-full cursor-pointer text-base opacity-0"
              />
              <span
                aria-hidden="true"
                className={cn("mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border-2", checked ? "border-primary" : "border-input")}
              >
                {checked ? <span className="size-2.5 rounded-full bg-primary" /> : null}
              </span>
              <span className={cn("grid gap-1", WRAP_ANYWHERE)}>
                {/* The server's sentence: what changes. */}
                <span className="text-lg font-semibold leading-snug">{adjustment.label}</span>
                {adjustment.changes.map((change) => (
                  <span key={change.field} className="text-base tabular-nums" data-testid="adjustment-change">
                    <span aria-hidden="true">{changeText(change)}</span>
                    <span className="sr-only">{changeSpoken(change)}</span>
                  </span>
                ))}
                <span className="text-base font-medium" data-testid="adjustment-unlocks">
                  {copy.unlocks(adjustment.unlocks)}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <p id={consentId} className="rounded-xl border border-primary/20 bg-accent/50 px-3 py-2.5 text-base font-medium text-foreground" data-testid="adjustments-consent">
        {copy.consent}
      </p>

      <StageActions>
        <ActionButton onClick={onOtherDestination} disabled={busy} testId="journey-destinations">
          {frVoice.journey.changeDestination}
        </ActionButton>
        <ActionButton onClick={onModify} disabled={busy} testId="journey-modify">
          {frVoice.journey.changeRequest}
        </ActionButton>
        <ActionButton
          primary
          busy={accepting}
          disabled={busy || chosen === null}
          title={chosen === null ? copy.chooseFirst : undefined}
          aria-describedby={consentId}
          onClick={() => chosen && onAccept(chosen.id)}
          testId="adjustment-accept"
        >
          {accepting ? copy.accepting : copy.accept}
        </ActionButton>
      </StageActions>
    </div>
  );
}
