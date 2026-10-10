"use client";

import type { ReactNode } from "react";
import { CircleAlertIcon, InfoIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { frVoice } from "@/i18n/fr.voice";
import { FLUID_BUTTON, TOUCH_TARGET, WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";

interface BannerProps {
  /** "notice" is informative (`role="status"`); "error" interrupts (`role="alert"`). */
  kind: "notice" | "error";
  title?: string;
  /** Plain text: server details and hints are never rendered as HTML. */
  children: ReactNode;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  onDismiss?: () => void;
  testId?: string;
}

/** Notice or error block of the voice flow: icon + text, optional action and dismiss. */
export function Banner({ kind, title, children, action, onDismiss, testId }: BannerProps) {
  const isError = kind === "error";
  const Icon = isError ? CircleAlertIcon : InfoIcon;
  return (
    <div
      role={isError ? "alert" : "status"}
      data-testid={testId}
      className={cn(
        "flex flex-wrap items-start gap-2 rounded-xl border px-3 py-2.5 text-sm text-foreground",
        isError ? "border-destructive/30 bg-destructive/5" : "border-primary/20 bg-accent/50",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", isError ? "text-destructive" : "text-primary")} aria-hidden="true" />
      <div className={cn("flex-[1_1_12rem]", WRAP_ANYWHERE)}>
        {title ? <p className={cn("font-medium", isError && "text-destructive")}>{title}</p> : null}
        <p className="whitespace-pre-wrap">{children}</p>
      </div>
      <div className="ml-auto flex max-w-full items-center gap-1">
        {action ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={action.onClick}
            disabled={action.disabled}
            className={cn(FLUID_BUTTON, TOUCH_TARGET)}
            data-testid={testId ? `${testId}-action` : undefined}
          >
            {action.label}
          </Button>
        ) : null}
        {onDismiss ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={onDismiss}
            aria-label={frVoice.chrome.dismiss}
            className={cn("shrink-0", TOUCH_TARGET)}
          >
            <XIcon aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
