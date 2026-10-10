"use client";

import { useEffect, useState } from "react";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fr } from "@/i18n/fr";
import { FLUID_BUTTON_SM, TOUCH_TARGET } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { ConfirmedRequirements } from "@/types/contracts";

interface ConfirmedJsonBlockProps {
  payload: ConfirmedRequirements;
  defaultOpen?: boolean;
}

/** Collapsible "JSON transmis" block with copy; the time constraint lines are highlighted. */
export function ConfirmedJsonBlock({ payload, defaultOpen = true }: ConfirmedJsonBlockProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const json = JSON.stringify(payload, null, 2);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = setTimeout(() => setCopyState("idle"), 2_000);
    return () => clearTimeout(timer);
  }, [copyState]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div className="min-w-0 rounded-xl border bg-muted/40" data-testid="confirmed-json">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="confirmed-json-content"
          className={cn("-ml-2", FLUID_BUTTON_SM, TOUCH_TARGET)}
        >
          {open ? <ChevronUpIcon aria-hidden="true" /> : <ChevronDownIcon aria-hidden="true" />}
          {fr.confirmation.jsonTitle}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()} aria-live="polite" className={cn(FLUID_BUTTON_SM, TOUCH_TARGET)}>
          {copyState === "copied" ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          {copyState === "copied" ? fr.confirmation.jsonCopied : fr.confirmation.jsonCopy}
        </Button>
      </div>
      {open ? (
        <div id="confirmed-json-content" className="border-t px-3 py-2">
          <p className="mb-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{fr.confirmation.jsonHint}</p>
          <pre
            // The only intentionally horizontally scrollable region; focusable for keyboard scrolling.
            tabIndex={0}
            data-scroll-x=""
            aria-label={fr.confirmation.jsonTitle}
            className="thin-scrollbar overflow-x-auto rounded-lg bg-card p-3 font-mono text-xs leading-relaxed ring-1 ring-foreground/10">
            {json.split("\n").map((line, index) => (
              <span
                key={index}
                className={cn("block", line.includes('"constraint"') && "rounded bg-accent px-1 -mx-1 text-accent-foreground")}
              >
                {line}
              </span>
            ))}
          </pre>
          {copyState === "failed" ? <p className="mt-2 text-xs text-destructive">{fr.errors.copyFailed}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
