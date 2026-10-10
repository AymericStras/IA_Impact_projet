"use client";

import { useState } from "react";
import { ChevronDownIcon, KeyboardIcon, PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LastInput } from "@/hooks/useVoiceFlow";
import { frVoice } from "@/i18n/fr.voice";
import { FLUID_BUTTON, TOUCH_TARGET, WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { TextEntry } from "./TextEntry";

interface TranscriptNoteProps {
  /** What the teacher last said or wrote; null before any input. */
  lastInput: LastInput | null;
  maxLength: number;
  disabled?: boolean;
  /** Demo mode: the transcription is scripted and must say so. */
  demo?: boolean;
  /** Sends the (corrected) text for extraction, as typed text. */
  onResend: (text: string) => void;
}

/**
 * « Vous avez dit »: the last transcript, with the escape hatch for recognition errors —
 * correct the text and send it again. Without any input yet it offers the text path
 * (« Écrire à la place »). The text is rendered as a plain text node, never as HTML.
 */
export function TranscriptNote({ lastInput, maxLength, disabled = false, demo = false, onResend }: TranscriptNoteProps) {
  const [editing, setEditing] = useState(false);
  const spoken = lastInput?.source === "audio";

  if (editing) {
    return (
      <section className="rounded-2xl border bg-card p-4" data-testid="transcript-note" aria-label={frVoice.transcript.title}>
        <TextEntry
          label={frVoice.transcript.label}
          initialText={lastInput?.text ?? ""}
          submitLabel={frVoice.transcript.resend}
          maxLength={maxLength}
          disabled={disabled}
          autoFocus
          onSubmit={(text) => {
            setEditing(false);
            onResend(text);
          }}
          onCancel={() => setEditing(false)}
          testId="transcript-editor"
        />
      </section>
    );
  }

  if (!lastInput) {
    return (
      <div className="flex justify-center" data-testid="transcript-note">
        <Button type="button" variant="outline" onClick={() => setEditing(true)} disabled={disabled} className={cn(FLUID_BUTTON, TOUCH_TARGET)}>
          <KeyboardIcon aria-hidden="true" />
          {frVoice.transcript.write}
        </Button>
      </div>
    );
  }

  return (
    // Native disclosure: collapsible without script, open by default so the teacher sees
    // what was heard.
    <details open className="group rounded-2xl border bg-muted/40" data-testid="transcript-note">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
        <ChevronDownIcon className="size-4 shrink-0 group-open:rotate-180" aria-hidden="true" />
        {spoken ? frVoice.transcript.title : frVoice.transcript.titleText}
      </summary>
      <div className="px-4 pb-4">
        <p className={cn("whitespace-pre-wrap text-base leading-relaxed text-foreground", WRAP_ANYWHERE)} data-testid="transcript-text">
          {lastInput.text}
        </p>
        {!lastInput.delivered ? <p className="mt-2 text-sm font-medium text-foreground">{frVoice.transcript.notSent}</p> : null}
        {demo && spoken ? <p className="mt-2 text-xs text-muted-foreground">{frVoice.transcript.demoNotice}</p> : null}
        <div className="mt-2 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
            disabled={disabled}
            className={cn(FLUID_BUTTON, TOUCH_TARGET)}
          >
            <PencilIcon aria-hidden="true" />
            {frVoice.transcript.correct}
          </Button>
        </div>
      </div>
    </details>
  );
}
