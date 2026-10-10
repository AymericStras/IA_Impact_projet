"use client";

import { useEffect, useRef, useState } from "react";
import { MicIcon, SendHorizontalIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fr } from "@/i18n/fr";
import { FLUID_BUTTON_SM, TOUCH_TARGET, isSubmitEnter } from "@/lib/ui";
import { cn } from "@/lib/utils";

interface AudioTranscriptionPreviewProps {
  transcript: string;
  onSend: (text: string) => void;
  onReRecord: () => void;
  onCancel: () => void;
  disabled?: boolean;
  /** Shows the "simulated transcription" notice in demo mode. */
  demoNotice?: boolean;
  /** Server limit on message length (`GET /config`). */
  maxLength?: number;
}

/** Editable transcript before sending: the corrected text goes through the same channel as typed text. */
export function AudioTranscriptionPreview({
  transcript,
  onSend,
  onReRecord,
  onCancel,
  disabled = false,
  demoNotice = false,
  maxLength,
}: AudioTranscriptionPreviewProps) {
  const [text, setText] = useState(transcript);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(transcript);
    textareaRef.current?.focus();
  }, [transcript]);

  const trimmed = text.trim();

  return (
    <form
      className="flex flex-col rounded-[1.5rem] border-2 border-primary bg-card tall:gap-2.5 tall:p-3.5 short:gap-1 short:px-2.5 short:py-1"
      aria-labelledby="transcription-title"
      data-testid="transcription-preview"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) onSend(trimmed);
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <p id="transcription-title" className="px-1 text-[0.9375rem] font-bold">
            {fr.transcription.title}
          </p>
          <p className="px-1 text-[0.8125rem] text-muted-foreground short:hidden">{fr.transcription.hint}</p>
        </div>
        <Button type="button" size="icon-sm" variant="ghost" onClick={onCancel} aria-label={fr.transcription.cancel} className={cn("shrink-0", TOUCH_TARGET)}>
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      <label htmlFor="transcription-text" className="sr-only">
        {fr.transcription.label}
      </label>
      <Textarea
        id="transcription-text"
        ref={textareaRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={disabled}
        rows={3}
        maxLength={maxLength}
        // The field grows with its text (field-sizing): capped so that a long dictation
        // scrolls inside it instead of pushing the buttons out of the viewport.
        className="rounded-2xl tall:max-h-28 tall:min-h-20 short:max-h-16 short:min-h-11"
        onKeyDown={(event) => {
          if (isSubmitEnter(event)) {
            event.preventDefault();
            if (trimmed) onSend(trimmed);
          }
        }}
      />
      {demoNotice ? <p className="px-1 text-xs font-medium text-muted-foreground">{fr.transcription.demoNotice}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onReRecord} disabled={disabled} className={cn(FLUID_BUTTON_SM, TOUCH_TARGET)}>
          <MicIcon aria-hidden="true" />
          {fr.transcription.reRecord}
        </Button>
        <Button type="submit" size="sm" disabled={disabled || !trimmed} className={cn(FLUID_BUTTON_SM, TOUCH_TARGET)}>
          <SendHorizontalIcon aria-hidden="true" />
          {fr.transcription.send}
        </Button>
      </div>
    </form>
  );
}
