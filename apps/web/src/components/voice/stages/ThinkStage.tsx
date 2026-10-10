"use client";

import { CheckIcon, CircleAlertIcon, CircleIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ThinkState, ThinkStep } from "@/hooks/useVoiceFlow";
import { frVoice } from "@/i18n/fr.voice";
import { FLUID_BUTTON, TOUCH_TARGET, WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { StageHeading } from "../StageFrame";
import styles from "../voice.module.css";

interface ThinkStageProps {
  think: ThinkState;
  focusHeading: boolean;
  /** Demo mode: the transcript is scripted and must say so. */
  demo: boolean;
  onRetry: () => void;
  onAbandon: () => void;
  onRestart: () => void;
}

type StepState = "done" | "active" | "waiting" | "failed";

const STEP_STATE_LABEL: Record<StepState, string> = {
  done: frVoice.think.stepDone,
  active: frVoice.think.stepActive,
  waiting: frVoice.think.stepWaiting,
  failed: frVoice.think.stepFailed,
};

function stepState(step: ThinkStep, think: ThinkState): StepState {
  if (think.failure?.step === step) return "failed";
  if (think.step === step) return "active";
  // Transcription comes first: once understanding runs, it is done.
  return step === "transcribing" ? "done" : "waiting";
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span className="flex size-6 items-center justify-center rounded-full bg-success text-success-foreground">
        <CheckIcon className="size-4" strokeWidth={3} aria-hidden="true" />
      </span>
    );
  }
  if (state === "active") return <Loader2Icon className="size-6 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />;
  if (state === "failed") return <CircleAlertIcon className="size-6 text-destructive" aria-hidden="true" />;
  return <CircleIcon className="size-6 text-input" aria-hidden="true" />;
}

/**
 * Stage 3 — real progress: the two requests of the pipeline (audio → transcript, then
 * transcript → extraction), each with its actual state in words. The transcript is shown
 * as soon as it exists. A provider failure is retried from here with the same request.
 */
export function ThinkStage({ think, focusHeading, demo, onRetry, onAbandon, onRestart }: ThinkStageProps) {
  // A typed answer has nothing to transcribe: only the understanding step is real.
  const steps: ThinkStep[] = think.source === "audio" ? ["transcribing", "understanding"] : ["understanding"];
  const failure = think.failure;

  return (
    <div className={cn(styles.stage, styles.safeX, "max-w-2xl justify-center gap-5 py-6")} data-testid="stage-think">
      <StageHeading focusOnEnter={focusHeading} className="text-[clamp(1.5rem,6cqi,2.5rem)] font-semibold leading-tight tracking-tight text-foreground">
        {frVoice.think.heading}
      </StageHeading>

      <ol className="grid gap-3" aria-label={frVoice.think.stepsLabel}>
        {steps.map((step) => {
          const state = stepState(step, think);
          return (
            <li
              key={step}
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-lg [overflow-wrap:anywhere]"
              data-testid={`think-step-${step}`}
              data-state={state}
              aria-current={state === "active" ? "step" : undefined}
            >
              <StepIcon state={state} />
              <span className={cn("font-medium", state === "waiting" ? "text-muted-foreground" : "text-foreground")}>
                {step === "transcribing" ? frVoice.think.transcribing : frVoice.think.understanding}
              </span>
              <span className="text-sm text-muted-foreground">{STEP_STATE_LABEL[state]}</span>
            </li>
          );
        })}
      </ol>

      {think.transcript ? (
        <section className="rounded-2xl border bg-card p-4" aria-labelledby="think-transcript-title" data-testid="think-transcript">
          <h2 id="think-transcript-title" className="text-sm font-medium text-muted-foreground">
            {think.source === "audio" ? frVoice.think.youSaid : frVoice.think.youWrote}
          </h2>
          {/* Teacher / transcription text: a plain text node, never HTML. */}
          <p className={cn("mt-1 whitespace-pre-wrap text-lg leading-relaxed text-foreground", WRAP_ANYWHERE)}>{think.transcript}</p>
          {demo && think.source === "audio" ? <p className="mt-2 text-xs text-muted-foreground">{frVoice.transcript.demoNotice}</p> : null}
        </section>
      ) : null}

      {failure ? (
        <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4" data-testid="think-failure">
          <p className="font-medium text-destructive">{frVoice.think.errorTitle}</p>
          <p className={cn("mt-1 whitespace-pre-wrap text-base text-foreground", WRAP_ANYWHERE)}>{failure.detail}</p>
          {failure.recovery === "retry" ? <p className="mt-1 text-sm text-foreground">{frVoice.think.retryNote}</p> : null}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onAbandon} className={cn(FLUID_BUTTON, TOUCH_TARGET)}>
              {frVoice.think.abandon}
            </Button>
            {failure.recovery === "retry" ? (
              <Button type="button" onClick={onRetry} className={cn(FLUID_BUTTON, TOUCH_TARGET)} data-testid="think-retry">
                {frVoice.think.retry}
              </Button>
            ) : null}
            {failure.recovery === "restart" ? (
              <Button type="button" onClick={onRestart} className={cn(FLUID_BUTTON, TOUCH_TARGET)}>
                {frVoice.problem.restart}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
