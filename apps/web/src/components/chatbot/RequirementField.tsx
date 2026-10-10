"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckIcon, CircleDashedIcon, Loader2Icon, PencilIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fr } from "@/i18n/fr";
import { formatPartialDateTime } from "@/lib/format";
import { TOUCH_TARGET } from "@/lib/ui";
import { cn } from "@/lib/utils";
import {
  TIME_CONSTRAINTS,
  type FieldName,
  type PartialRequirements,
  type RequirementValue,
  type TimeConstraint,
} from "@/types/contracts";

export type EditHandler = <F extends FieldName>(field: F, value: RequirementValue<F>) => Promise<boolean>;

interface RequirementFieldProps {
  field: FieldName;
  requirements: PartialRequirements;
  /** Whether the field is in `missing_fields` (decided by the server). */
  missing: boolean;
  /** A server clarification targets this field. */
  clarificationPending?: boolean;
  disabled?: boolean;
  /** Briefly shows "Mis à jour" after the value changed. */
  recentlyUpdated?: boolean;
  onEdit: EditHandler;
}

const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm max-lg:h-11 max-lg:text-base focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

/** Readable value of a field: renders server state, no inference. */
function displayValue(field: FieldName, requirements: PartialRequirements): string {
  switch (field) {
    case "participants_count": {
      const count = requirements.participants_count;
      const breakdown = requirements.participants_breakdown ?? null;
      if (count !== null) return fr.fields.participants_count.unit(count);
      if (breakdown?.students != null) return fr.fields.participants_count.studentsOnly(breakdown.students);
      return fr.panel.missing;
    }
    case "departure":
      return formatPartialDateTime(requirements.departure);
    case "return":
      return formatPartialDateTime(requirements.return);
    case "teaching_type": {
      const tt = requirements.teaching_type;
      if (!tt || (!tt.subject && !tt.theme)) return fr.panel.missing;
      return [tt.subject, tt.theme].filter(Boolean).join(" — ");
    }
  }
}

/**
 * Detail line under the total ("27 élèves et 3 accompagnateurs"). Display guard only:
 * the line is shown when the server's breakdown is complete and adds up to the server's
 * total, so a stale breakdown is never displayed next to a different total.
 */
function breakdownText(requirements: PartialRequirements): string | null {
  const breakdown = requirements.participants_breakdown ?? null;
  const count = requirements.participants_count;
  if (!breakdown || count === null) return null;
  if (breakdown.students === null || breakdown.accompanying === null) return null;
  if (breakdown.students + breakdown.accompanying !== count) return null;
  return fr.fields.participants_count.breakdown(breakdown.students, breakdown.accompanying);
}

export function RequirementField({
  field,
  requirements,
  missing,
  clarificationPending = false,
  disabled = false,
  recentlyUpdated = false,
  onEdit,
}: RequirementFieldProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const reduceMotion = useReducedMotion();
  const baseId = useId();
  const firstInputRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const itemRef = useRef<HTMLLIElement>(null);

  const labels = fr.fields[field];
  const value = displayValue(field, requirements);
  const known = !missing;

  // Editor drafts, pre-filled from server state.
  const [count, setCount] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [constraint, setConstraint] = useState<TimeConstraint>("exact");
  const [subject, setSubject] = useState("");
  const [theme, setTheme] = useState("");

  const openEditor = () => {
    setCount(requirements.participants_count?.toString() ?? "");
    const dt = field === "departure" ? requirements.departure : field === "return" ? requirements.return : null;
    setDate(dt?.date ?? "");
    setTime(dt?.time ?? "");
    setConstraint(dt?.constraint ?? "exact");
    setSubject(requirements.teaching_type?.subject ?? "");
    setTheme(requirements.teaching_type?.theme ?? "");
    setEditing(true);
  };

  useEffect(() => {
    if (!editing) return;
    firstInputRef.current?.focus();
    // On mobile the panel body scrolls: bring the whole editor (and its buttons) into view.
    itemRef.current?.scrollIntoView({ block: "nearest" });
  }, [editing]);

  const close = () => {
    setEditing(false);
    requestAnimationFrame(() => editButtonRef.current?.focus());
  };

  const canSave = (() => {
    if (field === "participants_count") return count.trim() !== "";
    if (field === "departure" || field === "return") return date !== "" && time !== "";
    return subject.trim() !== "" || theme.trim() !== "";
  })();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave || saving) return;
    setSaving(true);
    let ok = false;
    try {
      if (field === "participants_count") {
        ok = await onEdit("participants_count", Number(count));
      } else if (field === "departure" || field === "return") {
        ok = await onEdit(field, { date, time, constraint });
      } else {
        ok = await onEdit("teaching_type", { subject: subject.trim() || null, theme: theme.trim() || null });
      }
    } finally {
      setSaving(false);
    }
    if (ok) close();
  };

  return (
    <li
      ref={itemRef}
      className={cn(
        "rounded-xl border bg-card p-3 transition-colors",
        clarificationPending && "border-warning/60",
        editing && "border-ring",
      )}
      data-testid={`field-${field}`}
      data-state={known ? "known" : "missing"}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
            known ? "bg-success text-success-foreground" : "text-muted-foreground",
          )}
        >
          {known ? <CheckIcon className="size-3.5" strokeWidth={3} /> : <CircleDashedIcon className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">{labels.label}</h3>
            <span className="sr-only">{known ? fr.panel.known : fr.panel.missing}</span>
            <AnimatePresence>
              {recentlyUpdated ? (
                <motion.span
                  key="updated"
                  initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.2 }}
                  className="inline-flex items-center gap-1 rounded-full bg-success-soft px-1.5 py-0.5 text-[0.65rem] font-medium text-success"
                >
                  <CheckIcon className="size-3" aria-hidden="true" />
                  {fr.panel.updated}
                </motion.span>
              ) : null}
            </AnimatePresence>
          </div>
          {!editing ? (
            <>
              <p className={cn("mt-0.5 text-sm", known ? "text-foreground" : "italic text-muted-foreground")} data-testid={`field-${field}-value`}>
                {value}
              </p>
              {field === "participants_count" && breakdownText(requirements) ? (
                <p className="text-xs text-muted-foreground">{breakdownText(requirements)}</p>
              ) : null}
              {clarificationPending ? (
                <p className="mt-1 flex items-center gap-1 text-xs text-foreground" data-testid={`field-${field}-clarification`}>
                  <TriangleAlertIcon className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
                  {fr.panel.clarificationPending}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        {!editing ? (
          <Button
            ref={editButtonRef}
            type="button"
            variant="ghost"
            size="sm"
            onClick={openEditor}
            disabled={disabled}
            aria-label={fr.panel.editingLabel(labels.label)}
            data-edit-button=""
            className={cn("-mr-1 -mt-1 text-primary", TOUCH_TARGET)}
          >
            <PencilIcon aria-hidden="true" />
            {fr.panel.edit}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <form className="mt-3 grid gap-2.5" onSubmit={(event) => void submit(event)} aria-label={fr.panel.editingLabel(labels.label)}>
          {field === "participants_count" ? (
            <div className="grid gap-1.5">
              <Label htmlFor={`${baseId}-count`}>{fr.fields.participants_count.inputLabel}</Label>
              <Input
                id={`${baseId}-count`}
                ref={firstInputRef}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                required
                value={count}
                onChange={(event) => setCount(event.target.value)}
                disabled={saving}
                className="max-lg:h-11"
              />
            </div>
          ) : null}

          {field === "departure" || field === "return" ? (
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor={`${baseId}-date`}>{fr.fields[field].dateLabel}</Label>
                <Input
                  id={`${baseId}-date`}
                  ref={firstInputRef}
                  type="date"
                  required
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  disabled={saving}
                  className="max-lg:h-11"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${baseId}-time`}>{fr.fields[field].timeLabel}</Label>
                <Input
                  id={`${baseId}-time`}
                  type="time"
                  required
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  disabled={saving}
                  className="max-lg:h-11"
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor={`${baseId}-constraint`}>{fr.fields[field].constraintLabel}</Label>
                <select
                  id={`${baseId}-constraint`}
                  className={SELECT_CLASS}
                  value={constraint}
                  onChange={(event) => setConstraint(event.target.value as TimeConstraint)}
                  disabled={saving}
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
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor={`${baseId}-subject`}>{fr.fields.teaching_type.subjectLabel}</Label>
                <Input
                  id={`${baseId}-subject`}
                  ref={firstInputRef}
                  value={subject}
                  placeholder={fr.fields.teaching_type.subjectPlaceholder}
                  onChange={(event) => setSubject(event.target.value)}
                  disabled={saving}
                  className="max-lg:h-11"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${baseId}-theme`}>{fr.fields.teaching_type.themeLabel}</Label>
                <Input
                  id={`${baseId}-theme`}
                  value={theme}
                  placeholder={fr.fields.teaching_type.themePlaceholder}
                  onChange={(event) => setTheme(event.target.value)}
                  disabled={saving}
                  className="max-lg:h-11"
                />
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={close} disabled={saving} className={TOUCH_TARGET}>
              {fr.panel.cancel}
            </Button>
            <Button type="submit" size="sm" disabled={!canSave || saving} className={TOUCH_TARGET}>
              {saving ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              {saving ? fr.panel.saving : fr.panel.save}
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}
