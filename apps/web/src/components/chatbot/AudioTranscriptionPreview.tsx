"use client";

import { useEffect, useRef, useState } from "react";
import { MicIcon, SendHorizontalIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fr } from "@/i18n/fr";
import { TOUCH_TARGET, isSubmitEnter } from "@/lib/ui";

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
      className="flex flex-col gap-2 rounded-xl border bg-card p-3"
      aria-labelledby="transcription-title"
      data-testid="transcription-preview"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) onSend(trimmed);
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p id="transcription-title" className="text-sm font-medium">
            {fr.transcription.title}
          </p>
          <p className="text-xs text-muted-foreground">{fr.transcription.hint}</p>
        </div>
        <Button type="button" size="icon-sm" variant="ghost" onClick={onCancel} aria-label={fr.transcription.cancel} className={TOUCH_TARGET}>
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
        className="min-h-20 bg-background"
        onKeyDown={(event) => {
          if (isSubmitEnter(event)) {
            event.preventDefault();
            if (trimmed) onSend(trimmed);
          }
        }}
      />
      {demoNotice ? <p className="text-xs text-muted-foreground">{fr.transcription.demoNotice}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onReRecord} disabled={disabled} className={TOUCH_TARGET}>
          <MicIcon aria-hidden="true" />
          {fr.transcription.reRecord}
        </Button>
        <Button type="submit" size="sm" disabled={disabled || !trimmed} className={TOUCH_TARGET}>
          <SendHorizontalIcon aria-hidden="true" />
          {fr.transcription.send}
        </Button>
      </div>
    </form>
  );
}
