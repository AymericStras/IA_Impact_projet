"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fr } from "@/i18n/fr";
import { TOUCH_TARGET } from "@/lib/ui";
import { cn } from "@/lib/utils";
import {
  FIELD_NAMES,
  type ConversationState,
  type FieldName,
  type PartialRequirements,
  type PendingClarification,
} from "@/types/contracts";
import { RequirementField, type EditHandler } from "./RequirementField";

interface RequirementsPanelProps {
  requirements: PartialRequirements;
  missingFields: FieldName[];
  pendingClarification?: PendingClarification | null;
  state: ConversationState;
  disabled?: boolean;
  onEdit: EditHandler;
  /** Id of the focusable container (target of the confirmation card's "Modifier" button). */
  id?: string;
  /**
   * Incremented by the parent to bring the user to the panel ("Modifier" on the
   * confirmation card): the panel expands on mobile and focuses its first edit button.
   */
  editRequest?: number;
  className?: string;
}

const UPDATE_TICK_MS = 2_200;

/**
 * "Votre projet": the four requirements, their status and inline editing.
 * Progress is read from `missing_fields`; nothing is recomputed client-side.
 */
export function RequirementsPanel({
  requirements,
  missingFields,
  pendingClarification = null,
  state,
  disabled = false,
  onEdit,
  id = "requirements-panel",
  editRequest = 0,
  className,
}: RequirementsPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [recentlyUpdated, setRecentlyUpdated] = useState<Set<FieldName>>(new Set());
  const previousRef = useRef<PartialRequirements | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const handledEditRequestRef = useRef(0);

  // Step 1: expand (the body is hidden on mobile while collapsed).
  useEffect(() => {
    if (editRequest > 0) setExpanded(true);
  }, [editRequest]);

  // Step 2: once the body is rendered, move focus to the first "Modifier" button.
  useEffect(() => {
    if (editRequest === 0 || handledEditRequestRef.current === editRequest) return;
    if (!expanded) return;
    handledEditRequestRef.current = editRequest;
    const target = sectionRef.current?.querySelector<HTMLElement>("[data-edit-button]") ?? sectionRef.current;
    target?.focus();
  }, [editRequest, expanded]);

  const total = FIELD_NAMES.length;
  const known = total - missingFields.filter((f) => FIELD_NAMES.includes(f)).length;
  const complete = missingFields.length === 0;

  // Detects fields whose server value changed to show a brief "Mis à jour" tick.
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = requirements;
    if (!previous) return;
    const changed = FIELD_NAMES.filter(
      (field) => JSON.stringify(previous[field]) !== JSON.stringify(requirements[field]),
    );
    if (changed.length === 0) return;
    setRecentlyUpdated(new Set(changed));
    const timer = setTimeout(() => setRecentlyUpdated(new Set()), UPDATE_TICK_MS);
    return () => clearTimeout(timer);
  }, [requirements]);

  return (
    <section
      ref={sectionRef}
      id={id}
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
      className={cn("rounded-2xl border bg-card/60", className)}
      data-testid="requirements-panel"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-title`} className="text-sm font-semibold">
            {fr.panel.title}
          </h2>
          <p className="text-xs text-muted-foreground" data-testid="panel-progress" aria-live="polite">
            {complete ? fr.panel.progressComplete : fr.panel.progress(known, total)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="hidden rounded-full bg-muted px-2 py-0.5 text-[0.7rem] font-medium text-muted-foreground lg:inline-flex"
            data-testid="panel-state"
          >
            {fr.states[state]}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn("lg:hidden", TOUCH_TARGET)}
            data-testid="panel-toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={`${id}-body`}
          >
            {expanded ? <ChevronUpIcon aria-hidden="true" /> : <ChevronDownIcon aria-hidden="true" />}
            {expanded ? fr.panel.toggleHide : fr.panel.toggleShow}
          </Button>
        </div>
      </div>
      <div id={`${id}-body`} className={cn(
          "thin-scrollbar px-4 pb-4 max-lg:max-h-[50dvh] max-lg:overflow-y-auto",
          expanded ? "block" : "hidden lg:block",
        )}>
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
            style={{ width: `${(known / total) * 100}%` }}
          />
        </div>
        <ul className="grid gap-2">
          {FIELD_NAMES.map((field) => (
            <RequirementField
              key={field}
              field={field}
              requirements={requirements}
              missing={missingFields.includes(field)}
              clarificationPending={pendingClarification?.field === field}
              disabled={disabled}
              recentlyUpdated={recentlyUpdated.has(field)}
              onEdit={onEdit}
            />
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">{fr.panel.subtitle}</p>
      </div>
    </section>
  );
}
