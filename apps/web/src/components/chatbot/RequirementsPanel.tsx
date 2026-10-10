"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fr } from "@/i18n/fr";
import { DISPLAY, TOUCH_TARGET } from "@/lib/ui";
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
 * - `wide`: a white card in the grey column next to the conversation, always expanded;
 * - `single`: a white strip under the header (title, dots, count). Expanding it opens
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
        "@container/panel relative bg-card",
        "wide:rounded-2xl wide:shadow-card single:bleed-x single:border-b single:border-border",
        className,
      )}
      data-testid="requirements-panel"
      data-expanded={expanded}
    >
      <div className="flex items-center gap-2 wide:grid wide:grid-cols-[minmax(0,1fr)_auto] wide:gap-x-3 wide:gap-y-3 wide:px-5 wide:pt-5 wide:pb-4 single:-mr-2 single:tall:py-1.5">
        {/*
          Single column: title and dots share a line, the count joins them when it fits and
          drops under them otherwise. Two columns: title and state pill, then dots and count.
        */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 leading-tight wide:contents">
          <h2 id={`${id}-title`} className={cn(DISPLAY, "text-lg leading-none wide:text-2xl")}>
            {fr.panel.title}
          </h2>
          <div className="single:contents wide:col-span-2 wide:row-start-2 wide:flex wide:min-w-0 wide:flex-wrap wide:items-center wide:gap-x-2.5 wide:gap-y-1">
            {/*
              One dot per requirement, in the canonical order: navy when the server holds it,
              yellow when it is in `missing_fields`. Decorative: the count next to it says the
              same in words (a yellow dot alone would be 1.42:1 on white).
            */}
            <span className="flex shrink-0 items-center gap-1.5" aria-hidden="true" data-testid="panel-dots">
              {FIELD_NAMES.map((field) => (
                <span
                  key={field}
                  data-known={!missingFields.includes(field)}
                  className={cn("size-2.5 rounded-full transition-colors", missingFields.includes(field) ? "bg-highlight" : "bg-primary")}
                />
              ))}
            </span>
            <p className="text-[0.8125rem] font-semibold text-muted-foreground" data-testid="panel-progress" aria-live="polite">
              {complete ? fr.panel.progressComplete(total) : fr.panel.progress(known, total)}
            </p>
          </div>
        </div>
        <span
          className="hidden shrink-0 rounded-full bg-muted px-2.5 py-1 text-[0.6875rem] font-bold text-primary wide:col-start-2 wide:row-start-1 wide:@[19rem]/panel:inline-flex"
          data-testid="panel-state"
        >
          {fr.states[state]}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("shrink-0 font-bold wide:hidden", TOUCH_TARGET)}
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
          "thin-scrollbar pb-4 wide:px-5",
          "single:pr-[var(--gutter-r)] single:pl-[var(--gutter-l)] single:absolute single:inset-x-0 single:top-full single:z-20 single:mt-px single:max-h-[var(--thread-height,60cqh)] single:overflow-y-auto single:overscroll-contain single:rounded-b-2xl single:bg-card single:shadow-raised",
          expanded ? "block" : "hidden wide:block",
        )}
        data-testid="panel-body"
      >
        <ul className="grid single:[&>li:first-child]:border-t-0">
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
        <p className="border-t border-border pt-3 text-xs text-muted-foreground">{fr.panel.subtitle}</p>
      </div>
    </section>
  );
}
