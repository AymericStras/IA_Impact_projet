"use client";

import { useEffect, useRef } from "react";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fr } from "@/i18n/fr";
import { FLUID_BUTTON, TOUCH_TARGET, WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Booking } from "@/types/journey";
import { JOURNEY_CARD } from "./journeyStyles";

/** Delay before the answer is looked up once on the teacher's behalf. */
export const AUTO_CHECK_DELAY_MS = 2_500;

interface BookingPendingProps {
  booking: Booking;
  /** `POST /journey/booking/check`. */
  onCheck: () => void;
  checking?: boolean;
  disabled?: boolean;
}

/**
 * The booking request is waiting for an answer. The answer is looked up once, automatically,
 * shortly after the request; after that the teacher asks with « Vérifier la réponse ».
 */
export function BookingPending({ booking, onCheck, checking = false, disabled = false }: BookingPendingProps) {
  const onCheckRef = useRef(onCheck);
  onCheckRef.current = onCheck;

  useEffect(() => {
    const timer = setTimeout(() => onCheckRef.current(), AUTO_CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [booking.reference]);

  return (
    <div className={cn("grid gap-3", JOURNEY_CARD)} data-testid="booking-pending">
      <div className={WRAP_ANYWHERE}>
        <p className="text-sm font-medium" data-testid="booking-reference">
          {fr.journey.pending.reference(booking.reference)}
        </p>
        <p className="mt-1 flex items-start gap-2 text-sm text-muted-foreground" role="status">
          <Loader2Icon className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <span className="flex-1">{fr.journey.pending.waiting}</span>
        </p>
      </div>
      <div className="flex flex-col @[24rem]/journey:flex-row @[24rem]/journey:justify-end">
        <Button type="button" variant="outline" onClick={onCheck} disabled={disabled || checking} className={cn(FLUID_BUTTON, TOUCH_TARGET)}>
          {checking ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <RefreshCwIcon aria-hidden="true" />}
          {checking ? fr.journey.pending.checking : fr.journey.pending.check}
        </Button>
      </div>
    </div>
  );
}
