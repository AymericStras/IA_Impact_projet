"use client";

import Link from "next/link";
import { useRef } from "react";
import { CircleHelpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { fr } from "@/i18n/fr";
import { isDemoMode } from "@/lib/env";
import { FLUID_BUTTON, TOUCH_TARGET } from "@/lib/ui";
import { cn } from "@/lib/utils";

/** "Aide" button and dialog explaining the five expected pieces of information. */
export function HelpDialog() {
  const popupRef = useRef<HTMLDivElement>(null);
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost-inverse" size="sm" className={cn("narrow:px-2", TOUCH_TARGET)} />}>
        <CircleHelpIcon aria-hidden="true" />
        {/* Icon-only on narrow screens; the label stays the accessible name. */}
        <span className="narrow:sr-only">{fr.app.help}</span>
      </DialogTrigger>
      {/*
        Never taller than the viewport: the content scrolls. The footer button closes it.
        Focus goes to the dialog itself, not to its only button (« Fermer », at the end):
        on a short viewport that would open the dialog scrolled to its last lines.
        The single grid column may shrink below its longest word (large text on a phone):
        the word then breaks instead of making the dialog scroll sideways.
      */}
      <DialogContent
        ref={popupRef}
        initialFocus={popupRef}
        className="on-light max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto [overflow-wrap:anywhere] sm:max-w-lg"
        showCloseButton={false}
        data-testid="help-dialog"
      >
        <DialogHeader>
          <DialogTitle>{fr.help.title}</DialogTitle>
          <DialogDescription>{fr.help.intro}</DialogDescription>
        </DialogHeader>
        <ol className="grid gap-3 text-[0.9375rem]">
          {fr.help.items.map((item, index) => (
            <li key={item.label} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
              >
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="font-bold">{item.label}</span>
                <span className="text-muted-foreground"> — {item.hint}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-foreground">{fr.help.example}</p>
        <p className="text-[0.8125rem] text-muted-foreground">{fr.help.privacy}</p>
        {/* The badge tooltip needs hover: the same information is always readable here. */}
        {isDemoMode ? <p className="text-[0.8125rem] text-muted-foreground">{fr.demo.description}</p> : null}
        <p className="text-sm">
          <Link
            href="/vocal"
            className={cn("inline-flex items-center font-bold text-primary underline underline-offset-4", TOUCH_TARGET)}
          >
            {fr.help.voiceLink}
          </Link>
        </p>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" className={cn(FLUID_BUTTON, TOUCH_TARGET)} />}>{fr.help.close}</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
