"use client";

import type { ReactNode } from "react";
import { Loader2Icon, MapPinIcon, PencilIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fr } from "@/i18n/fr";
import { FLUID_BUTTON_SM, TOUCH_TARGET } from "@/lib/ui";
import { cn } from "@/lib/utils";

interface JourneyActionsProps {
  /** Shows the destination list again; absent when the server offered no destination. */
  onChangeDestination?: () => void;
  /** Wording of that action (« Changer de destination », « Choisir une autre destination »). */
  changeDestinationLabel?: string;
  /** Opens the "Votre projet" panel on its first edit button. */
  onEditRequest: () => void;
  onRestart: () => void;
  restarting?: boolean;
  disabled?: boolean;
  /** Test scenario tool, in simulated mode only. */
  children?: ReactNode;
}

/**
 * "Change at any time": from every stage before a booking request is waiting, the teacher
 * can pick another destination, edit the request, or run the search again.
 */
export function JourneyActions({
  onChangeDestination,
  changeDestinationLabel = fr.journey.destinations.change,
  onEditRequest,
  onRestart,
  restarting = false,
  disabled = false,
  children,
}: JourneyActionsProps) {
  const className = cn("underline decoration-border decoration-2 underline-offset-4 hover:decoration-primary", FLUID_BUTTON_SM, TOUCH_TARGET);
  return (
    <div className="grid min-w-0 gap-2" data-testid="journey-actions">
      <div className="-mx-1.5 flex flex-wrap gap-x-1 gap-y-1">
        {onChangeDestination ? (
          <Button type="button" variant="ghost" size="sm" onClick={onChangeDestination} disabled={disabled} className={className}>
            <MapPinIcon aria-hidden="true" />
            {changeDestinationLabel}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={onEditRequest} disabled={disabled} className={className}>
          <PencilIcon aria-hidden="true" />
          {fr.journey.editRequest}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onRestart} disabled={disabled} className={className}>
          {restarting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <RotateCcwIcon aria-hidden="true" />}
          {restarting ? fr.journey.restarting : fr.journey.restart}
        </Button>
      </div>
      {children}
    </div>
  );
}
