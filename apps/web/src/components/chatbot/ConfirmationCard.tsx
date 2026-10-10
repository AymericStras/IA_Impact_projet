"use client";

import { motion, useReducedMotion } from "motion/react";
import { ArrowDownIcon, CheckCircle2Icon, ClipboardCheckIcon, Loader2Icon, PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fr } from "@/i18n/fr";
import { FLUID_BUTTON, FLUID_BUTTON_SM, TOUCH_TARGET, WRAP_ANYWHERE } from "@/lib/ui";
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
        className="min-w-0 rounded-2xl border border-success/30 bg-success-soft/60 tall:p-4 short:p-3"
        data-testid="confirmation-done"
      >
        <div className="flex items-start gap-3">
          <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
          <div className={cn("flex-1", WRAP_ANYWHERE)}>
            <h2 id="confirmation-done-title" className="text-sm font-semibold text-foreground">
              {fr.confirmation.confirmedTitle}
            </h2>
            <p className="mt-1 text-sm text-foreground">{fr.confirmation.confirmedMessage}</p>
            <p className="mt-1 text-xs text-muted-foreground">{fr.confirmation.stillEditable}</p>
            {onContinue ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onContinue}
                className={cn("mt-2 bg-card", FLUID_BUTTON_SM, TOUCH_TARGET)}
                data-testid="journey-continue"
              >
                <ArrowDownIcon aria-hidden="true" />
                {fr.journey.continue}
              </Button>
            ) : null}
          </div>
        </div>
        <div className="mt-3">
          <ConfirmedJsonBlock payload={confirmedRequirements} />
        </div>
      </motion.section>
    );
  }

  return (
    <motion.section
      {...animation}
      aria-labelledby="confirmation-title"
      className="@container/card min-w-0 rounded-2xl border border-primary/25 bg-accent/40 tall:p-4 short:p-3"
      data-testid="confirmation-card"
    >
      <div className="flex items-start gap-3">
        <ClipboardCheckIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <div className={cn("flex-1", WRAP_ANYWHERE)}>
          <h2 id="confirmation-title" className="text-sm font-semibold">
            {fr.confirmation.title}
          </h2>
          <p className="mt-1 text-sm">{fr.confirmation.message}</p>
        </div>
      </div>
      {/* Side by side when both fit, otherwise stacked full-width. */}
      <div className="mt-3 flex flex-col gap-2 @[19.5rem]/card:flex-row @[19.5rem]/card:justify-end">
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
