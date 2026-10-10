import type { Feedback, Journey, JourneyScenarios, TravelFile } from "@/types/journey";

/**
 * Client contract of the journey after confirmation, implemented by the real API and by
 * the demo mock. See docs/PLANNER_CONTRACT.md for the stages and rules.
 * Every method rejects with an `ApiError` (French `detail`, stable `code`).
 */
export interface JourneyService {
  /** Starts (or restarts) the search. 409 unless the requirements are confirmed. */
  start(conversationId: string, scenarios?: JourneyScenarios): Promise<Journey>;
  /** Current journey; 409 `INVALID_STATE` when none is in progress. */
  get(conversationId: string): Promise<Journey>;
  chooseDestination(conversationId: string, destinationId: string, activityIds: string[]): Promise<Journey>;
  /** Explicit acceptance: a time adjustment changes the confirmed requirements. */
  acceptAdjustment(conversationId: string, adjustmentId: string): Promise<Journey>;
  chooseItinerary(conversationId: string, itineraryId: string): Promise<Journey>;
  submitBooking(conversationId: string): Promise<Journey>;
  checkBooking(conversationId: string): Promise<Journey>;
  travelFile(conversationId: string): Promise<TravelFile>;
  giveFeedback(conversationId: string, feedback: Feedback): Promise<Journey>;
}
