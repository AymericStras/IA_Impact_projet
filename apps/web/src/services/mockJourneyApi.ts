import { ApiError } from "./types";
import type { JourneyService } from "./journeyTypes";

/**
 * Demo-mode journey. PLACEHOLDER: to be replaced by a scripted simulation that mirrors
 * `services/api/app/services/planner.py` and stays valid against
 * `packages/contracts/journey.schema.json`. Until then every call fails visibly.
 */
const notReady = (): Promise<never> =>
  Promise.reject(new ApiError(501, "Non disponible", "Le parcours simulé n'est pas encore disponible en mode démo."));

export const mockJourneyApi: JourneyService = {
  start: notReady,
  get: notReady,
  chooseDestination: notReady,
  acceptAdjustment: notReady,
  chooseItinerary: notReady,
  submitBooking: notReady,
  checkBooking: notReady,
  travelFile: notReady,
  giveFeedback: notReady,
};
