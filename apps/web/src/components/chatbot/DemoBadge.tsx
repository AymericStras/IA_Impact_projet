"use client";

import { SparklesIcon } from "lucide-react";
import { badgeVariants } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fr } from "@/i18n/fr";
import { cn } from "@/lib/utils";

/** Unambiguously signals that replies are scripted (invariant 12). */
export function DemoBadge() {
  return (
    <Tooltip>
      <TooltipTrigger
        className={cn(
          badgeVariants({ variant: "outline" }),
          "cursor-help border-warning/50 bg-warning/10 text-foreground",
        )}
        aria-label={`${fr.demo.badge} : ${fr.demo.tooltip}`}
        data-testid="demo-badge"
      >
        <SparklesIcon aria-hidden="true" />
        {fr.demo.badge}
      </TooltipTrigger>
      <TooltipContent>{fr.demo.tooltip}</TooltipContent>
    </Tooltip>
  );
}
