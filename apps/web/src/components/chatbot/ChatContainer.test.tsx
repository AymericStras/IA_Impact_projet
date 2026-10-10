import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JourneyService } from "@/services";
import { ApiError, type ConversationService } from "@/services/types";
import type { ClientConfig, ConfirmedRequirements, ConversationResponse } from "@/types/contracts";
import { ChatContainer } from "./ChatContainer";
import { adjustmentsJourney, destinationsJourney, itinerariesJourney, SIMULATION_NOTICE } from "./journey/journeyFixtures";

const requirements: ConfirmedRequirements["requirements"] = {
  participants_count: 30,
  participants_breakdown: null,
  departure_station: "Toulouse",
  departure: { date: "2026-11-12", time: "08:00", constraint: "approximate" },
  return: { date: "2026-11-12", time: "17:00", constraint: "latest" },
  teaching_type: { subject: "Histoire", theme: "Moyen Âge" },
};

function conversation(state: "CONFIRMED" | "AWAITING_CONFIRMATION", version: number, patch: Partial<typeof requirements> = {}): ConversationResponse {
  const current = { ...requirements, ...patch };
  return {
    conversation_id: "conv_test",
    state,
    version,
    assistant_message: null,
    requirements: current,
    missing_fields: [],
    pending_clarification: null,
    ready_for_confirmation: state === "AWAITING_CONFIRMATION",
    transcript: null,
    confirmed_requirements:
      state === "CONFIRMED"
        ? {
            schema_version: "1.1",
            conversation_id: "conv_test",
            status: "confirmed",
            timezone: "Europe/Paris",
            confirmed_at: "2026-10-10T10:00:00+02:00",
            requirements: current,
          }
        : null,
    messages: [{ id: "msg_001", role: "assistant", content: "Merci, votre projet est confirmé.", created_at: "2026-10-10T10:00:00+02:00" }],
  };
}

/** A tiny stateful server: confirmed at first; an edit reopens the project; confirm closes it again. */
function makeServices(plannerMode: ClientConfig["planner_mode"] | undefined, existingJourney = false) {
  let current = conversation("CONFIRMED", 3);
  const config: ClientConfig = { max_audio_seconds: 120, max_audio_bytes: 1_000_000, max_message_chars: 4_000, timezone: "Europe/Paris" };
  if (plannerMode) config.planner_mode = plannerMode;
  const service: ConversationService = {
    getConfig: vi.fn(async () => config),
    create: vi.fn(async () => current),
    get: vi.fn(async () => current),
    sendMessage: vi.fn(),
    sendAudio: vi.fn(),
    editField: vi.fn(async (_id, field, value) => {
      current = conversation("AWAITING_CONFIRMATION", current.version + 1, { [field]: value });
      return current;
    }) as ConversationService["editField"],
    confirm: vi.fn(async () => {
      current = conversation("CONFIRMED", current.version, current.requirements as typeof requirements);
      return current;
    }),
    exportConfirmed: vi.fn(),
  };
  const noJourney = () => Promise.reject(new ApiError(409, "État invalide", "Aucune recherche n'est en cours pour ce projet.", "INVALID_STATE"));
  const journeyService: JourneyService = {
    get: vi.fn(() => (existingJourney ? Promise.resolve(itinerariesJourney) : noJourney())),
    start: vi.fn(async () => destinationsJourney),
    chooseDestination: vi.fn(async () => adjustmentsJourney),
    acceptAdjustment: vi.fn(async () => {
      // The server applied the accepted time change to the confirmed requirements.
      current = conversation("CONFIRMED", current.version + 1, { return: { date: "2026-11-12", time: "17:30", constraint: "latest" } });
      return itinerariesJourney;
    }),
    chooseItinerary: vi.fn(),
    submitBooking: vi.fn(),
    checkBooking: vi.fn(),
    travelFile: vi.fn(),
    giveFeedback: vi.fn(),
  };
  return { service, journeyService };
}

async function open(plannerMode: ClientConfig["planner_mode"] | undefined, existingJourney = false) {
  const services = makeServices(plannerMode, existingJourney);
  render(<ChatContainer service={services.service} journeyService={services.journeyService} />);
  await screen.findByTestId("confirmation-done");
  await waitFor(() => expect(services.service.getConfig).toHaveBeenCalled());
  return { ...services, user: userEvent.setup() };
}

describe("ChatContainer — journey after confirmation", () => {
  beforeEach(() => window.localStorage.clear());

  it.each([undefined, "off"] as const)("shows no journey when planner_mode is %s", async (mode) => {
    const { journeyService } = await open(mode);
    // Give the config and any stray effect time to land.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId("journey")).not.toBeInTheDocument();
    expect(journeyService.get).not.toHaveBeenCalled();
    expect(screen.getByTestId("confirmed-json")).toBeInTheDocument();
  });

  it("adds the journey under the confirmed card and the JSON block, which stay", async () => {
    const { user, journeyService } = await open("simulated");
    const start = await screen.findByRole("button", { name: "Rechercher des propositions" });
    expect(screen.getByTestId("confirmation-done")).toBeInTheDocument();
    expect(screen.getByTestId("confirmed-json")).toBeInTheDocument();
    expect(screen.getByTestId("confirmation-done").compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scénario de test" })).toBeInTheDocument();

    await user.click(start);
    expect(journeyService.start).toHaveBeenCalledWith("conv_test", { search_scenario: "auto", booking_scenario: "confirmed" });
    expect(await screen.findAllByTestId("destination-card")).toHaveLength(4);
    expect(screen.getByTestId("journey-notices")).toHaveTextContent(SIMULATION_NOTICE);
    expect(screen.getByTestId("confirmed-json")).toBeInTheDocument();
  });

  it("offers the test tool only in simulated mode", async () => {
    await open("http");
    expect(await screen.findByRole("button", { name: "Rechercher des propositions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Scénario de test" })).not.toBeInTheDocument();
  });

  it("restores a journey in progress", async () => {
    await open("simulated", true);
    expect(await screen.findAllByTestId("itinerary-card")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Rechercher des propositions" })).not.toBeInTheDocument();
  });

  it("re-reads the conversation after an accepted adjustment so the panel shows the new time", async () => {
    const { user, service, journeyService } = await open("simulated");
    await user.click(await screen.findByRole("button", { name: "Rechercher des propositions" }));
    await user.click((await screen.findAllByRole("button", { name: "Choisir cette destination" }))[0]!);
    const accept = await screen.findAllByRole("button", { name: "Accepter cet ajustement" });
    expect(screen.getByTestId("field-return-value")).toHaveTextContent("au plus tard à 17 h 00");
    const reads = vi.mocked(service.get).mock.calls.length;

    await user.click(accept[0]!);
    expect(journeyService.acceptAdjustment).toHaveBeenCalledWith("conv_test", adjustmentsJourney.adjustments[0]!.id);
    await waitFor(() => expect(screen.getByTestId("field-return-value")).toHaveTextContent("au plus tard à 17 h 30"));
    expect(vi.mocked(service.get).mock.calls.length).toBe(reads + 1);
    // Still confirmed: the journey goes on with the itineraries.
    expect(await screen.findAllByTestId("itinerary-card")).toHaveLength(3);
    expect(screen.getByTestId("confirmed-json")).toHaveTextContent('"time": "17:30"');
  });

  it("an edit mid-way removes the journey, explains why, and the search restarts after a new confirmation", async () => {
    const { user, journeyService } = await open("simulated", true);
    await screen.findAllByTestId("itinerary-card");
    expect(screen.queryByTestId("journey-interrupted")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Modifier ma demande" }));
    const edit = await screen.findByRole("button", { name: "Modifier : Participants" });
    await waitFor(() => expect(edit).toHaveFocus());
    await user.click(edit);
    const input = screen.getByLabelText("Nombre total de participants");
    await user.clear(input);
    await user.type(input, "32");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    // No stale journey: it is gone as soon as the confirmation is.
    await waitFor(() => expect(screen.queryByTestId("journey")).not.toBeInTheDocument());
    expect(screen.queryByTestId("itinerary-card")).not.toBeInTheDocument();
    expect(screen.getByTestId("journey-interrupted")).toHaveTextContent(
      "La recherche de propositions est interrompue : confirmez à nouveau vos informations pour la relancer.",
    );
    const card = screen.getByTestId("confirmation-card");
    vi.mocked(journeyService.get).mockImplementation(() =>
      Promise.reject(new ApiError(409, "État invalide", "Aucune recherche n'est en cours pour ce projet.", "INVALID_STATE")),
    );

    await user.click(within(card).getByRole("button", { name: "Confirmer et continuer" }));
    expect(await screen.findByRole("button", { name: "Rechercher des propositions" })).toBeInTheDocument();
    expect(screen.queryByTestId("journey-interrupted")).not.toBeInTheDocument();
    expect(screen.queryByTestId("itinerary-card")).not.toBeInTheDocument();
    // The journey is looked up again for the new confirmation, not reused from memory.
    expect(journeyService.get).toHaveBeenCalledTimes(2);
  });
});
