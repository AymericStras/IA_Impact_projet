"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { frVoice } from "@/i18n/fr.voice";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion";
import styles from "../voice.module.css";

/** A horizontal movement shorter than this is a tap or a scroll, not a swipe (px). */
export const SWIPE_DISTANCE = 48;

interface CarouselProps<T> {
  items: readonly T[];
  index: number;
  onIndexChange: (index: number) => void;
  /** Name of the whole set, e.g. « Destinations proposées ». */
  label: string;
  previousLabel: string;
  nextLabel: string;
  /** Accessible name of one card: « Destination 2 sur 4 : Albi ». */
  slideLabel: (item: T, position: number, total: number) => string;
  children: (item: T, index: number) => ReactNode;
  /** Arrow keys are ignored while a request is in flight. */
  disabled?: boolean;
  testId: string;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // Fields and radio groups use the arrow keys themselves.
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * One card at a time, in the order the server sent them. Three ways to move, all
 * equivalent: the labelled buttons, the ← / → keys (from anywhere on the stage that does
 * not use them itself), and a horizontal swipe on the card. It never wraps around: the
 * first and the last card are ends, and the buttons say so by being disabled.
 */
export function Carousel<T>({
  items,
  index,
  onIndexChange,
  label,
  previousLabel,
  nextLabel,
  slideLabel,
  children,
  disabled = false,
  testId,
}: CarouselProps<T>) {
  const reducedMotion = usePrefersReducedMotion();
  const total = items.length;
  const current = Math.min(Math.max(index, 0), total - 1);
  const directionRef = useRef(1);
  const swipeRef = useRef<{ id: number; x: number; y: number } | null>(null);

  const go = (target: number) => {
    const next = Math.min(Math.max(target, 0), total - 1);
    if (next === current || disabled) return;
    directionRef.current = next > current ? 1 : -1;
    onIndexChange(next);
  };
  const goRef = useRef(go);
  goRef.current = go;
  const currentRef = useRef(current);
  currentRef.current = current;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === "ArrowRight") goRef.current(currentRef.current + 1);
      else if (event.key === "ArrowLeft") goRef.current(currentRef.current - 1);
      else if (event.key === "Home") goRef.current(0);
      else if (event.key === "End") goRef.current(Number.MAX_SAFE_INTEGER);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (total === 0) return null;
  const item = items[current]!;

  const onPointerDown = (event: ReactPointerEvent) => {
    // A mouse drag selects text; swiping is for fingers and pens.
    if (event.pointerType === "mouse") return;
    swipeRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: ReactPointerEvent) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    go(dx < 0 ? current + 1 : current - 1);
  };

  const NAV_BUTTON =
    "inline-flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-card text-primary hover:bg-muted disabled:pointer-events-none disabled:border-input disabled:bg-muted disabled:text-muted-foreground";

  return (
    <section aria-roledescription="carrousel" aria-label={label} className="grid min-w-0 gap-3" data-testid={testId} data-index={current}>
      {total > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className={NAV_BUTTON}
            onClick={() => go(current - 1)}
            disabled={current === 0 || disabled}
            aria-label={previousLabel}
            data-testid={`${testId}-previous`}
          >
            <ChevronLeftIcon className="size-5" aria-hidden="true" />
          </button>
          <div className="flex min-w-0 flex-col items-center gap-1">
            <div className="flex flex-wrap items-center justify-center gap-1.5" aria-hidden="true" data-testid={`${testId}-dots`}>
              {items.map((_, position) => (
                <span
                  key={position}
                  data-current={position === current}
                  className={cn(
                    "h-2.5 rounded-full border-2 border-primary",
                    // The current card is a filled bar, the others hollow dots: shape, not colour alone.
                    position === current ? "w-6 bg-primary" : "w-2.5 bg-transparent",
                  )}
                />
              ))}
            </div>
            <p className="text-sm font-medium text-foreground" aria-live="polite" aria-atomic="true" data-testid={`${testId}-position`}>
              {frVoice.journey.carousel.position(current + 1, total)}
            </p>
          </div>
          <button
            type="button"
            className={NAV_BUTTON}
            onClick={() => go(current + 1)}
            disabled={current === total - 1 || disabled}
            aria-label={nextLabel}
            data-testid={`${testId}-next`}
          >
            <ChevronRightIcon className="size-5" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <motion.div
        key={current}
        role="group"
        aria-roledescription="diapositive"
        aria-label={slideLabel(item, current + 1, total)}
        className={cn(styles.slide, "min-w-0")}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipeRef.current = null;
        }}
        // The card comes from the side it was asked from; reduced motion: a plain cross-fade.
        initial={{ opacity: 0, x: reducedMotion ? 0 : directionRef.current * 28 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: reducedMotion ? 0.12 : 0.22, ease: [0.22, 1, 0.36, 1] }}
        data-testid={`${testId}-slide`}
      >
        {children(item, current)}
      </motion.div>

      {total > 1 ? (
        <p className="hidden text-center text-xs text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:block" data-testid={`${testId}-keys`}>
          {frVoice.journey.carousel.keyboardHint}
        </p>
      ) : null}
    </section>
  );
}
