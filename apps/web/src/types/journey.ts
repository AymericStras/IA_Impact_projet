/**
 * Types of the journey after confirmation, mirroring `packages/contracts/journey.schema.json`
 * and `travel_file.schema.json` (generated from the backend's Pydantic models).
 * The client renders these; it decides nothing.
 */
import type { ConfirmedRequirements } from "./contracts";

export type JourneyStage =
  | "destinations"
  | "itineraries"
  | "adjustments"
  | "no_match"
  | "review"
  | "booking_pending"
  | "booked"
  | "booking_refused"
  | "closed";

export type SearchScenario = "auto" | "adjustments" | "no_match" | "error";
export type BookingScenario = "confirmed" | "refused" | "error";

export interface Place {
  title: string;
  walk_minutes: number;
  note: string;
}

export interface ActivityOption {
  id: string;
  title: string;
  description: string;
  duration_minutes: number;
}

export interface DestinationOption {
  id: string;
  city: string;
  station: string;
  title: string;
  theme_match: string;
  travel_minutes: number;
  places: Place[];
  activities: ActivityOption[];
}

export interface TrainLeg {
  line: string;
  from_station: string;
  to_station: string;
  /** Local ISO date-time with offset (Europe/Paris). */
  departure: string;
  arrival: string;
}

export interface TimedActivity {
  title: string;
  start: string;
  end: string;
}

export interface FeasibilityCheck {
  label: string;
  ok: boolean;
}

export interface Itinerary {
  id: string;
  destination_id: string;
  title: string;
  label: string;
  outbound: TrainLeg;
  return: TrainLeg;
  activities: TimedActivity[];
  free_minutes: number;
  checks: FeasibilityCheck[];
  participants_count: number;
  simulated: boolean;
}

export interface RequirementChange {
  field: "departure" | "return";
  /** HH:MM */
  before: string;
  after: string;
}

export interface Adjustment {
  id: string;
  kind: "return_later" | "departure_earlier" | "fewer_activities" | "other_destination";
  /** French sentence: what changes. */
  label: string;
  /** French sentence: why the request does not fit as asked. */
  reason: string;
  changes: RequirementChange[];
  destination_id: string | null;
  activity_ids: string[] | null;
  /** Number of itineraries that become feasible. */
  unlocks: number;
}

export interface Booking {
  reference: string;
  status: "pending" | "confirmed" | "refused";
  itinerary_id: string;
  message: string;
  simulated: boolean;
}

export interface Feedback {
  rating: 1 | 2 | 3 | 4 | 5;
  comment?: string | null;
}

export interface Journey {
  conversation_id: string;
  stage: JourneyStage;
  requirements_version: number;
  planner_mode: "simulated" | "http";
  simulated: boolean;
  /** Stations the departure may use (a city is expanded). */
  departure_stations: string[];
  /** French notes to show (simulation label, assumptions). */
  notices: string[];
  /** French line describing the current stage. */
  message: string;
  destinations: DestinationOption[];
  selected_destination_id: string | null;
  selected_activity_ids: string[];
  itineraries: Itinerary[];
  adjustments: Adjustment[];
  accepted_adjustments: Adjustment[];
  selected_itinerary_id: string | null;
  booking: Booking | null;
  /** Offered after a refused booking. */
  alternatives: Itinerary[];
  feedback: Feedback | null;
  search_scenario: SearchScenario;
  booking_scenario: BookingScenario;
  strict_minutes: number;
}

export interface TravelFile {
  reference: string;
  title: string;
  requirements: ConfirmedRequirements["requirements"];
  itinerary: Itinerary;
  places: Place[];
  /** French lines of the day's timetable. */
  schedule: string[];
  safety_advice: string[];
  useful_contacts: string[];
  official_links: string[];
  simulated: boolean;
}

export interface JourneyScenarios {
  search_scenario?: SearchScenario;
  booking_scenario?: BookingScenario;
}
