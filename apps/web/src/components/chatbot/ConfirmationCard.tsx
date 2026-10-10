"use client";

import { motion, useReducedMotion } from "motion/react";
import { ArrowDownIcon, CheckCircle2Icon, Loader2Icon, PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fr } from "@/i18n/fr";
import { DISPLAY, FLUID_BUTTON, FLUID_BUTTON_SM, TOUCH_TARGET, WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { ConfirmedRequirements } from "@/types/contracts";
import { ConfirmedJsonBlock } from "./ConfirmedJsonBlock";

interface ConfirmationCardProps {
  /** `ready_for_confirmation` as returned by the server. */
  ready: boolean;
  /** `state === "CONFIRMED"` with a non-null payload. */
  confirmedRequirements: ConfirmedRequirements | null;
  onConfirm: () => void;
  /** "Modifier": moves focus to the requirements panel. */
  onEdit: () => void;
  pending?: boolean;
  /**
   * Confirmed state only: when the journey follows (it sits under the JSON block, often
   * below the fold), a button that brings it into view.
   */
  onContinue?: () => void;
}

export function ConfirmationCard({ ready, confirmedRequirements, onConfirm, onEdit, pending = false, onContinue }: ConfirmationCardProps) {
  const reduceMotion = useReducedMotion();
  if (!ready && !confirmedRequirements) return null;

  const animation = {
    initial: { opacity: 0, y: reduceMotion ? 0 : 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduceMotion ? 0 : 0.25, ease: "easeOut" as const },
  };

  if (confirmedRequirements) {
    return (
      <motion.section
        {...animation}
        aria-labelledby="confirmation-done-title"
        // The milestone: a navy block (white text 15.74:1), check mark in yellow. No red on
        // navy: the way forward is a white button with navy content.
        className="on-navy min-w-0 rounded-2xl bg-primary text-primary-foreground shadow-card tall:p-5 short:p-2"
        data-testid="confirmation-done"
      >
        <div className="flex items-start gap-3 short:gap-2">
          <CheckCircle2Icon className="mt-0.5 size-6 short:size-5 shrink-0 text-highlight" aria-hidden="true" />
          <div className={cn("flex-1", WRAP_ANYWHERE)}>
            <h2 id="confirmation-done-title" className={cn(DISPLAY, "text-2xl leading-tight short:text-lg")}>
              {fr.confirmation.confirmedTitle}
            </h2>
            <p className="mt-1.5 text-[0.9375rem] short:mt-0.5 short:text-sm">{fr.confirmation.confirmedMessage}</p>
            <p className="mt-1 text-[0.8125rem] opacity-80 short:mt-0.5 short:text-xs">{fr.confirmation.stillEditable}</p>
            {onContinue ? (
              <Button
                type="button"
                variant="inverse"
                size="sm"
                onClick={onContinue}
                className={cn("mt-3 short:mt-1", FLUID_BUTTON_SM, TOUCH_TARGET)}
                data-testid="journey-continue"
              >
                <ArrowDownIcon aria-hidden="true" />
                {fr.journey.continue}
              </Button>
            ) : null}
          </div>
        </div>
        <div className="on-light mt-4 short:mt-2">
          <ConfirmedJsonBlock payload={confirmedRequirements} />
        </div>
      </motion.section>
    );
  }

  return (
    <motion.section
      {...animation}
      aria-labelledby="confirmation-title"
      // White card with a 2px navy border: the one place where the red action waits.
      className="@container/card min-w-0 rounded-2xl border-2 border-primary bg-card shadow-card tall:p-5 short:p-3"
      data-testid="confirmation-card"
    >
      <div className={WRAP_ANYWHERE}>
        <h2 id="confirmation-title" className={cn(DISPLAY, "text-2xl leading-tight short:text-xl")}>
          {fr.confirmation.title}
        </h2>
        <p className="mt-1.5 text-[0.9375rem]">{fr.confirmation.message}</p>
      </div>
      {/* Side by side when both fit, otherwise stacked full-width. */}
      <div className="mt-4 flex flex-col gap-2.5 short:mt-3 @[26rem]/card:flex-row @[26rem]/card:justify-end">
        <Button type="button" variant="outline" onClick={onEdit} disabled={pending} className={cn(FLUID_BUTTON, TOUCH_TARGET)}>
          <PencilIcon aria-hidden="true" />
          {fr.confirmation.edit}
        </Button>
        <Button type="button" onClick={onConfirm} disabled={pending} data-testid="confirm-button" className={cn(FLUID_BUTTON, TOUCH_TARGET)}>
          {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <CheckCircle2Icon aria-hidden="true" />}
          {pending ? fr.confirmation.confirming : fr.confirmation.confirm}
        </Button>
      </div>
    </motion.section>
  );
}
