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

/**
 * Brand on the left, actions on the right. The row wraps (actions drop to a second line)
 * rather than overflow when text is very large; it gets slimmer on short viewports and
 * clears the top safe area (notch) on phones.
 */
export function TopBar({ onRestart, disabled = false }: TopBarProps) {
  return (
    <header className="z-20 shrink-0 border-b bg-background pt-[env(safe-area-inset-top)]">
      <div className="px-safe mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 tall:min-h-14 tall:py-1.5 short:min-h-11 short:py-0.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground tall:size-8 short:size-7"
          >
            <TrainFrontIcon className="size-4" />
          </span>
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="text-base font-semibold tracking-tight text-primary">{fr.app.brand}</span>
            <h1 className="hidden text-sm font-medium text-foreground titled:block roomy:text-base">{fr.app.title}</h1>
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
