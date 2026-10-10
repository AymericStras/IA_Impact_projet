import type { Feedback, Journey, JourneyScenarios, TravelFile } from "@/types/journey";
import { request } from "./conversationApi";
import type { JourneyService } from "./journeyTypes";

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const base = (id: string) => `/conversations/${encodeURIComponent(id)}/journey`;

/** Real HTTP client of the journey endpoints (`/api/v1/conversations/{id}/journey…`). */
export const journeyApi: JourneyService = {
  start: (id, scenarios: JourneyScenarios = {}) => request<Journey>(base(id), json(scenarios)),
  get: (id) => request<Journey>(base(id)),
  chooseDestination: (id, destinationId, activityIds) =>
    request<Journey>(`${base(id)}/destination`, json({ destination_id: destinationId, activity_ids: activityIds })),
  acceptAdjustment: (id, adjustmentId) =>
    request<Journey>(`${base(id)}/adjustment`, json({ adjustment_id: adjustmentId })),
  chooseItinerary: (id, itineraryId) =>
    request<Journey>(`${base(id)}/itinerary`, json({ itinerary_id: itineraryId })),
  submitBooking: (id) => request<Journey>(`${base(id)}/booking`, { method: "POST" }),
  checkBooking: (id) => request<Journey>(`${base(id)}/booking/check`, { method: "POST" }),
  travelFile: (id) => request<TravelFile>(`${base(id)}/travel-file`),
  giveFeedback: (id, feedback: Feedback) => request<Journey>(`${base(id)}/feedback`, json(feedback)),
};
