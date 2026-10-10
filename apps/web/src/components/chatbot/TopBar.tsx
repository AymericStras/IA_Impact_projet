"use client";

import { RotateCcwIcon, TrainFrontIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fr } from "@/i18n/fr";
import { isDemoMode } from "@/lib/env";
import { TOUCH_TARGET } from "@/lib/ui";
import { DemoBadge } from "./DemoBadge";
import { HelpDialog } from "./HelpDialog";

interface TopBarProps {
  onRestart: () => void;
  disabled?: boolean;
}

export function TopBar({ onRestart, disabled = false }: TopBarProps) {
  return (
    <header className="z-20 shrink-0 border-b bg-background">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"
          >
            <TrainFrontIcon className="size-4" />
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-base font-semibold tracking-tight text-primary">{fr.app.brand}</span>
            <h1 className="hidden text-sm font-medium text-foreground sm:block md:text-base">{fr.app.title}</h1>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {isDemoMode ? <DemoBadge /> : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={fr.app.newConversation}
                  onClick={onRestart}
                  disabled={disabled}
                  className={TOUCH_TARGET}
                />
              }
            >
              <RotateCcwIcon aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>{fr.app.newConversation}</TooltipContent>
          </Tooltip>
          <HelpDialog />
        </div>
      </div>
    </header>
  );
}
