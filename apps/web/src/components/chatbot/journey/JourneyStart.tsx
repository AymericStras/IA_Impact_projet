"use client";

import type { ReactNode } from "react";
import { Loader2Icon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fr } from "@/i18n/fr";
import { FLUID_BUTTON, TOUCH_TARGET, WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";

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
    <div className="grid min-w-0 gap-3 rounded-2xl border border-primary/25 bg-accent/40 tall:p-4 short:p-3" data-testid="journey-start">
      <div className="flex items-start gap-3">
        <SearchIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <div className={cn("flex-1", WRAP_ANYWHERE)}>
          <h2 id="journey-title" className="text-sm font-semibold">
            {fr.journey.start.title}
          </h2>
          <p className="mt-1 text-sm">{fr.journey.start.message}</p>
        </div>
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
