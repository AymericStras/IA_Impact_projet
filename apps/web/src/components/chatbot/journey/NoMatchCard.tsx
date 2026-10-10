import { InfoIcon } from "lucide-react";
import { fr } from "@/i18n/fr";
import { WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";

/**
 * "Nothing fits" is an answer, not a failure: this note says so in words. It is a plain
 * note (no `role="alert"`, no destructive colour) so it cannot be mistaken for the error
 * block shown when the search itself breaks (`PLANNER_ERROR`).
 */
export function NoMatchCard() {
  return (
    <p className="flex items-start gap-2 rounded-xl border bg-card px-3 py-2.5 text-sm" data-testid="journey-no-match">
      <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className={cn("flex-1", WRAP_ANYWHERE)}>{fr.journey.noMatch.hint}</span>
    </p>
  );
}
