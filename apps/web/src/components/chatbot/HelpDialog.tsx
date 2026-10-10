"use client";

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
import { TOUCH_TARGET } from "@/lib/ui";

/** "Aide" button and dialog explaining the four expected pieces of information. */
export function HelpDialog() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="sm" className={TOUCH_TARGET} />}>
        <CircleHelpIcon aria-hidden="true" />
        {fr.app.help}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{fr.help.title}</DialogTitle>
          <DialogDescription>{fr.help.intro}</DialogDescription>
        </DialogHeader>
        <ol className="grid gap-2.5 text-sm">
          {fr.help.items.map((item, index) => (
            <li key={item.label} className="flex gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
              >
                {index + 1}
              </span>
              <span>
                <span className="font-medium">{item.label}</span>
                <span className="text-muted-foreground"> — {item.hint}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">{fr.help.example}</p>
        <p className="text-xs text-muted-foreground">{fr.help.privacy}</p>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" className={TOUCH_TARGET} />}>{fr.help.close}</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
