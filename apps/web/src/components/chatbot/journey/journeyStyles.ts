/** Class names shared by the journey components (tokens only, see docs/DESIGN.md §7b). */

/** White card inside the journey section. */
export const JOURNEY_CARD = "min-w-0 rounded-xl border bg-card tall:p-4 short:p-3";

/** Small label above a group of lines inside a card. */
export const JOURNEY_SUBHEADING = "text-xs font-medium text-muted-foreground";

/** Native select, same look as the panel's constraint select. */
export const JOURNEY_SELECT =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm pointer-coarse:min-h-[44px] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

/**
 * Row or cell whose native checkbox / radio is stretched over it (invisible, `absolute
 * inset-0`): the whole row is the hit area and the focus ring is drawn on the row.
 */
export const CHOICE_FOCUS =
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring";
export const CHOICE_INPUT = "absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed";
