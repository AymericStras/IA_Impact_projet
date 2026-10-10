"use client";

import type { ReactNode } from "react";
import { Loader2Icon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fr } from "@/i18n/fr";
import { DISPLAY, FLUID_BUTTON, TOUCH_TARGET, WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { JOURNEY_CARD } from "./journeyStyles";

interface JourneyStartProps {
  onStart: () => void;
  pending?: boolean;
  disabled?: boolean;
  /** Test scenario tool, in simulated mode only. */
  children?: ReactNode;
}

/** First step after the confirmation: nothing is searched until the teacher asks for it. */
export function JourneyStart({ onStart, pending = false, disabled = false, children }: JourneyStartProps) {
  return (
    <div className={cn("grid gap-4 short:gap-3", JOURNEY_CARD)} data-testid="journey-start">
      <div className={WRAP_ANYWHERE}>
        <h2 id="journey-title" className={cn(DISPLAY, "text-2xl leading-tight short:text-xl")}>
          {fr.journey.start.title}
        </h2>
        <p className="mt-1.5 text-[0.9375rem]">{fr.journey.start.message}</p>
      </div>
      <div className="flex flex-col gap-2 @[24rem]/journey:flex-row @[24rem]/journey:justify-end">
        <Button
          type="button"
          onClick={onStart}
          disabled={disabled || pending}
          className={cn(FLUID_BUTTON, TOUCH_TARGET)}
          data-testid="journey-start-button"
        >
          {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <SearchIcon aria-hidden="true" />}
          {pending ? fr.journey.start.pending : fr.journey.start.action}
        </Button>
      </div>
      {children}
    </div>
  );
}
