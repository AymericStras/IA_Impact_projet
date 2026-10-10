"use client";

import { useEffect, useState, type RefObject } from "react";

/** A keyboard is assumed when the visual viewport loses at least this many px. */
const KEYBOARD_MIN_INSET = 80;

/**
 * Keeps the app shell above the on-screen keyboard.
 *
 * Where the keyboard overlays the page instead of resizing it (iOS Safari, and Chrome
 * without `interactive-widget=resizes-content`), the visual viewport shrinks while the
 * layout viewport does not. This sets `--app-height` on the shell to the visual viewport
 * height so the composer stays visible; the thread then keeps its latest message in view
 * through its own resize handling. The variable is removed when the keyboard closes.
 *
 * Pinch-zoom also shrinks the visual viewport: it is ignored (scale ≠ 1), so zooming
 * never changes the layout.
 */
export function useKeyboardInset(shellRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const viewport = typeof window !== "undefined" ? window.visualViewport : null;
    const shell = shellRef.current;
    if (!viewport || !shell) return;

    const update = () => {
      const zoomed = Math.abs(viewport.scale - 1) > 0.01;
      const inset = window.innerHeight - viewport.height;
      if (!zoomed && inset >= KEYBOARD_MIN_INSET) {
        shell.style.setProperty("--app-height", `${Math.round(viewport.height)}px`);
        // iOS scrolls the page to reveal the focused field; the shell now fits, so undo it.
        if (viewport.offsetTop > 0) window.scrollTo(0, 0);
      } else {
        shell.style.removeProperty("--app-height");
      }
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      shell.style.removeProperty("--app-height");
    };
  }, [shellRef]);
}

/**
 * Publishes the height of `sourceRef` as a CSS variable on `targetRef`, so a sibling
 * layer (the expanded project panel on single-column layouts) can size itself to the
 * conversation area without covering the composer.
 */
export function useHeightVariable(
  sourceRef: RefObject<HTMLElement | null>,
  targetRef: RefObject<HTMLElement | null>,
  variable: string,
  /** False while the source element is not mounted yet. */
  enabled: boolean,
): void {
  useEffect(() => {
    const source = sourceRef.current;
    const target = targetRef.current;
    if (!enabled || !source || !target || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      target.style.setProperty(variable, `${source.clientHeight}px`);
    });
    observer.observe(source);
    return () => {
      observer.disconnect();
      target.style.removeProperty(variable);
    };
  }, [sourceRef, targetRef, variable, enabled]);
}

/** True while `ref` is narrower than `rem` root ems (follows the text size, not raw px). */
export function useNarrowerThan(ref: RefObject<HTMLElement | null>, rem: number, deps: unknown[] = []): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setNarrow(element.clientWidth < rem * rootFontSize);
    });
    observer.observe(element);
    return () => observer.disconnect();
    // `deps` lets the caller re-attach when the observed element is re-mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, rem, ...deps]);
  return narrow;
}
