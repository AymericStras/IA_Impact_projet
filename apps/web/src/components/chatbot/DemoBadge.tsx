"use client";

import { SparklesIcon } from "lucide-react";
import { badgeVariants } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fr } from "@/i18n/fr";
import { TOUCH_TARGET } from "@/lib/ui";
import { cn } from "@/lib/utils";

/**
 * Unambiguously signals that replies are scripted (invariant 12): a yellow pill with navy
 * text (11.07:1), the accent of the identity, on the navy header.
 */
export function DemoBadge() {
  return (
    <Tooltip>
      {/* The trigger is a transparent 44 px target on touch; the pill inside keeps its size. */}
      <TooltipTrigger
        className={cn("inline-flex cursor-help items-center justify-center rounded-4xl", TOUCH_TARGET)}
        aria-label={`${fr.demo.badge} : ${fr.demo.tooltip}`}
        data-testid="demo-badge"
      >
        <span className={cn(badgeVariants({ variant: "outline" }), "h-6 border-transparent bg-highlight px-2.5 font-bold text-highlight-foreground")}>
          <SparklesIcon aria-hidden="true" />
          {fr.demo.badge}
        </span>
      </TooltipTrigger>
      <TooltipContent>{fr.demo.tooltip}</TooltipContent>
    </Tooltip>
  );
}
