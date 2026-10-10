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
 */
export function JourneyNotices({ notices, className }: JourneyNoticesProps) {
  if (notices.length === 0) return null;
  return (
    <ul
      aria-label={fr.journey.noticesLabel}
      data-testid="journey-notices"
      className={cn("grid gap-1 rounded-xl border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-foreground short:py-1.5 short:text-xs", className)}
    >
      {notices.map((notice, index) => (
        <li key={index} className="flex items-start gap-2">
          <FlaskConicalIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span className={cn("flex-1", WRAP_ANYWHERE)}>{notice}</span>
        </li>
      ))}
    </ul>
  );
}
