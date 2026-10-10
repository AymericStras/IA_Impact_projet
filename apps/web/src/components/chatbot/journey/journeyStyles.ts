/** Class names shared by the journey components (tokens only, see docs/DESIGN.md §14). */

import { EYEBROW, SELECT_PILL } from "@/lib/ui";

/** White card inside the journey section: 22 px radius, hairline, soft navy shadow. */
export const JOURNEY_CARD = "min-w-0 rounded-2xl border border-border bg-card shadow-card tall:p-5 short:p-3.5";

/** Small label above a group of lines inside a card: capitals, letter-spaced, navy. */
export const JOURNEY_SUBHEADING = EYEBROW;

/** Title of a card: condensed display face. */
export const JOURNEY_CARD_TITLE = "font-heading text-xl leading-tight font-extrabold";

/** Quiet grey pill carrying a fact (line label, unlocked itineraries). */
export const JOURNEY_PILL = "inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-[0.8125rem] font-semibold text-foreground";

/**
 * Sentence the teacher must not miss (« Rien n'est modifié… », « Rien n'est réservé… »):
 * bold navy text led by a yellow disc carrying a navy icon. Yellow is a filled surface
 * here, never the text.
 */
export const JOURNEY_KEY_LINE = "flex items-start gap-2.5 text-[0.9375rem] font-bold";
export const JOURNEY_KEY_ICON = "flex size-6 shrink-0 items-center justify-center rounded-full bg-highlight text-highlight-foreground [&>svg]:size-3.5";

/** Native select, same look as the panel's constraint select. */
export const JOURNEY_SELECT = SELECT_PILL;

/**
 * Row or cell whose native checkbox / radio is stretched over it (invisible, `absolute
 * inset-0`): the whole row is the hit area and the focus ring is drawn on the row
 * (`focus-proxy`, the two-layer ring of globals.css).
 */
export const CHOICE_FOCUS = "focus-proxy";
export const CHOICE_INPUT = "absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed";
