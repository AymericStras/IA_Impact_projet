import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type ConversationService, type JourneyService } from "@/services";
import type { ConversationResponse } from "@/types/contracts";
import type { Journey } from "@/types/journey";
import { VoiceFlow } from "./VoiceFlow";
import {
  SIMULATION_NOTICE,
  adjustmentsJourney,
  bookedJourney,
  destinationsJourney,
  fakeJourneyService,
  itinerariesJourney,
  noMatchJourney,
  pendingJourney,
  refusedJourney,
  reviewJourney,
} from "./journey/journeyFixtures";

/**
 * The journey stages wired into the real `VoiceFlow`, against a fake conversation service
 * and a fake `JourneyService`: what the teacher sees is what the services answered.
 */

function confirmed(overrides: Partial<ConversationResponse> = {}): ConversationResponse {
  return {
    conversation_id: "conv_test",
    state: "CONFIRMED",
    version: 4,
    assistant_message: null,
    requirements: {
      participants_count: 30,
      participants_breakdown: { students: 27, accompanying: 3 },
      departure_station: "Toulouse",
      departure: { date: "2026-11-12", time: "08:00", constraint: "approximate" },
      return: { date: "2026-11-12", time: "17:00", constraint: "latest" },
      teaching_type: { subject: "Histoire", theme: "Moyen Âge" },
    },
    missing_fields: [],
    pending_clarification: null,
    ready_for_confirmation: false,
    transcript: null,
    confirmed_requirements: null,
    messages: [{ id: "msg_001", role: "assistant", content: "C'est confirmé.", created_at: "2026-10-10T10:00:00+02:00" }],
    ...overrides,
  };
}

function conversationService(mode: "off" | "simulated" | "http", overrides: Partial<ConversationService> = {}): ConversationService {
  return {
    getConfig: vi.fn(async () => ({ max_audio_seconds: 90, max_audio_bytes: 1_000_000, max_message_chars: 500, timezone: "Europe/Paris", planner_mode: mode })),
    create: vi.fn(async () => confirmed({ state: "COLLECTING" })),
    get: vi.fn(async () => confirmed()),
    sendMessage: vi.fn(),
    sendAudio: vi.fn(),
    editField: vi.fn(async () => confirmed({ state: "AWAITING_CONFIRMATION", version: 5, ready_for_confirmation: true })),
    confirm: vi.fn(async () => confirmed({ version: 6 })),
    exportConfirmed: vi.fn(),
    ...overrides,
  } as ConversationService;
}

const shell = () => screen.getByTestId("voice-shell");
const stageIs = (stage: string) => waitFor(() => expect(shell()).toHaveAttribute("data-stage", stage));
const dock = () => within(screen.getByTestId("voice-dock"));

async function mount(journeyService: JourneyService, mode: "off" | "simulated" | "http" = "simulated", service = conversationService(mode)) {
  window.localStorage.setItem("lio.conversation_id", "conv_test");
  const user = userEvent.setup();
  render(<VoiceFlow service={service} journeyService={journeyService} />);
  await waitFor(() => expect(shell()).not.toHaveAttribute("data-stage", "loading"));
  return { user, service, journeyService };
}

/** Mounts on a journey already in progress at `journey.stage`. */
async function mountAt(journey: Journey, overrides: Partial<JourneyService> = {}) {
  const mounted = await mount(fakeJourneyService({ get: vi.fn(async () => journey), ...overrides }));
  await stageIs(journey.stage);
  return mounted;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("VoiceFlow — from done to the journey", () => {
  it("hides the search when the planner is off", async () => {
    await mount(fakeJourneyService(), "off");
    await stageIs("done");
    expect(screen.queryByRole("button", { name: "Rechercher des propositions" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("scenario")).not.toBeInTheDocument();
    expect(screen.queryByTestId("voice-dock")).not.toBeInTheDocument();
  });

  it("offers the search without test scenarios when the planner is the real one", async () => {
    const { user, journeyService } = await mount(fakeJourneyService(), "http");
    await stageIs("done");
    expect(screen.queryByTestId("scenario")).not.toBeInTheDocument();
    const search = await dock().findByRole("button", { name: "Rechercher des propositions" });
    await waitFor(() => expect(search).toBeEnabled());
    await user.click(search);
    expect(journeyService.start).toHaveBeenCalledWith("conv_test", undefined);
  });

  it("puts the one primary action in the dock, and the scenarios behind a closed control", async () => {
    const { user, journeyService } = await mount(fakeJourneyService());
    await stageIs("done");
    const search = await dock().findByRole("button", { name: "Rechercher des propositions" });
    await waitFor(() => expect(search).toBeEnabled());

    const toggle = screen.getByRole("button", { name: "Scénario de test" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Recherche")).not.toBeInTheDocument();
    await user.click(toggle);
    expect(within(screen.getByLabelText("Recherche")).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Automatique",
      "Ajustements nécessaires",
      "Aucun résultat",
      "Erreur technique",
    ]);
    expect(within(screen.getByLabelText("Réservation")).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Confirmée",
      "Refusée",
      "Erreur technique",
    ]);
    await user.selectOptions(screen.getByLabelText("Recherche"), "adjustments");
    await user.selectOptions(screen.getByLabelText("Réservation"), "refused");

    await user.click(search);
    expect(journeyService.start).toHaveBeenCalledWith("conv_test", { search_scenario: "adjustments", booking_scenario: "refused" });
    await stageIs("destinations");
    expect(screen.getByRole("heading", { level: 1, name: "Choisissez une destination" })).toHaveFocus();
    expect(screen.getByTestId("stage-announcer")).toHaveTextContent("Destinations proposées.");
  });

  it("shows a technical failure as an error with the server's words and « Réessayer » — not as an absence of result", async () => {
    const detail = "La recherche a rencontré un problème technique. Cela ne signifie pas qu'aucun trajet n'existe.";
    const start = vi.fn().mockRejectedValueOnce(new ApiError(502, "Planification", detail, "PLANNER_ERROR")).mockResolvedValueOnce(destinationsJourney());
    const { user } = await mount(fakeJourneyService({ start }));
    await stageIs("done");
    const search = await dock().findByRole("button", { name: "Rechercher des propositions" });
    await waitFor(() => expect(search).toBeEnabled());
    await user.click(search);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-testid", "journey-error");
    expect(alert).toHaveTextContent("Erreur technique");
    expect(alert).toHaveTextContent(detail);
    expect(shell()).toHaveAttribute("data-stage", "done");
    expect(screen.queryByTestId("stage-no_match")).not.toBeInTheDocument();

    await user.click(within(alert).getByRole("button", { name: "Réessayer" }));
    await stageIs("destinations");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("falls back to a French sentence when the network gave no detail", async () => {
    const start = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { user } = await mount(fakeJourneyService({ start }));
    const search = await dock().findByRole("button", { name: "Rechercher des propositions" });
    await waitFor(() => expect(search).toBeEnabled());
    await user.click(search);
    expect(await screen.findByRole("alert")).toHaveTextContent("Le service n'a pas répondu : ce n'est pas une absence de résultat. Vérifiez votre connexion, puis réessayez.");
  });
});

describe("VoiceFlow — journey stages", () => {
  it("no_match is a calm stage with no alert, unlike a technical error", async () => {
    const journey = noMatchJourney();
    await mountAt(journey);
    expect(screen.getByRole("heading", { level: 1, name: "Aucune proposition pour cette demande" })).toBeInTheDocument();
    expect(screen.getByTestId("journey-message")).toHaveTextContent(journey.message);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(dock().queryByRole("button", { name: "Réessayer" })).not.toBeInTheDocument();
    expect(dock().getByRole("button", { name: "Autre destination" })).toBeEnabled();
    expect(dock().getByRole("button", { name: "Modifier ma demande" })).toBeEnabled();
  });

  it.each([
    ["destinations", destinationsJourney],
    ["itineraries", itinerariesJourney],
    ["adjustments", adjustmentsJourney],
    ["no_match", noMatchJourney],
    ["review", reviewJourney],
    ["booking_pending", pendingJourney],
    ["booking_refused", refusedJourney],
    ["booked", bookedJourney],
  ] as const)("shows the server's simulation label on %s", async (_stage, build) => {
    await mountAt(build());
    expect(within(screen.getByTestId("journey-notices")).getByText(SIMULATION_NOTICE)).toBeInTheDocument();
    // One heading, one primary action, and that action lives in the dock.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
    expect(screen.getByTestId("voice-dock").querySelector('[data-primary="true"]')).not.toBeNull();
  });

  it("renders whatever notices the server sends, and none of its own", async () => {
    await mountAt(destinationsJourney({ notices: ["Données de démonstration fournies par le serveur."] }));
    const notices = within(screen.getByTestId("journey-notices")).getAllByRole("listitem");
    expect(notices.map((item) => item.textContent)).toEqual(["Données de démonstration fournies par le serveur."]);
    expect(screen.queryByText(SIMULATION_NOTICE)).not.toBeInTheDocument();
  });

  it("chooses a destination, then an itinerary, then sends the request", async () => {
    const { user, journeyService } = await mountAt(destinationsJourney());
    await user.click(dock().getByRole("button", { name: "Choisir cette destination" }));
    expect(journeyService.chooseDestination).toHaveBeenCalledWith("conv_test", "carcassonne", []);
    await stageIs("itineraries");

    await user.click(dock().getByRole("button", { name: "Choisir cet itinéraire" }));
    expect(journeyService.chooseItinerary).toHaveBeenCalledWith("conv_test", "iti_9f11c4f37d");
    await stageIs("review");
    expect(screen.getByTestId("review-not-booked")).toBeInTheDocument();
    expect(journeyService.submitBooking).not.toHaveBeenCalled();

    await user.click(dock().getByRole("button", { name: "Envoyer la demande" }));
    await stageIs("booking_pending");
    expect(screen.getByTestId("booking-reference")).toHaveTextContent("SIM-050033B9");
  });

  it("accepts an adjustment only on the explicit action, then re-reads the conversation", async () => {
    const { user, journeyService, service } = await mountAt(adjustmentsJourney());
    expect(screen.getAllByRole("radio").length).toBeGreaterThan(1);
    await user.click(screen.getByRole("radio", { name: /Retour à 17 h 30 au lieu de 17 h 00/ }));
    expect(journeyService.acceptAdjustment).not.toHaveBeenCalled();

    await user.click(dock().getByRole("button", { name: "Accepter cet ajustement" }));
    expect(journeyService.acceptAdjustment).toHaveBeenCalledWith("conv_test", "adj_762b46e27f");
    await stageIs("itineraries");
    // Once at load, once for the refresh after the acceptance.
    expect(service.get).toHaveBeenCalledTimes(2);
  });

  it("changes destination mid-way and can come back without choosing", async () => {
    const { user, journeyService } = await mountAt(reviewJourney());
    await user.click(dock().getByRole("button", { name: "Autre destination" }));
    await stageIs("destinations");
    // The server is still on the review: its line is not shown under another heading.
    expect(screen.queryByTestId("journey-message")).not.toBeInTheDocument();
    // The cards open on the current choice.
    expect(screen.getByRole("heading", { level: 2, name: "Cité médiévale de Carcassonne" })).toBeInTheDocument();

    await user.click(dock().getByRole("button", { name: "Retour" }));
    await stageIs("review");

    await user.click(dock().getByRole("button", { name: "Autre destination" }));
    await user.click(screen.getByRole("button", { name: "Destination suivante" }));
    await user.click(dock().getByRole("button", { name: "Choisir cette destination" }));
    expect(journeyService.chooseDestination).toHaveBeenCalledWith("conv_test", "albi", []);
    await stageIs("itineraries");
  });

  it("goes back from the review to the itineraries", async () => {
    const { user } = await mountAt(reviewJourney());
    await user.click(dock().getByRole("button", { name: "Autre itinéraire" }));
    await stageIs("itineraries");
    expect(screen.getByRole("heading", { level: 2, name: "Journée complète" })).toBeInTheDocument();
  });

  it("an edited requirement drops the journey: sheet, notice, nothing stale on screen", async () => {
    // Like the server: once the confirmation is cleared, there is no journey any more.
    const get = vi
      .fn()
      .mockResolvedValueOnce(itinerariesJourney())
      .mockRejectedValue(new ApiError(409, "État invalide", "Aucune recherche n'est en cours.", "INVALID_STATE"));
    const { user, service } = await mountAt(itinerariesJourney(), { get });
    await user.click(dock().getByRole("button", { name: "Modifier ma demande" }));
    await stageIs("sheet");
    // Nothing was edited yet: the way back to the proposals is offered, with no notice.
    expect(screen.getByRole("button", { name: "Revenir aux propositions" })).toBeInTheDocument();
    expect(screen.queryByTestId("search-restart-notice")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Modifier : Gare de départ" }));
    const field = screen.getByLabelText("Gare de départ");
    await user.clear(field);
    await user.type(field, "Montpellier");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByTestId("search-restart-notice")).toHaveTextContent(
      "Votre demande a changé : la recherche de propositions reprendra après la confirmation de la fiche.",
    );
    expect(service.editField).toHaveBeenCalled();
    expect(shell()).toHaveAttribute("data-stage", "sheet");
    expect(screen.queryByRole("button", { name: "Revenir aux propositions" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("journey-notices")).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();

    // Confirming again leads to done; the search has to be started again.
    await user.click(screen.getByRole("button", { name: "Confirmer" }));
    await stageIs("done");
    expect(screen.queryByTestId("search-restart-notice")).not.toBeInTheDocument();
    expect(await dock().findByRole("button", { name: "Rechercher des propositions" })).toBeInTheDocument();
  });

  it("offers no way back once the request is waiting", async () => {
    await mountAt(pendingJourney(), { checkBooking: vi.fn(async () => pendingJourney()) });
    expect(dock().getAllByRole("button")).toHaveLength(1);
    expect(dock().getByRole("button", { name: "Vérifier la réponse" })).toBeInTheDocument();
  });

  it("a refused booking shows the server's message and the alternatives one at a time, then books one", async () => {
    const journey = refusedJourney();
    const { user, journeyService } = await mountAt(journey);
    expect(screen.getByRole("heading", { level: 1, name: "Réservation non confirmée" })).toBeInTheDocument();
    expect(screen.getByTestId("refused-message")).toHaveTextContent("La demande n'a pas pu être confirmée (simulation : plus de places pour ce groupe).");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByTestId("itineraries-carousel-position")).toHaveTextContent("1 sur 2");

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("heading", { level: 2, name: "Départ plus tard" })).toBeInTheDocument();
    await user.click(dock().getByRole("button", { name: "Choisir cet itinéraire" }));
    expect(journeyService.chooseItinerary).toHaveBeenCalledWith("conv_test", "iti_later");
    await stageIs("review");
  });

  it("a booking error on check keeps the waiting stage and offers to try again", async () => {
    const detail = "La réservation a rencontré un problème technique. Votre demande n'est ni confirmée ni refusée.";
    const checkBooking = vi.fn().mockRejectedValueOnce(new ApiError(502, "Réservation", detail, "BOOKING_ERROR")).mockResolvedValueOnce(bookedJourney());
    const { user } = await mountAt(pendingJourney(), { checkBooking });
    await user.click(dock().getByRole("button", { name: "Vérifier la réponse" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(detail);
    expect(shell()).toHaveAttribute("data-stage", "booking_pending");
    await user.click(within(alert).getByRole("button", { name: "Réessayer" }));
    await stageIs("booked");
  });

  it("from the booking to the travel file, the print, the feedback and the end", async () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    const { user, journeyService } = await mountAt(bookedJourney());
    expect(screen.getByRole("heading", { level: 1, name: "Réservation confirmée" })).toBeInTheDocument();

    await user.click(dock().getByRole("button", { name: "Voir le dossier de voyage" }));
    await stageIs("travel_file");
    expect(screen.getByRole("heading", { level: 1, name: "Sortie pédagogique — Cité médiévale de Carcassonne" })).toHaveFocus();
    expect(within(screen.getByTestId("file-schedule")).getAllByRole("listitem")).toHaveLength(6);
    expect(within(screen.getByTestId("journey-notices")).getByText(SIMULATION_NOTICE)).toBeInTheDocument();

    await user.click(dock().getByRole("button", { name: "Imprimer" }));
    expect(print).toHaveBeenCalledTimes(1);

    await user.click(dock().getByRole("button", { name: "Donner mon avis" }));
    await stageIs("feedback");
    await user.click(screen.getByRole("radio", { name: "5 sur 5 : Très bien" }));
    await user.type(screen.getByLabelText("Un commentaire ? (facultatif)"), "Parfait.");
    await user.click(dock().getByRole("button", { name: "Envoyer mon avis" }));
    expect(journeyService.giveFeedback).toHaveBeenCalledWith("conv_test", { rating: 5, comment: "Parfait." });

    await stageIs("closed");
    expect(screen.getByRole("heading", { level: 1, name: "Merci !" })).toHaveFocus();
    expect(dock().getByRole("button", { name: "Nouvelle sortie" })).toHaveAttribute("data-primary", "true");
    vi.unstubAllGlobals();
  });
});
