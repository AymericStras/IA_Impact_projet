import { FlaskConicalIcon } from "lucide-react";
import { fr } from "@/i18n/fr";
import { WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";

interface JourneyNoticesProps {
  /** `Journey.notices` as received: the simulation label and the server's assumptions. */
  notices: string[];
  className?: string;
}

/**
 * The server's notes about the data on screen. In simulated mode the first one is the
 * simulation label: it is shown on every journey view (and on the printed travel file) so
 * that simulated data can never be taken for real availability. Nothing is hardcoded here.
 *
 * A solid yellow banner with bold navy text (11.07:1): the accent of the identity, used
 * for what must not be missed.
 */
export function JourneyNotices({ notices, className }: JourneyNoticesProps) {
  if (notices.length === 0) return null;
  return (
    <ul
      aria-label={fr.journey.noticesLabel}
      data-testid="journey-notices"
      data-print-plain=""
      className={cn("grid gap-1.5 rounded-2xl bg-highlight px-4 py-3 text-sm font-semibold text-highlight-foreground short:gap-1 short:px-3.5 short:py-2 short:text-[0.8125rem] @max-[30rem]/journey:text-[0.8125rem]", className)}
    >
      {notices.map((notice, index) => (
        <li key={index} className="flex items-start gap-2.5">
          <FlaskConicalIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className={cn("flex-1", WRAP_ANYWHERE)}>{notice}</span>
        </li>
      ))}
    </ul>
  );
}
