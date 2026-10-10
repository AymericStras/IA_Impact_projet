"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fr } from "@/i18n/fr";
import { frVoice } from "@/i18n/fr.voice";
import { FLUID_BUTTON, TOUCH_TARGET } from "@/lib/ui";
import { cn } from "@/lib/utils";
import {
  TIME_CONSTRAINTS,
  type FieldName,
  type PartialRequirements,
  type RequirementValue,
  type TimeConstraint,
} from "@/types/contracts";
import { fieldLabel, type SheetField } from "./fieldDisplay";

export type EditHandler = <F extends FieldName>(field: F, value: RequirementValue<F>) => Promise<boolean>;

interface FieldEditorProps {
  field: SheetField;
  /** Server state the drafts are pre-filled from. */
  requirements: PartialRequirements;
  onEdit: EditHandler;
  onClose: () => void;
}

/** Longest station name accepted by the contract. */
export const STATION_MAX_LENGTH = 80;

// 44 px high and 16 px text at every size: comfortable to touch, never zoomed by iOS.
const CONTROL =
  "h-11 w-full min-w-0 rounded-full border-2 border-input bg-card px-3 text-base text-foreground placeholder:text-muted-foreground disabled:opacity-50";
const LABEL = "text-sm font-medium text-foreground";

/**
 * Typed editor of one field. Same inputs, labels and value shapes as the classic panel
 * (`RequirementField`, whose editors are not exported): number · single-line station ·
 * date + time + constraint · subject + theme. Completeness of the form is the only check;
 * validation and its messages are the server's. On failure the editor stays open with the
 * teacher's values.
 */
export function FieldEditor({ field, requirements, onEdit, onClose }: FieldEditorProps) {
  const baseId = useId();
  const firstRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);

  const dateTime = field === "departure" ? requirements.departure : field === "return" ? requirements.return : null;
  const [count, setCount] = useState(requirements.participants_count?.toString() ?? "");
  const [station, setStation] = useState(requirements.departure_station ?? "");
  const [date, setDate] = useState(dateTime?.date ?? "");
  const [time, setTime] = useState(dateTime?.time ?? "");
  const [constraint, setConstraint] = useState<TimeConstraint>(dateTime?.constraint ?? "exact");
  const [subject, setSubject] = useState(requirements.teaching_type?.subject ?? "");
  const [theme, setTheme] = useState(requirements.teaching_type?.theme ?? "");

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const canSave = (() => {
    switch (field) {
      case "participants_count":
        return count.trim() !== "";
      case "departure_station":
        return station.trim() !== "";
      case "departure":
      case "return":
        return date !== "" && time !== "";
      case "teaching_type":
        return subject.trim() !== "" || theme.trim() !== "";
    }
  })();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave || saving) return;
    setSaving(true);
    let ok = false;
    try {
      switch (field) {
        case "participants_count":
          ok = await onEdit("participants_count", Number(count));
          break;
        case "departure_station":
          ok = await onEdit("departure_station", station.trim());
          break;
        case "departure":
        case "return":
          ok = await onEdit(field, { date, time, constraint });
          break;
        case "teaching_type":
          ok = await onEdit("teaching_type", { subject: subject.trim() || null, theme: theme.trim() || null });
          break;
      }
    } finally {
      setSaving(false);
    }
    if (ok) onClose();
  };

  return (
    <form
      className="mt-3 grid gap-3"
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !saving) {
          // Escape closes this editor only (it also cancels a recording elsewhere).
          event.stopPropagation();
          onClose();
        }
      }}
      aria-label={frVoice.sheet.editLabel(fieldLabel(field))}
      data-testid={`sheet-editor-${field}`}
    >
      {field === "participants_count" ? (
        <div className="grid gap-1.5">
          <label htmlFor={`${baseId}-count`} className={LABEL}>
            {fr.fields.participants_count.inputLabel}
          </label>
          <input
            id={`${baseId}-count`}
            ref={firstRef}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            required
            value={count}
            onChange={(event) => setCount(event.target.value)}
            disabled={saving}
            className={CONTROL}
          />
        </div>
      ) : null}

      {field === "departure_station" ? (
        <div className="grid gap-1.5">
          <label htmlFor={`${baseId}-station`} className={LABEL}>
            {frVoice.fields.departure_station.inputLabel}
          </label>
          <input
            id={`${baseId}-station`}
            ref={firstRef}
            type="text"
            required
            maxLength={STATION_MAX_LENGTH}
            autoComplete="off"
            enterKeyHint="done"
            value={station}
            placeholder={frVoice.fields.departure_station.placeholder}
            onChange={(event) => setStation(event.target.value)}
            disabled={saving}
            className={CONTROL}
          />
        </div>
      ) : null}

      {field === "departure" || field === "return" ? (
        <div className="grid gap-3 @sm/row:grid-cols-2">
          <div className="grid gap-1.5">
            <label htmlFor={`${baseId}-date`} className={LABEL}>
              {fr.fields[field].dateLabel}
            </label>
            <input
              id={`${baseId}-date`}
              ref={firstRef}
              type="date"
              required
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={saving}
              className={CONTROL}
            />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={`${baseId}-time`} className={LABEL}>
              {fr.fields[field].timeLabel}
            </label>
            <input
              id={`${baseId}-time`}
              type="time"
              required
              value={time}
              onChange={(event) => setTime(event.target.value)}
              disabled={saving}
              className={CONTROL}
            />
          </div>
          <div className="grid gap-1.5 @sm/row:col-span-2">
            <label htmlFor={`${baseId}-constraint`} className={LABEL}>
              {fr.fields[field].constraintLabel}
            </label>
            <select
              id={`${baseId}-constraint`}
              value={constraint}
              onChange={(event) => setConstraint(event.target.value as TimeConstraint)}
              disabled={saving}
              className={CONTROL}
            >
              {TIME_CONSTRAINTS.map((option) => (
                <option key={option} value={option}>
                  {fr.constraints[option]}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {field === "teaching_type" ? (
        <div className="grid gap-3 @sm/row:grid-cols-2">
          <div className="grid gap-1.5">
            <label htmlFor={`${baseId}-subject`} className={LABEL}>
              {fr.fields.teaching_type.subjectLabel}
            </label>
            <input
              id={`${baseId}-subject`}
              ref={firstRef}
              type="text"
              value={subject}
              placeholder={fr.fields.teaching_type.subjectPlaceholder}
              onChange={(event) => setSubject(event.target.value)}
              disabled={saving}
              className={CONTROL}
            />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={`${baseId}-theme`} className={LABEL}>
              {fr.fields.teaching_type.themeLabel}
            </label>
            <input
              id={`${baseId}-theme`}
              type="text"
              value={theme}
              placeholder={fr.fields.teaching_type.themePlaceholder}
              onChange={(event) => setTheme(event.target.value)}
              disabled={saving}
              className={CONTROL}
            />
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving} className={cn(FLUID_BUTTON, TOUCH_TARGET)}>
          {frVoice.sheet.cancel}
        </Button>
        <Button type="submit" disabled={!canSave || saving} className={cn(FLUID_BUTTON, TOUCH_TARGET)}>
          {saving ? <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
          {saving ? frVoice.sheet.saving : frVoice.sheet.save}
        </Button>
      </div>
    </form>
  );
}
