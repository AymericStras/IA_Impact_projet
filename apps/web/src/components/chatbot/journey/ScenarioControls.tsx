"use client";

import { useId, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { fr } from "@/i18n/fr";
import { FLUID_BUTTON_SM, TOUCH_TARGET, WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { BookingScenario, JourneyScenarios, SearchScenario } from "@/types/journey";
import { JOURNEY_SELECT } from "./journeyStyles";

const SEARCH_SCENARIOS: readonly SearchScenario[] = ["auto", "adjustments", "no_match", "error"];
const BOOKING_SCENARIOS: readonly BookingScenario[] = ["confirmed", "refused", "error"];

interface ScenarioControlsProps {
  value: Required<JourneyScenarios>;
  onChange: (value: Required<JourneyScenarios>) => void;
  disabled?: boolean;
}

/**
 * Test tool of the simulated planner (docs/PLANNER_CONTRACT.md, "Test scenarios"): picks
 * the branch the next search will show. Collapsed by default and only rendered when the
 * server says `planner_mode: "simulated"`. The values are sent as they are to `POST /journey`.
 */
export function ScenarioControls({ value, onChange, disabled = false }: ScenarioControlsProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="min-w-0 rounded-xl border border-dashed border-input" data-testid="scenario-controls">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={`${id}-content`}
        className={cn("text-muted-foreground", FLUID_BUTTON_SM, TOUCH_TARGET)}
      >
        {open ? <ChevronUpIcon aria-hidden="true" /> : <ChevronDownIcon aria-hidden="true" />}
        {fr.journey.scenario.toggle}
      </Button>
      {open ? (
        <div id={`${id}-content`} className="grid gap-2.5 border-t border-dashed border-input px-3 py-2.5">
          <p className={cn("text-xs text-muted-foreground", WRAP_ANYWHERE)}>{fr.journey.scenario.hint}</p>
          <div className="grid gap-2.5 @[30rem]/journey:grid-cols-2">
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor={`${id}-search`}>{fr.journey.scenario.searchLabel}</Label>
              <select
                id={`${id}-search`}
                className={JOURNEY_SELECT}
                value={value.search_scenario}
                disabled={disabled}
                onChange={(event) => onChange({ ...value, search_scenario: event.target.value as SearchScenario })}
              >
                {SEARCH_SCENARIOS.map((scenario) => (
                  <option key={scenario} value={scenario}>
                    {fr.journey.scenario.search[scenario]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor={`${id}-booking`}>{fr.journey.scenario.bookingLabel}</Label>
              <select
                id={`${id}-booking`}
                className={JOURNEY_SELECT}
                value={value.booking_scenario}
                disabled={disabled}
                onChange={(event) => onChange({ ...value, booking_scenario: event.target.value as BookingScenario })}
              >
                {BOOKING_SCENARIOS.map((scenario) => (
                  <option key={scenario} value={scenario}>
                    {fr.journey.scenario.booking[scenario]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
