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
 * "Votre projet": the five requirements (canonical order of `FIELD_NAMES`), their status and inline editing.
 * Progress is read from `missing_fields`; nothing is recomputed client-side.
 *
 * Two presentations, chosen by the app-shell tiers (see globals.css):
 * - `wide`: a column next to the conversation, always expanded;
 * - `single`: a one- or two-line summary bar above the conversation. Expanding it opens
 *   the details as a layer OVER the conversation area (never taller than it, see
 *   `--thread-height`), so neither the conversation nor the composer is squeezed.
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
  const tickTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sectionRef = useRef<HTMLElement>(null);
  const handledEditRequestRef = useRef(0);

  // Step 1: expand (the body is hidden on single-column layouts while collapsed).
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
    // A response that changes no value (a confirmation right after an answer) must not
    // cancel the pending removal: the tick would stay for ever.
    if (changed.length === 0) return;
    setRecentlyUpdated(new Set(changed));
    clearTimeout(tickTimerRef.current);
    tickTimerRef.current = setTimeout(() => setRecentlyUpdated(new Set()), UPDATE_TICK_MS);
  }, [requirements]);
  useEffect(() => () => clearTimeout(tickTimerRef.current), []);

  return (
    <section
      ref={sectionRef}
      id={id}
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
      className={cn(
        "@container/panel relative rounded-2xl border wide:bg-card/60 single:bg-card",
        expanded && "single:rounded-b-none",
        className,
      )}
      data-testid="requirements-panel"
      data-expanded={expanded}
    >
      <div className="flex items-center gap-2 wide:px-4 wide:py-3 single:py-1 single:pr-1 single:pl-4">
        {/* Title and progress share a line when they fit, and wrap to two tight lines otherwise. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 leading-tight wide:flex-col wide:items-start wide:gap-y-0.5">
          <h2 id={`${id}-title`} className="text-sm font-semibold">
            {fr.panel.title}
          </h2>
          <p className="text-xs text-muted-foreground" data-testid="panel-progress" aria-live="polite">
            {complete ? fr.panel.progressComplete(total) : fr.panel.progress(known, total)}
          </p>
        </div>
        <span
          className="hidden shrink-0 rounded-full bg-muted px-2 py-0.5 text-[0.7rem] font-medium text-muted-foreground wide:@[19rem]/panel:inline-flex"
          data-testid="panel-state"
        >
          {fr.states[state]}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("shrink-0 wide:hidden", TOUCH_TARGET)}
          data-testid="panel-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={`${id}-body`}
        >
          {expanded ? <ChevronUpIcon aria-hidden="true" /> : <ChevronDownIcon aria-hidden="true" />}
          {/* Chevron only where space is tight; the label stays the accessible name. */}
          <span className="short:sr-only narrow:sr-only">{expanded ? fr.panel.toggleHide : fr.panel.toggleShow}</span>
        </Button>
      </div>
      <div
        id={`${id}-body`}
        className={cn(
          "thin-scrollbar px-4 pb-4 narrow:px-2 narrow:pb-2",
          "single:absolute single:-inset-x-px single:top-full single:z-20 single:max-h-[var(--thread-height,60cqh)] single:overflow-y-auto single:overscroll-contain single:rounded-b-2xl single:border single:border-t-0 single:bg-card single:pt-1",
          expanded ? "block" : "hidden wide:block",
        )}
        data-testid="panel-body"
      >
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
