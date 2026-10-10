"use client";

import { CircleAlertIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fr } from "@/i18n/fr";
import { FLUID_BUTTON_SM, TOUCH_TARGET } from "@/lib/ui";
import { cn } from "@/lib/utils";

interface ErrorMessageProps {
  /** French text provided by the server (`detail`) or by the client. */
  detail: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorMessage({ detail, onRetry, onDismiss, retryLabel, className }: ErrorMessageProps) {
  return (
    <div
      role="alert"
      data-testid="error-message"
      className={cn(
        "flex flex-wrap items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm",
        className,
      )}
    >
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 flex-[1_1_12rem] [overflow-wrap:anywhere]">
        <p className="font-medium text-destructive">{fr.errors.title}</p>
        <p className="text-foreground">{detail}</p>
      </div>
      <div className="ml-auto flex max-w-full items-center gap-1">
        {onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry} className={cn(FLUID_BUTTON_SM, TOUCH_TARGET)} data-testid="error-retry">
            {retryLabel ?? fr.errors.retry}
          </Button>
        ) : null}
        {onDismiss ? (
          <Button size="icon-sm" variant="ghost" onClick={onDismiss} aria-label={fr.errors.dismiss} className={cn("shrink-0", TOUCH_TARGET)}>
            <XIcon aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
