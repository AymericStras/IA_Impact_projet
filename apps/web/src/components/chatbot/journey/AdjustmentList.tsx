"use client";

import { useState } from "react";
import { InfoIcon } from "lucide-react";
import { fr } from "@/i18n/fr";
import { WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Adjustment } from "@/types/journey";
import { AdjustmentCard } from "./AdjustmentCard";
import { JOURNEY_KEY_ICON, JOURNEY_KEY_LINE, JOURNEY_SUBHEADING } from "./journeyStyles";

interface AdjustmentListProps {
  /** `Journey.adjustments`, every one of them, in the server's order. */
  adjustments: Adjustment[];
  onAccept: (adjustmentId: string) => void;
  busy?: boolean;
}

/**
 * Nothing fits as asked: the reason, then every adjustment as its own card with its own
 * button. No card is preselected and nothing is accepted on the teacher's behalf.
 */
export function AdjustmentList({ adjustments, onAccept, busy = false }: AdjustmentListProps) {
  // Only remembers which button was pressed, to put the spinner on that card.
  const [submitted, setSubmitted] = useState<string | null>(null);
  // The server repeats the reason on each adjustment; when they all say the same, say it once.
  const sharedReason = adjustments.every((adjustment) => adjustment.reason === adjustments[0]?.reason)
    ? (adjustments[0]?.reason ?? null)
    : null;
  return (
    <div className="grid min-w-0 gap-4 short:gap-3">
      {sharedReason ? (
        <div className={cn("rounded-2xl bg-muted px-4 py-3", WRAP_ANYWHERE)} data-testid="adjustment-reason">
          <h3 className={JOURNEY_SUBHEADING}>{fr.journey.adjustments.reasonTitle}</h3>
          <p className="mt-1 text-[0.9375rem]">{sharedReason}</p>
        </div>
      ) : null}
      <p className={JOURNEY_KEY_LINE} data-testid="adjustment-consent">
        <span className={JOURNEY_KEY_ICON} aria-hidden="true">
          <InfoIcon strokeWidth={2.5} />
        </span>
        <span className={cn("flex-1", WRAP_ANYWHERE)}>{fr.journey.adjustments.consent}</span>
      </p>
      <ul
        aria-label={fr.journey.adjustments.listLabel}
        className="grid min-w-0 gap-4 @[36rem]/journey:grid-cols-2 @[58rem]/journey:grid-cols-3"
        data-testid="adjustment-list"
      >
        {adjustments.map((adjustment) => (
          <li key={adjustment.id} className="flex min-w-0 flex-col *:flex-1">
            <AdjustmentCard
              adjustment={adjustment}
              showReason={sharedReason === null}
              onAccept={() => {
                setSubmitted(adjustment.id);
                onAccept(adjustment.id);
              }}
              pending={busy && submitted === adjustment.id}
              disabled={busy}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
