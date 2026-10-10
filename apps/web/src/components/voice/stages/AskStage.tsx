"use client";

import { frVoice } from "@/i18n/fr.voice";
import { cn } from "@/lib/utils";
import { StageHeading } from "../StageFrame";
import { TextEntry } from "../TextEntry";
import styles from "../voice.module.css";

interface AskStageProps {
  /** The server's current message, verbatim; the fallback only before it exists. */
  question: string | null;
  focusHeading: boolean;
  /** The text field is shown (opened by the teacher, or no microphone can be used). */
  textOpen: boolean;
  /** The teacher opened it: focus goes into the field. */
  textAutoFocus: boolean;
  initialText: string;
  maxLength: number;
  disabled: boolean;
  onSubmitText: (text: string) => void;
  /** Absent when text is the only way in (no microphone). */
  onCloseText?: () => void;
}

/** Stage 1 — one question in large type, one line of example. */
export function AskStage({
  question,
  focusHeading,
  textOpen,
  textAutoFocus,
  initialText,
  maxLength,
  disabled,
  onSubmitText,
  onCloseText,
}: AskStageProps) {
  return (
    <div className={cn(styles.stage, styles.safeX, "max-w-3xl items-center justify-center gap-3 py-4 text-center @md/voice:gap-4 @md/voice:py-6")} data-testid="stage-ask">
      <p className="text-sm font-medium text-primary">{frVoice.ask.eyebrow}</p>
      <StageHeading
        focusOnEnter={focusHeading}
        className="text-balance whitespace-pre-wrap text-[clamp(1.375rem,min(5.2cqi,7.5cqb),2.5rem)] font-semibold leading-tight tracking-tight text-foreground"
      >
        {question ?? frVoice.ask.fallbackQuestion}
      </StageHeading>
      {textOpen ? (
        <div className="w-full max-w-xl">
          <TextEntry
            // A new initial text (an abandoned transcript) starts a fresh draft.
            key={initialText}
            label={frVoice.text.label}
            initialText={initialText}
            submitLabel={frVoice.text.send}
            maxLength={maxLength}
            disabled={disabled}
            autoFocus={textAutoFocus}
            onSubmit={onSubmitText}
            onCancel={onCloseText}
          />
        </div>
      ) : (
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere] @md/voice:text-base">{frVoice.ask.example}</p>
      )}
    </div>
  );
}
