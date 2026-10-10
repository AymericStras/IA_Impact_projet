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
 * A word longer than the button (uppercase, letter-spaced labels at 200 % text on a phone)
 * breaks rather than widening the page.
 */
export const FLUID_BUTTON = "h-auto min-h-10 max-w-full whitespace-normal py-1.5 text-center [overflow-wrap:anywhere]";
export const FLUID_BUTTON_SM = "h-auto min-h-8 max-w-full whitespace-normal py-1 text-center [overflow-wrap:anywhere]";

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

/** Small uppercase, letter-spaced navy label: field names, section headings inside cards. */
export const EYEBROW = "text-[0.6875rem] leading-snug font-bold tracking-[0.09em] text-primary uppercase";

/** Title or big value in the condensed display face (Barlow Semi Condensed 800). */
export const DISPLAY = "font-heading font-extrabold tracking-[-0.005em]";

/** Native select drawn as a pill, same boundary as the inputs. Pair it with `data-focus-inside`. */
export const SELECT_PILL =
  "focus-halo h-10 w-full min-w-0 rounded-full border-2 border-input bg-card px-4 text-base text-foreground transition-colors hover:border-primary focus-visible:border-primary disabled:bg-muted disabled:text-muted-foreground md:text-[0.9375rem] pointer-coarse:min-h-[44px]";
