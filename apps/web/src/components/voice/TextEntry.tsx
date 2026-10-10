"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { frVoice } from "@/i18n/fr.voice";
import { FLUID_BUTTON, TOUCH_TARGET, isSubmitEnter } from "@/lib/ui";
import { cn } from "@/lib/utils";

interface TextEntryProps {
  label: string;
  initialText?: string;
  submitLabel: string;
  maxLength: number;
  disabled?: boolean;
  /** Moves focus into the field when it appears (opened by the user). */
  autoFocus?: boolean;
  onSubmit: (text: string) => void;
  onCancel?: () => void;
  testId?: string;
}

/**
 * The text path: one field, Enter sends, Shift+Enter breaks the line, an IME composition
 * is never submitted. 16 px text at any size so iOS does not zoom the page.
 */
export function TextEntry({
  label,
  initialText = "",
  submitLabel,
  maxLength,
  disabled = false,
  autoFocus = false,
  onSubmit,
  onCancel,
  testId = "text-entry",
}: TextEntryProps) {
  const [text, setText] = useState(initialText);
  const id = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) fieldRef.current?.focus();
  }, [autoFocus]);

  const canSend = text.trim() !== "" && !disabled;
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (canSend) onSubmit(text);
  };

  return (
    <form className="grid w-full gap-2 text-left" onSubmit={submit} data-testid={testId}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <textarea
        id={id}
        ref={fieldRef}
        value={text}
        rows={3}
        maxLength={maxLength}
        placeholder={frVoice.text.placeholder}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (isSubmitEnter(event)) submit(event);
        }}
        className="field-sizing-content max-h-[40vh] min-h-24 w-full resize-none rounded-xl border-2 border-input bg-card px-3 py-2.5 text-base leading-relaxed text-foreground placeholder:text-muted-foreground disabled:opacity-50"
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={disabled} className={cn(FLUID_BUTTON, TOUCH_TARGET)}>
            {frVoice.text.cancel}
          </Button>
        ) : null}
        <Button type="submit" disabled={!canSend} className={cn(FLUID_BUTTON, TOUCH_TARGET)} data-testid={`${testId}-send`}>
          <SendIcon aria-hidden="true" />
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
