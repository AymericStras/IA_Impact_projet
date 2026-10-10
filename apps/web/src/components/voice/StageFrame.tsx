"use client";

import { useEffect, useRef, type ReactNode, type Ref } from "react";
import Link from "next/link";
import { MessagesSquareIcon, RotateCcwIcon, SparklesIcon, TrainFrontIcon } from "lucide-react";
import { useKeyboardInset } from "@/hooks/useViewportTracking";
import type { StageId } from "@/hooks/useVoiceFlow";
import { frVoice } from "@/i18n/fr.voice";
import { Trame } from "@/components/chatbot/Trame";
import { DISPLAY, TOUCH_TARGET } from "@/lib/ui";
import { cn } from "@/lib/utils";
import styles from "./voice.module.css";

interface StageHeadingProps {
  children: ReactNode;
  /** Moves keyboard and screen-reader focus here when the stage is entered. */
  focusOnEnter: boolean;
  className?: string;
}

/** The one `h1` of a stage. Focusable by script only, so entering a stage can land on it. */
export function StageHeading({ children, focusOnEnter, className }: StageHeadingProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnEnter) ref.current?.focus({ preventScroll: true });
    // Only on entry: later re-renders of the same stage must not steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <h1 ref={ref} tabIndex={-1} className={cn(styles.stageHeading, "[overflow-wrap:anywhere]", className, DISPLAY)} data-testid="stage-heading">
      {children}
    </h1>
  );
}

interface StageFrameProps {
  stage: StageId | "loading";
  /** "accent" turns the whole screen into the accent surface (listen). */
  tone: "plain" | "accent";
  demo: boolean;
  /** Progress indicator, when there is a conversation to show it for. */
  progress?: ReactNode;
  /** Navigation away is hidden while recording or analysing. */
  showNavigation: boolean;
  navigationDisabled?: boolean;
  onRestart: () => void;
  /** Text announced politely when the stage changes. */
  announcement: string;
  mainRef?: Ref<HTMLElement>;
  children: ReactNode;
  dock?: ReactNode;
}

const NAV_BUTTON =
  "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-full px-2 text-sm font-semibold text-primary-foreground hover:bg-primary-foreground/15 disabled:pointer-events-none disabled:opacity-60";

/**
 * Shared chrome of every stage: a viewport-high shell (dynamic viewport, safe areas, above
 * the on-screen keyboard), a slim top bar, the stage area — the only part that scrolls —
 * and the dock that holds the talk button.
 */
export function StageFrame({
  stage,
  tone,
  demo,
  progress,
  showNavigation,
  navigationDisabled = false,
  onRestart,
  announcement,
  mainRef,
  children,
  dock,
}: StageFrameProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  useKeyboardInset(shellRef);

  return (
    <div ref={shellRef} className={cn(styles.shell, tone === "accent" && "on-navy")} data-testid="voice-shell" data-stage={stage} data-tone={tone}>
      <header className={cn(styles.header, "on-navy bg-primary text-primary-foreground")}>
        <div className={cn(styles.safeX, "flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 py-1 @max-sm/voice:gap-x-2")}>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-lg",
                "bg-primary-foreground text-primary",
              )}
            >
              <TrainFrontIcon className="size-4" />
            </span>
            {/* The logo alone on the narrowest screens; the name stays for assistive technology. */}
            <span className={cn(DISPLAY, "text-lg @max-[22.5rem]/voice:sr-only")}>
              {frVoice.chrome.brand}
            </span>
          </div>
          <Trame className="w-20 @max-2xl/voice:hidden" />
          {progress}
          <div className="ml-auto flex items-center gap-1">
            {demo ? (
              // Invariant: scripted replies are labelled on every screen of the demo.
              <span
                className="inline-flex items-center gap-1 rounded-full bg-highlight px-2 py-0.5 text-xs font-bold whitespace-nowrap text-highlight-foreground"
                title={frVoice.chrome.demoDescription}
                data-testid="demo-badge"
              >
                <SparklesIcon className="size-3" aria-hidden="true" />
                <span className="@max-md/voice:hidden">{frVoice.chrome.demo}</span>
                <span className="@md/voice:hidden">{frVoice.chrome.demoShort}</span>
              </span>
            ) : null}
            {showNavigation ? (
              <>
                <Link href="/" aria-label={frVoice.chrome.classicLinkLabel} className={cn(NAV_BUTTON, TOUCH_TARGET)} data-testid="classic-link">
                  <MessagesSquareIcon className="size-4" aria-hidden="true" />
                  <span className="@max-2xl/voice:sr-only">{frVoice.chrome.classicLink}</span>
                  {/* A visible short label on phones: the icon alone was not recognised as a switch. */}
                  <span aria-hidden="true" className="@max-[22.5rem]/voice:hidden @2xl/voice:hidden">
                    {frVoice.chrome.classicLinkShort}
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={onRestart}
                  disabled={navigationDisabled}
                  aria-label={frVoice.chrome.restartLabel}
                  className={cn(NAV_BUTTON, TOUCH_TARGET)}
                  data-testid="restart-button"
                >
                  <RotateCcwIcon className="size-4" aria-hidden="true" />
                  <span className="@max-3xl/voice:sr-only">{frVoice.chrome.restart}</span>
                </button>
              </>
            ) : null}
          </div>
        </div>
      </header>

      {demo ? (
        <p className="sr-only" role="note">
          {frVoice.chrome.demoDescription}
        </p>
      ) : null}
      {/* Stage changes are announced; the heading of the new stage also receives focus. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="stage-announcer">
        {announcement}
      </div>

      <div className={styles.body}>
        <main ref={mainRef} className={styles.main} aria-label={frVoice.chrome.stageRegion}>
          {children}
        </main>
        {dock}
      </div>
    </div>
  );
}
