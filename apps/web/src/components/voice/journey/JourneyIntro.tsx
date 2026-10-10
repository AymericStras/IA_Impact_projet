"use client";

import type { ReactNode } from "react";
import { FlaskConicalIcon } from "lucide-react";
import { frVoice } from "@/i18n/fr.voice";
import { WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { StageHeading } from "../StageFrame";

interface SimulationNoticeProps {
  /** `journey.notices`, as sent: the simulation label first, then the assumptions. */
  notices: readonly string[];
}

/**
 * The server's notes about what is on screen — above all that the data is simulated.
 * Rendered verbatim on every journey stage (and printed with the travel file): nothing
 * simulated may look like real availability, and the wording is the server's, not ours.
 */
export function SimulationNotice({ notices }: SimulationNoticeProps) {
  if (notices.length === 0) return null;
  return (
    <aside
      aria-label={frVoice.journey.noticesLabel}
      className="flex items-start gap-2 rounded-xl bg-highlight px-3 py-2 text-xs leading-snug text-highlight-foreground"
      data-testid="journey-notices"
    >
      <FlaskConicalIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <ul className={cn("grid gap-1", WRAP_ANYWHERE)}>
        {notices.map((notice) => (
          <li key={notice}>{notice}</li>
        ))}
      </ul>
    </aside>
  );
}

interface JourneyIntroProps {
  heading: string;
  focusHeading: boolean;
  /** The server's line for the stage it is on; omitted when the screen shows another one. */
  message?: string | null;
  notices: readonly string[];
  /** Decoration placed before the heading (success mark, …). */
  icon?: ReactNode;
}

/** Top of every journey stage: the heading, the server's line, the simulation label. */
export function JourneyIntro({ heading, focusHeading, message, notices, icon }: JourneyIntroProps) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {icon}
        <StageHeading focusOnEnter={focusHeading} className="text-[clamp(1.375rem,5cqi,2rem)] font-semibold leading-tight tracking-tight text-foreground">
          {heading}
        </StageHeading>
      </div>
      {message ? (
        <p className={cn("whitespace-pre-wrap text-base leading-relaxed text-foreground", WRAP_ANYWHERE)} data-testid="journey-message">
          {message}
        </p>
      ) : null}
      <SimulationNotice notices={notices} />
    </div>
  );
}
