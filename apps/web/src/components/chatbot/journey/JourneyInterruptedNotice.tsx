import { InfoIcon } from "lucide-react";
import { fr } from "@/i18n/fr";
import { WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";

/**
 * Shown when the confirmation was lost while proposals were on screen (a requirement was
 * edited): the journey is gone on the server too, and comes back after a new confirmation.
 */
export function JourneyInterruptedNotice() {
  return (
    <p
      role="status"
      className="flex min-w-0 items-start gap-2.5 rounded-2xl bg-muted px-4 py-3 text-sm font-medium"
      data-testid="journey-interrupted"
    >
      <InfoIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <span className={cn("flex-1", WRAP_ANYWHERE)}>{fr.journey.interrupted}</span>
    </p>
  );
}
