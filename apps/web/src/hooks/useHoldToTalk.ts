"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

/**
 * The talk gesture, independent of what it starts.
 *
 * - Press and hold (>= `holdThresholdMs`): talk while holding, release to finish.
 * - Short press: toggle — the recording keeps running, press again to finish.
 * - Dragging further than the cancel radius arms "release to cancel".
 * - Keyboard: Space or Enter toggles, Escape cancels (from anywhere on the page).
 * - `pointercancel` (system gesture, incoming call…) and a hidden tab cancel with a notice.
 * - A click that no pointer or key event explains (screen reader, switch access) toggles.
 *
 * Hold is never the only way in: tremor, a desktop mouse and assistive technology are
 * all served by the toggle.
 *
 * `active` is owned by the caller (the recorder's real state): if the recording ends for
 * another reason — maximum duration, an error — a finger still on the button ends nothing.
 */

export type GestureCancelReason = "slide" | "escape" | "interrupted";

export interface UseHoldToTalkOptions {
  /** True while a recording is being requested or running. */
  active: boolean;
  disabled?: boolean;
  holdThresholdMs?: number;
  /** Minimum cancel radius in CSS px; grows with the button size. */
  cancelRadiusPx?: number;
  onStart: () => void;
  onStop: () => void;
  onCancel: (reason: GestureCancelReason) => void;
  /** Any pointer or key release on the button (used to unlock audio on touch devices). */
  onRelease?: () => void;
}

export interface HoldToTalkButtonProps {
  ref: RefObject<HTMLButtonElement | null>;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onKeyUp: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

export interface HoldToTalk {
  buttonProps: HoldToTalkButtonProps;
  /** A pointer is currently down on the button. */
  pressed: boolean;
  /** The pointer is outside the cancel radius: releasing now discards the recording. */
  willCancel: boolean;
  /** "hold" while a press that started the recording is still down, else "toggle". */
  mode: "hold" | "toggle";
}

export const HOLD_THRESHOLD_MS = 250;
export const CANCEL_RADIUS_PX = 96;
/** A click this soon after a handled pointer/key event is its echo, not a new intent. */
const CLICK_ECHO_MS = 700;
const INTERACTIVE_SELECTOR = "a[href], button, input, textarea, select, summary, [contenteditable='true']";

interface Gesture {
  /** The button the press began on; a gesture never outlives it. */
  element: HTMLButtonElement;
  pointerId: number;
  downAt: number;
  originX: number;
  originY: number;
  radius: number;
  /** This press started the recording (as opposed to pressing again to stop it). */
  startedHere: boolean;
  /** The recording was seen running during this press. */
  sawActive: boolean;
  /** The recording ended for another reason while the pointer was down. */
  dead: boolean;
  outside: boolean;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function isActivationKey(key: string): boolean {
  return key === " " || key === "Spacebar" || key === "Enter";
}

export function useHoldToTalk(options: UseHoldToTalkOptions): HoldToTalk {
  const { active, disabled = false } = options;
  const [pressed, setPressed] = useState(false);
  const [willCancel, setWillCancel] = useState(false);
  const [holding, setHolding] = useState(false);

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const handledAtRef = useRef(Number.NEGATIVE_INFINITY);

  const markHandled = () => {
    handledAtRef.current = now();
  };

  const clearGesture = useCallback((element: HTMLButtonElement | null, pointerId: number) => {
    gestureRef.current = null;
    setPressed(false);
    setWillCancel(false);
    setHolding(false);
    try {
      if (element?.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
    } catch {
      // The capture was already released by the browser.
    }
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = optionsRef.current;
    if (current.disabled) return;
    if (event.isPrimary === false) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const element = event.currentTarget;
    const previous = gestureRef.current;
    // A gesture whose recording ended by itself, or whose button was unmounted before its
    // pointer came up (the stage changed), never receives its release: it must not block
    // the next press.
    if (previous && !previous.dead && previous.element === element && element.isConnected) return;
    try {
      // Keeps move/up events coming even when the finger leaves the button.
      element.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic events (tests, some assistive tools) have no active pointer to capture.
    }
    const size = element.getBoundingClientRect().width;
    const startedHere = !current.active;
    gestureRef.current = {
      element,
      pointerId: event.pointerId,
      downAt: now(),
      originX: event.clientX,
      originY: event.clientY,
      // Measured from where the press began, so a layout change under the finger
      // (the stage switching to "listen") can never arm a cancel by itself.
      radius: Math.max(current.cancelRadiusPx ?? CANCEL_RADIUS_PX, size * 1.25),
      startedHere,
      sawActive: current.active,
      dead: false,
      outside: false,
    };
    markHandled();
    setPressed(true);
    setHolding(startedHere);
    if (startedHere) current.onStart();
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.dead) return;
    const distance = Math.hypot(event.clientX - gesture.originX, event.clientY - gesture.originY);
    const outside = distance > gesture.radius;
    if (outside !== gesture.outside) {
      gesture.outside = outside;
      setWillCancel(outside);
    }
  }, []);

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const current = optionsRef.current;
      const heldMs = now() - gesture.downAt;
      clearGesture(event.currentTarget, event.pointerId);
      markHandled();
      current.onRelease?.();
      if (gesture.dead) return;
      if (gesture.outside) {
        current.onCancel("slide");
        return;
      }
      if (!gesture.startedHere) {
        // Second press of a toggle: finish.
        current.onStop();
        return;
      }
      // A long press is hold-to-talk and ends here; a short one leaves the recording running.
      if (heldMs >= (current.holdThresholdMs ?? HOLD_THRESHOLD_MS)) current.onStop();
    },
    [clearGesture],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      clearGesture(event.currentTarget, event.pointerId);
      markHandled();
      if (!gesture.dead) optionsRef.current.onCancel("interrupted");
    },
    [clearGesture],
  );

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!isActivationKey(event.key)) return;
    // The native activation (a click) is replaced by the toggle below.
    event.preventDefault();
    markHandled();
    const current = optionsRef.current;
    if (event.repeat || current.disabled) return;
    // While a recording runs, the document-level listener ends it from any focus position.
    if (!current.active) current.onStart();
  }, []);

  const onKeyUp = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!isActivationKey(event.key)) return;
    event.preventDefault();
    markHandled();
    optionsRef.current.onRelease?.();
  }, []);

  const onClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (now() - handledAtRef.current < CLICK_ECHO_MS) return;
    // No pointer or key event came with this click: it was synthesised by assistive technology.
    const current = optionsRef.current;
    if (current.disabled) return;
    markHandled();
    if (current.active) current.onStop();
    else current.onStart();
  }, []);

  const onContextMenu = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    // A long press must talk, not open the system menu.
    event.preventDefault();
  }, []);

  // The recording ended on its own (maximum duration, error) while a pointer is still
  // down: that pointer must not end or cancel anything when it is finally released.
  useEffect(() => {
    const gesture = gestureRef.current;
    if (active) {
      if (gesture) gesture.sawActive = true;
      return;
    }
    // `active` only turns true one render after the press that starts a recording, so a
    // gesture is invalidated only once it has seen the recording running.
    if (gesture?.sawActive) {
      gesture.dead = true;
      setPressed(false);
    }
    setWillCancel(false);
    setHolding(false);
  }, [active]);

  // While recording: keyboard from anywhere, and the tab going to the background.
  useEffect(() => {
    if (!active) return;
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      const current = optionsRef.current;
      if (event.key === "Escape") {
        event.preventDefault();
        markHandled();
        current.onCancel("escape");
        return;
      }
      if (!isActivationKey(event.key) || event.repeat) return;
      const target = event.target instanceof Element ? event.target : null;
      const onTalkButton = target !== null && target === buttonRef.current;
      // Space/Enter on another control keeps its own meaning (e.g. the "Annuler" button).
      if (!onTalkButton && target?.closest(INTERACTIVE_SELECTOR)) return;
      event.preventDefault();
      markHandled();
      current.onStop();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") optionsRef.current.onCancel("interrupted");
    };
    document.addEventListener("keydown", onDocumentKeyDown);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("keydown", onDocumentKeyDown);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active]);

  // A disabled button receives no pointer events: never leave a gesture dangling.
  useEffect(() => {
    if (!disabled || !gestureRef.current) return;
    gestureRef.current = null;
    setPressed(false);
    setWillCancel(false);
    setHolding(false);
  }, [disabled]);

  const buttonProps = useMemo<HoldToTalkButtonProps>(
    () => ({
      ref: buttonRef,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onKeyDown,
      onKeyUp,
      onClick,
      onContextMenu,
    }),
    [onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown, onKeyUp, onClick, onContextMenu],
  );

  return {
    buttonProps,
    pressed,
    willCancel: willCancel && active,
    mode: holding && pressed ? "hold" : "toggle",
  };
}
