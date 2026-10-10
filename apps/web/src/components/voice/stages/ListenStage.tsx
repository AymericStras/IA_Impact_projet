"use client";

import type { AudioCapture } from "@/hooks/useAudioCapture";
import type { HoldToTalk } from "@/hooks/useHoldToTalk";
import { frVoice } from "@/i18n/fr.voice";
import { formatElapsed } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StageHeading } from "../StageFrame";
import { VoiceShape } from "../VoiceShape";
import styles from "../voice.module.css";

interface ListenStageProps {
  capture: Pick<AudioCapture, "status" | "elapsedMs" | "synthetic" | "sample">;
  gesture: Pick<HoldToTalk, "willCancel" | "mode">;
  /** The server's `max_audio_seconds`: the recording stops by itself there. */
  maxSeconds: number;
  reducedMotion: boolean;
  /** Id given to the gesture hint, which describes the talk button. */
  hintId: string;
}

/** Seconds before the automatic stop from which the countdown is shown. */
export const COUNTDOWN_FROM_SECONDS = 10;
/** A hold this long earns the reminder that a short tap also works. */
const LONG_HOLD_SECONDS = 20;

/**
 * Stage 2 — the screen listens. Everything the motion says is also said in words: the
 * status line, the timer, the countdown and the gesture hint. Text never sits on the
 * shape, so its contrast is the plain accent pair (7.7:1).
 */
export function ListenStage({ capture, gesture, maxSeconds, reducedMotion, hintId }: ListenStageProps) {
  const requesting = capture.status !== "recording";
  const elapsedSeconds = Math.floor(capture.elapsedMs / 1_000);
  const remaining = Math.max(0, Math.ceil(maxSeconds - capture.elapsedMs / 1_000));
  const countingDown = !requesting && remaining <= COUNTDOWN_FROM_SECONDS;

  const status = gesture.willCancel
    ? frVoice.listen.cancelArmed
    : requesting
      ? frVoice.listen.requesting
      : frVoice.listen.recording;
  const hint = gesture.willCancel
    ? frVoice.talk.cancelHint
    : gesture.mode === "hold"
      ? frVoice.talk.holdHint
      : frVoice.talk.toggleHint;

  return (
    <div className={cn(styles.listen, styles.safeX, "py-4")} data-testid="stage-listen">
      <div className={styles.listenText}>
        <StageHeading focusOnEnter={false} className="text-[clamp(1.5rem,min(6cqi,9cqb),2.75rem)] font-semibold leading-tight tracking-tight">
          {frVoice.listen.heading}
        </StageHeading>
        <p className="text-base font-medium" role="status" data-testid="listen-status">
          {status}
        </p>
        <p
          className="font-mono text-2xl font-semibold tabular-nums"
          role="timer"
          aria-label={frVoice.listen.timerLabel}
          data-testid="voice-timer"
        >
          {formatElapsed(elapsedSeconds)}
        </p>
        {countingDown ? (
          <p className="text-base font-semibold" data-testid="listen-countdown">
            {frVoice.listen.countdown(remaining)}
          </p>
        ) : null}
        <p id={hintId} className="text-base" data-testid="listen-hint">
          {hint}
        </p>
        {gesture.mode === "hold" && elapsedSeconds >= LONG_HOLD_SECONDS ? <p className="text-sm">{frVoice.listen.longHoldTip}</p> : null}
        {capture.synthetic ? <p className="text-sm">{frVoice.listen.synthetic}</p> : null}
        {/* Sparse spoken milestones instead of a countdown read every second. */}
        <p className="sr-only" aria-live="assertive">
          {countingDown && (remaining === COUNTDOWN_FROM_SECONDS || remaining === 5) ? frVoice.listen.countdown(remaining) : ""}
        </p>
      </div>
      <div className={styles.listenVisual}>
        <VoiceShape sample={capture.sample} reducedMotion={reducedMotion} />
      </div>
    </div>
  );
}
