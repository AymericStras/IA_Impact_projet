"use client";

import { useId, useState } from "react";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, PencilIcon, PlusIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { frVoice } from "@/i18n/fr.voice";
import { FLUID_BUTTON, TOUCH_TARGET, WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { ConversationResponse } from "@/types/contracts";
import type { BookingScenario, JourneyScenarios, SearchScenario } from "@/types/journey";
import { StageHeading } from "../StageFrame";
import { ActionButton, StageActions } from "../journey/StageActions";
import { SHEET_FIELDS, assistantText, fieldLabel, fieldValue, participantsDetail } from "../fieldDisplay";
import styles from "../voice.module.css";

interface DoneStageProps {
  conversation: ConversationResponse;
  focusHeading: boolean;
  disabled: boolean;
  onModify: () => void;
  onNewTrip: () => void;
  /** The search of proposals; absent when the server's `planner_mode` is "off" or unknown. */
  search?: DoneSearch;
}

export interface DoneSearch {
  /** Simulation: the test scenarios are offered. */
  simulated: boolean;
  /** The lookup of an existing journey has answered. */
  ready: boolean;
  /** The search request is in flight. */
  searching: boolean;
  onSearch: (scenarios?: JourneyScenarios) => void;
}

const SEARCH_SCENARIOS: readonly SearchScenario[] = ["auto", "adjustments", "no_match", "error"];
const BOOKING_SCENARIOS: readonly BookingScenario[] = ["confirmed", "refused", "error"];
const SELECT = "min-h-11 w-full min-w-0 rounded-lg border border-input bg-card px-2 text-base text-foreground";

/**
 * Stage 5 — the hand-over is confirmed (the server says so). Success in words and icon,
 * the values that were transmitted, and the exact payload on demand.
 */
export function DoneStage({ conversation, focusHeading, disabled, onModify, onNewTrip, search }: DoneStageProps) {
  const [jsonOpen, setJsonOpen] = useState(false);
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [searchScenario, setSearchScenario] = useState<SearchScenario>("auto");
  const [bookingScenario, setBookingScenario] = useState<BookingScenario>("confirmed");
  const searchSelectId = useId();
  const bookingSelectId = useId();
  const scenarioCopy = frVoice.journey.scenario;
  const payload = conversation.confirmed_requirements ?? null;
  const json = payload ? JSON.stringify(payload, null, 2) : null;

  return (
    <div className={cn(styles.stage, styles.safeX, "max-w-2xl justify-center gap-5 py-6")} data-testid="stage-done">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground" aria-hidden="true">
          <CheckIcon className="size-7" strokeWidth={3} />
        </span>
        <StageHeading focusOnEnter={focusHeading} className="text-[clamp(1.5rem,6cqi,2.5rem)] font-semibold leading-tight tracking-tight text-foreground">
          {frVoice.done.heading}
        </StageHeading>
      </div>
      <p className={cn("whitespace-pre-wrap text-base leading-relaxed text-foreground", WRAP_ANYWHERE)} data-testid="done-message">
        {assistantText(conversation) ?? frVoice.done.fallbackMessage}
      </p>

      <section className="rounded-2xl border border-success/40 bg-success-soft/60 p-4" aria-labelledby="done-summary-title">
        <h2 id="done-summary-title" className="text-sm font-medium text-foreground">
          {frVoice.done.summaryLabel}
        </h2>
        <dl className="mt-2 grid gap-2" data-testid="done-summary">
          {SHEET_FIELDS.map((field) => {
            const detail = field === "participants_count" ? participantsDetail(conversation.requirements) : null;
            return (
              <div key={field} className={cn("grid gap-0.5", WRAP_ANYWHERE)} data-testid={`done-value-${field}`}>
                <dt className="text-sm text-muted-foreground">{fieldLabel(field)}</dt>
                <dd className="text-lg font-semibold leading-snug text-foreground">
                  {fieldValue(field, conversation.requirements) ?? frVoice.sheet.missing}
                  {detail ? <span className="block text-sm font-normal text-muted-foreground">{detail}</span> : null}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      {json ? (
        <div className="min-w-0 rounded-2xl border bg-muted/40" data-testid="done-json">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setJsonOpen((open) => !open)}
            aria-expanded={jsonOpen}
            aria-controls="done-json-content"
            className={cn("m-1", FLUID_BUTTON, TOUCH_TARGET)}
            data-testid="done-json-toggle"
          >
            {jsonOpen ? <ChevronUpIcon aria-hidden="true" /> : <ChevronDownIcon aria-hidden="true" />}
            {jsonOpen ? frVoice.done.jsonHide : frVoice.done.jsonShow}
          </Button>
          {jsonOpen ? (
            <div id="done-json-content" className="border-t px-3 py-2">
              <p className="mb-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{frVoice.done.jsonHint(payload?.schema_version ?? "")}</p>
              <pre
                // The only intentionally horizontally scrollable region; focusable for keyboard scrolling.
                tabIndex={0}
                data-scroll-x=""
                aria-label={frVoice.done.jsonLabel}
                className="overflow-x-auto rounded-lg bg-card p-3 font-mono text-xs leading-relaxed ring-1 ring-foreground/10"
                data-testid="done-json-pre"
              >
                {json}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}

      {search?.simulated ? (
        // Test control of the simulation, discreet and closed by default.
        <div className="min-w-0 rounded-2xl border border-dashed bg-muted/40" data-testid="scenario">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setScenarioOpen((open) => !open)}
            aria-expanded={scenarioOpen}
            aria-controls="scenario-content"
            className={cn("m-1 text-muted-foreground", FLUID_BUTTON, TOUCH_TARGET)}
            data-testid="scenario-toggle"
          >
            {scenarioOpen ? <ChevronUpIcon aria-hidden="true" /> : <ChevronDownIcon aria-hidden="true" />}
            {scenarioCopy.toggle}
          </Button>
          {scenarioOpen ? (
            <div id="scenario-content" className="grid gap-3 border-t px-3 py-3">
              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{scenarioCopy.hint}</p>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3">
                <div className="grid min-w-0 gap-1">
                  <label htmlFor={searchSelectId} className="text-sm font-medium text-foreground">
                    {scenarioCopy.searchLabel}
                  </label>
                  <select
                    id={searchSelectId}
                    value={searchScenario}
                    onChange={(event) => setSearchScenario(event.target.value as SearchScenario)}
                    className={SELECT}
                    data-testid="scenario-search"
                  >
                    {SEARCH_SCENARIOS.map((value) => (
                      <option key={value} value={value}>
                        {scenarioCopy.search[value]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid min-w-0 gap-1">
                  <label htmlFor={bookingSelectId} className="text-sm font-medium text-foreground">
                    {scenarioCopy.bookingLabel}
                  </label>
                  <select
                    id={bookingSelectId}
                    value={bookingScenario}
                    onChange={(event) => setBookingScenario(event.target.value as BookingScenario)}
                    className={SELECT}
                    data-testid="scenario-booking"
                  >
                    {BOOKING_SCENARIOS.map((value) => (
                      <option key={value} value={value}>
                        {scenarioCopy.booking[value]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {search ? (
        <StageActions narrow>
          <ActionButton
            primary
            busy={search.searching}
            disabled={disabled || !search.ready || search.searching}
            // Scenarios exist in the simulation only; a real planner receives none.
            onClick={() => search.onSearch(search.simulated ? { search_scenario: searchScenario, booking_scenario: bookingScenario } : undefined)}
            testId="done-search"
          >
            {search.searching ? null : <SearchIcon aria-hidden="true" />}
            {search.searching ? frVoice.journey.searching : frVoice.journey.search}
          </ActionButton>
        </StageActions>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onModify} disabled={disabled} className={cn(FLUID_BUTTON, TOUCH_TARGET)} data-testid="done-modify">
          <PencilIcon aria-hidden="true" />
          {frVoice.done.modify}
        </Button>
        {/* One primary action per stage: when the search is offered, it is the one. */}
        <Button
          type="button"
          variant={search ? "outline" : "default"}
          onClick={onNewTrip}
          disabled={disabled}
          className={cn(FLUID_BUTTON, TOUCH_TARGET)}
          data-testid="done-new"
        >
          <PlusIcon aria-hidden="true" />
          {frVoice.done.newTrip}
        </Button>
      </div>
    </div>
  );
}
