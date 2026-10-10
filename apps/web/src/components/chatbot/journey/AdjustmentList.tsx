"use client";

import { useState } from "react";
import { InfoIcon } from "lucide-react";
import { fr } from "@/i18n/fr";
import { WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Adjustment } from "@/types/journey";
import { AdjustmentCard } from "./AdjustmentCard";
import { JOURNEY_SUBHEADING } from "./journeyStyles";

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
    <div className="grid min-w-0 gap-3">
      {sharedReason ? (
        <div className={cn("rounded-xl border bg-card px-3 py-2.5", WRAP_ANYWHERE)} data-testid="adjustment-reason">
          <h3 className={JOURNEY_SUBHEADING}>{fr.journey.adjustments.reasonTitle}</h3>
          <p className="mt-0.5 text-sm">{sharedReason}</p>
        </div>
      ) : null}
      <p className="flex items-start gap-2 text-sm font-medium" data-testid="adjustment-consent">
        <InfoIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <span className={cn("flex-1", WRAP_ANYWHERE)}>{fr.journey.adjustments.consent}</span>
      </p>
      <ul
        aria-label={fr.journey.adjustments.listLabel}
        className="grid min-w-0 gap-3 @[36rem]/journey:grid-cols-2 @[58rem]/journey:grid-cols-3"
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
