"use client";

import type { LastInput } from "@/hooks/useVoiceFlow";
import { frVoice } from "@/i18n/fr.voice";
import { WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { ConversationResponse } from "@/types/contracts";
import type { EditHandler } from "../FieldEditor";
import { SheetRow } from "../SheetRow";
import { StageHeading } from "../StageFrame";
import { TranscriptNote } from "../TranscriptNote";
import { SHEET_FIELDS, askedField, assistantText } from "../fieldDisplay";
import styles from "../voice.module.css";

interface SheetStageProps {
  conversation: ConversationResponse;
  focusHeading: boolean;
  lastInput: LastInput | null;
  maxLength: number;
  /** A request is in flight: editing and re-sending wait for it. */
  disabled: boolean;
  demo: boolean;
  onEdit: EditHandler;
  onResend: (text: string) => void;
}

/**
 * Stage 4 — the whole screen is the trip sheet. Pure function of the server state: which
 * rows are known, which one carries the question, what the assistant says. The actions
 * (talk, confirm) live in the dock, outside the scrolling area, so they stay reachable.
 */
export function SheetStage({ conversation, focusHeading, lastInput, maxLength, disabled, demo, onEdit, onResend }: SheetStageProps) {
  const message = assistantText(conversation);
  const asked = askedField(conversation);
  // A question belongs on its row; a summary or an acknowledgement is shown above the rows.
  const messageOnRow = message !== null && asked !== null && (SHEET_FIELDS as readonly string[]).includes(asked);

  return (
    <div className={cn(styles.stage, styles.safeX, "@container/sheet max-w-4xl gap-4 py-5")} data-testid="stage-sheet">
      <StageHeading focusOnEnter={focusHeading} className="text-2xl font-semibold leading-tight tracking-tight text-foreground">
        {frVoice.sheet.heading}
      </StageHeading>

      {message && !messageOnRow ? (
        <p className={cn("whitespace-pre-wrap text-base leading-relaxed text-foreground", WRAP_ANYWHERE)} data-testid="sheet-message">
          <span className="sr-only">{frVoice.sheet.assistant} : </span>
          {message}
        </p>
      ) : null}

      <ul className="grid items-start gap-3 @xl/sheet:grid-cols-2" aria-label={frVoice.sheet.listLabel} data-testid="sheet-rows">
        {SHEET_FIELDS.map((field) => (
          <SheetRow
            key={field}
            field={field}
            conversation={conversation}
            question={messageOnRow && asked === field ? message : null}
            disabled={disabled}
            onEdit={onEdit}
          />
        ))}
      </ul>

      <TranscriptNote lastInput={lastInput} maxLength={maxLength} disabled={disabled} demo={demo} onResend={onResend} />
    </div>
  );
}
