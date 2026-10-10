"use client";

import Link from "next/link";
import { AudioLinesIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fr } from "@/i18n/fr";
import { isDemoMode } from "@/lib/env";
import { DISPLAY, TOUCH_TARGET, WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { DemoBadge } from "./DemoBadge";
import { HelpDialog } from "./HelpDialog";
import { Trame } from "./Trame";

interface TopBarProps {
  onRestart: () => void;
  disabled?: boolean;
}

/**
 * Navy header of the « V3 — Occitanie en train » identity: the liO wordmark, the page title
 * in white condensed type, the trame under it, and the controls restyled for a navy surface
 * (`.on-navy`: white inner focus ring; no red here, it would be 2.66:1).
 *
 * Three arrangements, all from the shell tiers:
 * - tall single column (phones): wordmark and controls on one row, title and trame below;
 * - tall two columns: one band — wordmark, title with the trame under it, controls;
 * - short (landscape phones, very large text): one slim row, the trame beside the title
 *   (there is no room under it), so the conversation keeps its share of the height.
 * The row wraps (controls drop to a second line) rather than overflow when text is very
 * large, and the header clears the top safe area (notch) on phones.
 */
export function TopBar({ onRestart, disabled = false }: TopBarProps) {
  return (
    <header className="on-navy z-20 shrink-0 bg-primary pt-[env(safe-area-inset-top)] text-primary-foreground">
      <div className="px-page flex w-full flex-wrap items-center gap-x-3 short:min-h-11 short:gap-y-0.5 short:py-0.5 single:tall:gap-y-0 single:tall:pt-1.5 single:tall:pb-3.5 narrow:tall:pb-1.5 wide:tall:gap-x-6 wide:tall:py-4">
        {/* `contents` on tall single-column shells: wordmark, title and trame become items of
            the row above, so the controls can sit between the wordmark and the title. */}
        <div className="flex min-w-0 short:flex-row short:items-center short:gap-3 single:tall:contents wide:tall:flex-col wide:tall:gap-2">
          <div className="flex min-w-0 items-baseline gap-x-3 single:tall:contents wide:tall:gap-x-4">
            <span className={cn(DISPLAY, "leading-none short:text-xl single:tall:order-1 single:tall:self-center single:tall:text-[1.75rem] wide:tall:text-[1.75rem] roomy:tall:text-[2rem]")}>
              {fr.app.brand}
            </span>
            <span aria-hidden="true" className="hidden h-6 w-px shrink-0 self-center bg-primary-foreground/30 wide:tall:block" />
            <h1
              className={cn(
                DISPLAY,
                WRAP_ANYWHERE,
                "sr-only leading-none titled:not-sr-only tall:not-sr-only short:text-lg single:tall:order-3 single:tall:mt-1 single:tall:basis-full single:tall:text-[1.625rem] single:tall:leading-[1.1] narrow:tall:mt-0 narrow:tall:text-xl wide:tall:text-[1.75rem] roomy:tall:text-[2rem]",
              )}
            >
              {fr.app.headerTitle}
            </h1>
          </div>
          <Trame className="max-w-full short:w-24 narrow:short:hidden single:tall:order-4 single:tall:mt-2.5 single:tall:w-36 narrow:tall:mt-1 wide:tall:w-44" />
        </div>
        <div className="ml-auto flex items-center gap-1 single:tall:order-2 wide:tall:gap-2">
          {isDemoMode ? <DemoBadge /> : null}
          {/* Same conversation, other experience: the staged voice flow. Hidden on narrow shells
              (320 px phones, very large text), where the Help dialog carries the same link. */}
          <Link
            href="/vocal"
            aria-label={fr.app.voiceLinkLabel}
            title={fr.app.voiceLink}
            className={cn(
              "inline-flex h-8 min-w-8 items-center justify-center gap-2 rounded-full border-2 border-transparent text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-foreground/15 narrow:hidden roomy:tall:h-10 roomy:tall:border-primary-foreground roomy:tall:px-4",
              TOUCH_TARGET,
            )}
          >
            <AudioLinesIcon className="size-4" aria-hidden="true" />
            <span className="hidden roomy:tall:inline">{fr.app.voiceLink}</span>
          </Link>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost-inverse"
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
