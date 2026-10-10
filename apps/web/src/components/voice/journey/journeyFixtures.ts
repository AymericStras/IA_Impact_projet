import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import type { JourneyService } from "@/services";
import type { Itinerary, Journey, TravelFile } from "@/types/journey";

/**
 * Test fixtures of the journey stages: the examples of `packages/contracts` (the contract
 * itself), and the other stages derived from them. Test-only — never imported by the app.
 */
const EXAMPLES = join(process.cwd(), "..", "..", "packages", "contracts", "examples");
const load = <T>(name: string): T => JSON.parse(readFileSync(join(EXAMPLES, name), "utf8")) as T;

/** `stage: "adjustments"` — six adjustments of four kinds, nothing chosen yet as asked. */
export const adjustmentsJourney = (): Journey => load<Journey>("journey_adjustments.json");
/** `stage: "booked"` — one accepted adjustment, a confirmed simulated booking. */
export const bookedJourney = (): Journey => load<Journey>("journey_booked.json");
export const travelFile = (): TravelFile => load<TravelFile>("travel_file.json");

export const SIMULATION_NOTICE = "Simulation : destinations, horaires, lieux et réservation sont illustratifs, sans disponibilité réelle.";

function variant(base: Itinerary, id: string, label: string): Itinerary {
  return { ...base, id, label };
}

/** The itinerary of the booked example and two more cards (same day, other labels). */
export function itineraries(): Itinerary[] {
  const [first] = bookedJourney().itineraries;
  return [first!, variant(first!, "iti_earlier", "Retour plus tôt"), variant(first!, "iti_later", "Départ plus tard")];
}

export function destinationsJourney(overrides: Partial<Journey> = {}): Journey {
  return {
    ...adjustmentsJourney(),
    stage: "destinations",
    message: "Voici des destinations adaptées à votre thème. Choisissez une destination et vos activités.",
    selected_destination_id: null,
    selected_activity_ids: [],
    adjustments: [],
    search_scenario: "auto",
    ...overrides,
  };
}

export function itinerariesJourney(overrides: Partial<Journey> = {}): Journey {
  return {
    ...bookedJourney(),
    stage: "itineraries",
    message: "Voici les itinéraires possibles. Choisissez celui qui vous convient.",
    itineraries: itineraries(),
    selected_itinerary_id: null,
    accepted_adjustments: [],
    booking: null,
    ...overrides,
  };
}

export function noMatchJourney(overrides: Partial<Journey> = {}): Journey {
  return {
    ...destinationsJourney(),
    stage: "no_match",
    message: "Aucun itinéraire ne convient pour cette destination, même en ajustant les horaires.",
    selected_destination_id: "carcassonne",
    ...overrides,
  };
}

export function reviewJourney(overrides: Partial<Journey> = {}): Journey {
  const booked = bookedJourney();
  return {
    ...booked,
    stage: "review",
    message: "Vérifiez l'itinéraire avant d'envoyer la demande de réservation.",
    itineraries: itineraries(),
    booking: null,
    ...overrides,
  };
}

export function pendingJourney(overrides: Partial<Journey> = {}): Journey {
  const booked = bookedJourney();
  return {
    ...booked,
    stage: "booking_pending",
    message: "Votre demande de réservation est envoyée. La réponse est en attente.",
    booking: { ...booked.booking!, status: "pending", message: "Demande envoyée (simulation). En attente de réponse." },
    ...overrides,
  };
}

export function refusedJourney(overrides: Partial<Journey> = {}): Journey {
  const booked = bookedJourney();
  const all = itineraries();
  return {
    ...booked,
    stage: "booking_refused",
    message: "La réservation n'a pas été confirmée. Voici d'autres itinéraires possibles ; vous pouvez aussi modifier votre demande.",
    itineraries: all,
    alternatives: all.slice(1),
    booking: {
      ...booked.booking!,
      status: "refused",
      message: "La demande n'a pas pu être confirmée (simulation : plus de places pour ce groupe).",
    },
    ...overrides,
  };
}

export function closedJourney(overrides: Partial<Journey> = {}): Journey {
  return {
    ...bookedJourney(),
    stage: "closed",
    message: "Merci pour votre retour. Bonne sortie !",
    feedback: { rating: 4, comment: "Très clair." },
    ...overrides,
  };
}

/** A `JourneyService` whose every method is a spy; `get` answers 409 like the server with no journey. */
export function fakeJourneyService(overrides: Partial<JourneyService> = {}): JourneyService {
  const none = async (): Promise<never> => {
    throw Object.assign(new Error("no journey"), { status: 409 });
  };
  return {
    start: vi.fn(async () => destinationsJourney()),
    get: vi.fn(none),
    chooseDestination: vi.fn(async () => itinerariesJourney()),
    acceptAdjustment: vi.fn(async () => itinerariesJourney()),
    chooseItinerary: vi.fn(async () => reviewJourney()),
    submitBooking: vi.fn(async () => pendingJourney()),
    checkBooking: vi.fn(async () => bookedJourney()),
    travelFile: vi.fn(async () => travelFile()),
    giveFeedback: vi.fn(async () => closedJourney()),
    ...overrides,
  };
}
