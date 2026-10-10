"use client";

import { MicIcon, SquareIcon, XIcon } from "lucide-react";
import type { HoldToTalk } from "@/hooks/useHoldToTalk";
import { frVoice } from "@/i18n/fr.voice";
import styles from "./voice.module.css";

interface TalkButtonProps {
  /** Gesture state and handlers from `useHoldToTalk` (owned by the flow, shared with the stage). */
  gesture: HoldToTalk;
  /** A recording is being requested or is running. */
  active: boolean;
  disabled?: boolean;
  /** Id of the visible hint that explains the gesture. */
  describedBy?: string;
}

/**
 * The one talk control: hold to talk, tap to toggle, Space/Enter, Escape to cancel.
 *
 * A real `<button>` with `aria-pressed` and a visible text label under the disc, so its
 * state is never carried by colour or motion alone. It stays mounted across the `ask`,
 * `listen` and `sheet` stages: the pointer that started a recording keeps its capture.
 */
export function TalkButton({ gesture, active, disabled = false, describedBy }: TalkButtonProps) {
  const { buttonProps, pressed, willCancel, mode } = gesture;
  const label = willCancel ? frVoice.talk.cancel : active ? frVoice.talk.stop : frVoice.talk.name;
  const Icon = willCancel ? XIcon : active && mode === "toggle" ? SquareIcon : MicIcon;

  return (
    <button
      {...buttonProps}
      type="button"
      className={styles.talk}
      aria-pressed={active}
      aria-describedby={describedBy}
      aria-keyshortcuts="Space Enter Escape"
      disabled={disabled}
      data-testid="talk-button"
      data-pressed={pressed}
      data-mode={mode}
      data-will-cancel={willCancel}
      // Long-press must not start a drag of the button's content.
      draggable={false}
    >
      <span className={styles.talkCircle} data-testid="talk-disc">
        <Icon aria-hidden="true" className="size-[38%]" strokeWidth={2} fill={Icon === SquareIcon ? "currentColor" : "none"} />
      </span>
      <span className={styles.talkLabel}>{label}</span>
    </button>
  );
}
