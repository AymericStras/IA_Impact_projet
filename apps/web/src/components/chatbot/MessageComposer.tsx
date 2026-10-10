"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MicIcon, SendHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNarrowerThan } from "@/hooks/useViewportTracking";
import { fr } from "@/i18n/fr";
import { DEFAULT_CLIENT_CONFIG, isDemoMode } from "@/lib/env";
import { TOUCH_TARGET, isSubmitEnter } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { VoiceRecorder, isRecordingSupported } from "./VoiceRecorder";

interface MessageComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** Sends a typed message (source "text"). */
  onSend: (content: string) => void;
  /** Sends a corrected transcript (source "audio"). */
  onSendTranscript: (content: string) => void;
  /** Uploads the audio to the server and returns the transcript. */
  onTranscribe: (audio: Blob) => Promise<string>;
  /** True while any request is in flight: typing and sending are blocked. */
  disabled?: boolean;
  /** True while a message is being sent: focus returns to the textarea afterwards. */
  sending?: boolean;
  /** Server limit on message length (`GET /config`). */
  maxLength?: number;
  /** Server limit on recording length (`GET /config`). */
  maxAudioSeconds?: number;
  className?: string;
}

/** The counter only appears once the text gets close to the limit. */
const COUNTER_THRESHOLD = 0.9;
/** Below this composer width (in rem) the long placeholder would wrap: use the short one. */
const SHORT_PLACEHOLDER_BELOW_REM = 20;

export function MessageComposer({
  value,
  onChange,
  onSend,
  onSendTranscript,
  onTranscribe,
  disabled = false,
  sending = false,
  maxLength = DEFAULT_CLIENT_CONFIG.max_message_chars,
  maxAudioSeconds = DEFAULT_CLIENT_CONFIG.max_audio_seconds,
  className,
}: MessageComposerProps) {
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [micSupported, setMicSupported] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const wasSendingRef = useRef(false);
  const cramped = useNarrowerThan(formRef, SHORT_PLACEHOLDER_BELOW_REM, [recorderOpen]);

  useEffect(() => {
    setMicSupported(isRecordingSupported() || isDemoMode);
  }, []);

  // Focus returns to the textarea once the send completes.
  useEffect(() => {
    if (wasSendingRef.current && !sending && !recorderOpen) {
      textareaRef.current?.focus();
    }
    wasSendingRef.current = sending;
  }, [sending, recorderOpen]);

  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !disabled;
  const showCounter = value.length >= Math.floor(maxLength * COUNTER_THRESHOLD);
  const atLimit = value.length >= maxLength;

  const submit = () => {
    if (!canSend) return;
    onSend(trimmed);
    onChange("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isSubmitEnter(event)) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className={cn("flex flex-col tall:gap-1.5", className)}>
      {recorderOpen ? (
        <VoiceRecorder
          onTranscribe={onTranscribe}
          onSend={onSendTranscript}
          onClose={() => {
            setRecorderOpen(false);
            // Let the browser render the textarea before focusing it.
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
          maxSeconds={maxAudioSeconds}
          maxLength={maxLength}
          demoMode={isDemoMode}
        />
      ) : (
        <form
          ref={formRef}
          // The field keeps a usable width: when it cannot (very large text), the buttons
          // wrap to their own row under it.
          className="flex flex-wrap items-end justify-end gap-2 rounded-2xl border border-input bg-card transition-shadow focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40 tall:p-2 short:p-1"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label htmlFor="composer-input" className="sr-only">
            {fr.composer.label}
          </label>
          <Textarea
            id="composer-input"
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={cramped ? fr.composer.placeholderShort : fr.composer.placeholder}
            aria-describedby="composer-hint"
            disabled={disabled}
            maxLength={maxLength}
            rows={1}
            // The surrounding form carries the focus ring for this field.
            data-focus-inside=""
            className="min-h-10 min-w-0 flex-[1_1_10rem] resize-none border-0 bg-transparent px-2 py-2 shadow-none placeholder:overflow-hidden placeholder:text-ellipsis placeholder:whitespace-nowrap focus-visible:border-transparent focus-visible:ring-0 pointer-coarse:min-h-[44px] pointer-coarse:py-2.5 tall:max-h-40 short:max-h-20"
          />
          <div className="flex shrink-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  aria-label={fr.composer.microphone}
                  data-testid="microphone-button"
                  disabled={disabled || !micSupported}
                  onClick={() => setRecorderOpen(true)}
                  className={TOUCH_TARGET}
                />
              }
            >
              <MicIcon aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>{micSupported ? fr.composer.microphone : fr.composer.microphoneUnsupported}</TooltipContent>
          </Tooltip>
          <Button
            type="submit"
            size="icon-lg"
            aria-label={fr.composer.send}
            disabled={!canSend}
            data-testid="send-button"
            className={TOUCH_TARGET}
          >
            <SendHorizontalIcon aria-hidden="true" />
          </Button>
          </div>
        </form>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-2 text-[0.7rem] text-muted-foreground">
        {/* A keyboard shortcut is only relevant with a physical keyboard, and only when there is room. */}
        <p id="composer-hint" className="hidden mouse:tall:block">
          {fr.composer.hint}
        </p>
        {showCounter && !recorderOpen ? (
          <p
            role="status"
            className={cn("ml-auto tabular-nums", atLimit && "font-medium text-foreground")}
            data-testid="composer-counter"
          >
            {atLimit ? fr.composer.limitReached(maxLength) : fr.composer.counter(value.length, maxLength)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
