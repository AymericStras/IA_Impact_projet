"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, CircleDashedIcon, MessageCircleQuestionIcon, PencilIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { frVoice } from "@/i18n/fr.voice";
import { DISPLAY, EYEBROW, TOUCH_TARGET, WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { ConversationResponse } from "@/types/contracts";
import { FieldEditor, type EditHandler } from "./FieldEditor";
import { fieldLabel, fieldValue, participantsDetail, rowStatus, type RowStatus, type SheetField } from "./fieldDisplay";

interface SheetRowProps {
  field: SheetField;
  /** Latest server state: the row renders it and decides nothing. */
  conversation: ConversationResponse;
  /** The server's question, when this is the row it concerns. */
  question?: string | null;
  disabled?: boolean;
  onEdit: EditHandler;
}

const STATUS_LABEL: Record<RowStatus, string> = {
  known: frVoice.sheet.known,
  missing: frVoice.sheet.missing,
  clarify: frVoice.sheet.clarify,
};

function StatusIcon({ status }: { status: RowStatus }) {
  if (status === "known") {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground" aria-hidden="true">
        <CheckIcon className="size-4" strokeWidth={3} />
      </span>
    );
  }
  if (status === "clarify") return <TriangleAlertIcon className="size-6 shrink-0 text-warning" aria-hidden="true" />;
  return <CircleDashedIcon className="size-6 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

/**
 * One field of the trip sheet: state (icon + words), the value in words, the server's
 * question when it concerns this field, and tap-to-edit with the typed editor.
 */
export function SheetRow({ field, conversation, question = null, disabled = false, onEdit }: SheetRowProps) {
  const [editing, setEditing] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const itemRef = useRef<HTMLLIElement>(null);
  const wasEditing = useRef(false);

  const label = fieldLabel(field);
  const status = rowStatus(field, conversation);
  const value = fieldValue(field, conversation.requirements);
  const detail = field === "participants_count" ? participantsDetail(conversation.requirements) : null;
  const asked = question !== null;

  useEffect(() => {
    if (editing) itemRef.current?.scrollIntoView({ block: "nearest" });
    // Closing the editor returns focus to the control that opened it.
    else if (wasEditing.current) editButtonRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  return (
    <li
      ref={itemRef}
      className={cn(
        "@container/row rounded-2xl border bg-card p-4 text-card-foreground shadow-card transition-colors",
        asked && "border-primary bg-accent/40",
        status === "clarify" && !asked && "border-warning/60",
        editing && "border-ring",
      )}
      data-testid={`sheet-row-${field}`}
      data-state={status}
      data-asked={asked}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5">
          <StatusIcon status={status} />
        </span>
        <div className={cn("flex-1", WRAP_ANYWHERE)}>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className={EYEBROW}>{label}</h2>
            <span
              className={cn("text-xs font-medium", status === "known" ? "text-success" : status === "clarify" ? "text-foreground" : "text-muted-foreground")}
              data-testid={`sheet-row-${field}-status`}
            >
              {STATUS_LABEL[status]}
            </span>
          </div>
          {!editing ? (
            <>
              {/* Server text and teacher text: plain text nodes only. */}
              <p
                className={cn(DISPLAY, "mt-0.5 text-xl leading-snug text-foreground", !value && "rounded-xl bg-highlight px-3 py-2 text-highlight-foreground")}
                data-testid={`sheet-row-${field}-value`}
              >
                {value ?? frVoice.sheet.missing}
              </p>
              {detail ? <p className="text-sm text-muted-foreground">{detail}</p> : null}
            </>
          ) : null}
        </div>
        {!editing ? (
          <Button
            ref={editButtonRef}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
            disabled={disabled}
            aria-label={frVoice.sheet.editLabel(label)}
            className={cn("-mr-2 -mt-1 shrink-0 text-primary", TOUCH_TARGET)}
          >
            <PencilIcon aria-hidden="true" />
            <span className="@max-[16rem]/row:sr-only">{frVoice.sheet.edit}</span>
          </Button>
        ) : null}
      </div>

      {asked ? (
        <p
          className={cn("mt-3 flex items-start gap-2 text-base leading-snug text-foreground whitespace-pre-wrap", WRAP_ANYWHERE)}
          data-testid={`sheet-row-${field}-question`}
        >
          <MessageCircleQuestionIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
          <span>
            <span className="sr-only">{frVoice.sheet.question} : </span>
            {question}
          </span>
        </p>
      ) : null}

      {editing ? (
        <FieldEditor field={field} requirements={conversation.requirements} onEdit={onEdit} onClose={() => setEditing(false)} />
      ) : null}
    </li>
  );
}
