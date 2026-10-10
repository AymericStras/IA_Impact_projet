import type { KeyboardEvent } from "react";

/**
 * Minimum 44 × 44 CSS px hit area on coarse pointers (touch), without changing the
 * density for mouse users. In px on purpose: a finger does not grow with the text size.
 * Add it to every interactive control.
 */
export const TOUCH_TARGET = "pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px]";

/**
 * Lets a text button grow and wrap its label instead of clipping it when space is short
 * (narrow screens, large text). Looks identical to the fixed-height button while the
 * label fits on one line. Use FLUID_BUTTON with the default size, FLUID_BUTTON_SM with `sm`.
 */
export const FLUID_BUTTON = "h-auto min-h-8 max-w-full whitespace-normal py-1 text-center";
export const FLUID_BUTTON_SM = "h-auto min-h-7 max-w-full whitespace-normal py-1 text-center";

/** Long unbroken strings (URLs, pasted tokens) wrap instead of widening the page. */
export const WRAP_ANYWHERE = "min-w-0 [overflow-wrap:anywhere]";

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
