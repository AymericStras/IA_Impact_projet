"use client";

import { Children, createContext, isValidElement, useContext, useId, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon, ChevronUpIcon, Loader2Icon } from "lucide-react";
import { frVoice } from "@/i18n/fr.voice";
import { cn } from "@/lib/utils";
import styles from "../voice.module.css";

/**
 * Where the actions of the current stage are rendered: the dock, outside the scrolling
 * stage area, so the primary action is always reachable.
 *
 * - an element: the dock of `VoiceFlow`;
 * - null: the dock is not mounted yet (nothing is rendered for that one commit);
 * - undefined (no provider, e.g. a stage rendered alone in a test): inline, after the stage.
 */
export const DockSlotContext = createContext<HTMLElement | null | undefined>(undefined);

interface StageActionsProps {
  /** `ActionButton`s as direct children: secondary actions first, the one primary action last. */
  children: ReactNode;
  /** The stage is a narrow column (`max-w-2xl`): the actions line up with it. */
  narrow?: boolean;
}

function isPrimary(child: ReactNode): boolean {
  return isValidElement<{ primary?: boolean }>(child) && child.props.primary === true;
}

/**
 * The actions of a stage. On the narrowest shells (very large text on a phone) several
 * secondary actions stacked above the primary one would leave almost nothing of the stage:
 * there, two or more of them fold behind one « Autres choix » button (the `tiny` tier of
 * voice.module.css shows it; everywhere else it does not exist and the actions are all
 * visible). Nothing is removed: one tap shows them.
 */
export function StageActions({ children, narrow = false }: StageActionsProps) {
  const slot = useContext(DockSlotContext);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const items = Children.toArray(children);
  const secondary = items.filter((child) => !isPrimary(child));
  const primary = items.filter(isPrimary);
  const collapsible = secondary.length >= 2;

  const actions = (
    <div className={cn(styles.actions, narrow && styles.actionsNarrow)} data-testid="stage-actions" data-collapsible={collapsible} data-open={open}>
      {collapsible ? (
        <button
          type="button"
          className={cn(ACTION_BASE, ACTION_SECONDARY, styles.action, styles.actionsMore)}
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((value) => !value)}
          data-testid="actions-more"
        >
          {open ? <ChevronUpIcon aria-hidden="true" /> : <ChevronDownIcon aria-hidden="true" />}
          {open ? frVoice.journey.lessActions : frVoice.journey.moreActions}
        </button>
      ) : null}
      <div id={listId} className={styles.actionsSecondary}>
        {secondary}
      </div>
      {primary}
    </div>
  );
  if (slot === undefined) return actions;
  return slot ? createPortal(actions, slot) : null;
}

// 44 px in px on purpose (a finger does not grow with the text size): with very large text
// a one-line action stays one line high instead of doubling with the root font size.
const ACTION_BASE =
  "inline-flex min-h-[44px] max-w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-center text-sm font-medium [overflow-wrap:anywhere] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";
const ACTION_SECONDARY = "border-input bg-card text-foreground hover:bg-muted";
const ACTION_PRIMARY = "border-transparent bg-primary px-5 text-base font-semibold text-primary-foreground hover:bg-primary/85";

interface ActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  /** One per stage. */
  primary?: boolean;
  /** The request behind this action is in flight: spinner, and the label says so. */
  busy?: boolean;
  testId?: string;
}

/** A dock action: 44 px high at least, label never clipped (it wraps). */
export function ActionButton({ primary = false, busy = false, testId, className, children, ...rest }: ActionButtonProps) {
  return (
    <button
      type="button"
      className={cn(ACTION_BASE, primary ? ACTION_PRIMARY : ACTION_SECONDARY, styles.action, primary && styles.actionsPrimary, className)}
      data-testid={testId}
      data-primary={primary ? "true" : undefined}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
