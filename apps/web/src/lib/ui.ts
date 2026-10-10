import type { KeyboardEvent } from "react";

/**
 * Minimum 44 × 44 px hit area below the `lg` breakpoint (touch layouts), without
 * changing the desktop density. Add it to every interactive control.
 */
export const TOUCH_TARGET = "max-lg:min-h-11 max-lg:min-w-11";

/**
 * True for a plain Enter that should submit. Enter pressed while an IME composition is
 * active (Chinese, Japanese, accents via dead keys…) only validates the composition:
 * `isComposing` covers modern browsers, keyCode 229 covers Safari.
 */
export function isSubmitEnter(event: KeyboardEvent): boolean {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.nativeEvent.isComposing &&
    event.keyCode !== 229
  );
}
