import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Journey } from "@/types/journey";
import {
  adjustmentsJourney,
  bookedJourney,
  closedJourney,
  destinationsJourney,
  itinerariesJourney,
  journeyState,
  noMatchJourney,
  pendingJourney,
  refusedJourney,
  reviewJourney,
  SIMULATION_NOTICE,
  travelFile,
} from "./journeyFixtures";
import { JourneyPanel } from "./JourneyPanel";

const PLANNER_ERROR =
  "La recherche a rencontré un problème technique. Cela ne signifie pas qu'aucun trajet n'existe ; vos informations sont conservées, vous pouvez réessayer.";

function show(overrides: Parameters<typeof journeyState>[0] = {}, props: { simulated?: boolean } = {}) {
  const state = journeyState(overrides);
  const onEditRequest = vi.fn();
  const onViewChange = vi.fn();
  const view = render(
    <JourneyPanel state={state} simulated={props.simulated ?? true} onEditRequest={onEditRequest} onViewChange={onViewChange} />,
  );
  return { state, onEditRequest, onViewChange, user: userEvent.setup(), ...view };
}

describe("JourneyPanel", () => {
  it("renders nothing until the journey is enabled, and a status while it is looked up", () => {
    const { container, rerender } = show({ status: "idle" });
    expect(container).toBeEmptyDOMElement();
    rerender(<JourneyPanel state={journeyState({ status: "loading" })} simulated onEditRequest={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Chargement des propositions…");
  });

  it("starts with a card; the search is sent with the scenarios picked in the test tool", async () => {
    const { state, user } = show();
    expect(screen.getByTestId("journey")).toHaveAttribute("data-stage", "start");
    expect(screen.getByRole("button", { name: "Scénario de test" })).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("button", { name: "Rechercher des propositions" }));
    expect(state.start).toHaveBeenLastCalledWith({ search_scenario: "auto", booking_scenario: "confirmed" });

    await user.click(screen.getByRole("button", { name: "Scénario de test" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Recherche" }), "adjustments");
    await user.selectOptions(screen.getByRole("combobox", { name: "Réservation" }), "refused");
    await user.click(screen.getByRole("button", { name: "Rechercher des propositions" }));
    expect(state.start).toHaveBeenLastCalledWith({ search_scenario: "adjustments", booking_scenario: "refused" });
  });

  it("has no test tool when the planner is not simulated", () => {
    show({}, { simulated: false });
    expect(screen.getByRole("button", { name: "Rechercher des propositions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Scénario de test" })).not.toBeInTheDocument();
  });

  it.each<[string, Journey, string]>([
    ["destinations", destinationsJourney, "Destinations proposées"],
    ["itineraries", itinerariesJourney, "Itinéraires possibles"],
    ["adjustments", adjustmentsJourney, "Ajustements possibles"],
    ["no_match", noMatchJourney, "Aucune proposition"],
    ["review", reviewJourney, "Vérification avant réservation"],
    ["booking_pending", pendingJourney, "Demande de réservation envoyée"],
    ["booked", bookedJourney, "Réservation confirmée"],
    ["booking_refused", refusedJourney, "Réservation non confirmée"],
    ["closed", closedJourney, "Sortie clôturée"],
  ])("stage %s: title, the server's message and every notice of the server", (stage, journey, title) => {
    const { onViewChange } = show({ journey });
    expect(screen.getByTestId("journey")).toHaveAttribute("data-stage", stage);
    expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
    expect(screen.getByTestId("journey-message")).toHaveTextContent(journey.message);
    const notices = within(screen.getAllByTestId("journey-notices")[0]!).getAllByRole("listitem");
    expect(notices.map((li) => li.textContent)).toEqual(journey.notices);
    expect(notices[0]).toHaveTextContent(SIMULATION_NOTICE);
    expect(onViewChange).toHaveBeenLastCalledWith(`${stage}:stage`);
  });

  it("shows no simulation label of its own: the notices are the server's, whatever they say", () => {
    show({ journey: { ...itinerariesJourney, notices: ["Données fournies par le service liO."] } });
    expect(screen.getByTestId("journey-notices")).toHaveTextContent("Données fournies par le service liO.");
    expect(screen.queryByText(/Simulation/)).not.toBeInTheDocument();
  });

  it("destinations: forwards the destination and the ticked activities", async () => {
    const { state, user } = show({ journey: destinationsJourney });
    await user.click(screen.getByRole("checkbox", { name: /Visite guidée des remparts/ }));
    await user.click(screen.getAllByRole("button", { name: "Choisir cette destination" })[0]!);
    expect(state.chooseDestination).toHaveBeenCalledWith("carcassonne", ["carcassonne-1"]);
    // Already on the list: no « Changer de destination » here.
    expect(screen.queryByRole("button", { name: "Changer de destination" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Modifier ma demande" })).toBeInTheDocument();
  });

  it("itineraries: choosing one, or going back to the destinations with the current choice restored", async () => {
    const { state, user, onViewChange } = show({ journey: itinerariesJourney });
    expect(screen.getAllByTestId("itinerary-card")).toHaveLength(3);
    await user.click(screen.getAllByRole("button", { name: "Choisir cet itinéraire" })[2]!);
    expect(state.chooseItinerary).toHaveBeenCalledWith("iti_late");

    await user.click(screen.getByRole("button", { name: "Changer de destination" }));
    expect(screen.getByRole("heading", { level: 2, name: "Choisir une autre destination" })).toBeInTheDocument();
    expect(screen.getByTestId("journey")).toHaveAttribute("data-view", "destinations");
    expect(onViewChange).toHaveBeenLastCalledWith("itineraries:destinations");
    expect(screen.queryByTestId("itinerary-card")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("destination-card")).toHaveLength(4);
    expect(screen.getByText("Destination actuelle")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(2);
    // The simulation label stays on this view too.
    expect(screen.getByTestId("journey-notices")).toHaveTextContent(SIMULATION_NOTICE);

    await user.click(screen.getByRole("button", { name: "Revenir à l'étape en cours" }));
    expect(screen.getAllByTestId("itinerary-card")).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Changer de destination" }));
    await user.click(screen.getAllByRole("button", { name: "Choisir cette destination" })[1]!);
    expect(state.chooseDestination).toHaveBeenCalledWith("albi", []);
    await waitFor(() => expect(screen.getByTestId("journey")).toHaveAttribute("data-view", "stage"));
  });

  it("adjustments: every adjustment is offered, one acceptance sends one id, and the ways out are there", async () => {
    const { state, user, onEditRequest } = show({ journey: adjustmentsJourney });
    expect(screen.getAllByTestId("adjustment-card")).toHaveLength(adjustmentsJourney.adjustments.length);
    expect(screen.getByTestId("adjustment-consent")).toBeInTheDocument();
    expect(state.acceptAdjustment).not.toHaveBeenCalled();

    await user.click(screen.getAllByRole("button", { name: "Accepter cet ajustement" })[0]!);
    expect(state.acceptAdjustment).toHaveBeenCalledTimes(1);
    expect(state.acceptAdjustment).toHaveBeenCalledWith(adjustmentsJourney.adjustments[0]!.id);

    await user.click(screen.getByRole("button", { name: "Modifier ma demande" }));
    expect(onEditRequest).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Choisir une autre destination" }));
    expect(screen.getAllByTestId("destination-card")).toHaveLength(4);
  });

  it("no_match is a plain outcome with ways out, never an error", async () => {
    const { user } = show({ journey: noMatchJourney });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("error-message")).not.toBeInTheDocument();
    expect(screen.getByTestId("journey-no-match")).toHaveTextContent("il ne s'agit pas d'une erreur technique");
    expect(screen.getByRole("button", { name: "Modifier ma demande" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Relancer la recherche" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Choisir une autre destination" }));
    expect(screen.getAllByTestId("destination-card")).toHaveLength(4);
  });

  it("no_match without any destination offers the request and a new search, not an empty list", async () => {
    const { state, user } = show({ journey: { ...noMatchJourney, destinations: [], selected_destination_id: null } });
    expect(screen.queryByRole("button", { name: "Choisir une autre destination" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Relancer la recherche" }));
    expect(state.start).toHaveBeenCalledWith({ search_scenario: "auto", booking_scenario: "confirmed" });
  });

  it("a technical failure is an error block with the server's text and « Réessayer », unlike no_match", async () => {
    const retry = vi.fn(async () => undefined);
    const dismissError = vi.fn();
    const { user, onViewChange } = show({
      error: { detail: PLANNER_ERROR, code: "PLANNER_ERROR", action: "start", retry },
      dismissError,
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Une erreur est survenue");
    expect(alert).toHaveTextContent(PLANNER_ERROR);
    expect(screen.queryByTestId("journey-no-match")).not.toBeInTheDocument();
    expect(screen.queryByText("Aucune proposition")).not.toBeInTheDocument();
    // The search can still be started again from the same card.
    expect(screen.getByRole("button", { name: "Rechercher des propositions" })).toBeEnabled();
    expect(onViewChange).toHaveBeenLastCalledWith("start:error");

    await user.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(retry).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Fermer" }));
    expect(dismissError).toHaveBeenCalledTimes(1);
  });

  it("an error during a stage keeps the stage on screen; one that cannot be replayed has no « Réessayer »", () => {
    show({
      journey: reviewJourney,
      error: {
        detail: "Le service de réservation ne répond pas. Votre demande n'a pas été envoyée ; vous pouvez réessayer.",
        code: "BOOKING_ERROR",
        action: "booking",
        retry: null,
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Le service de réservation ne répond pas.");
    expect(screen.queryByRole("button", { name: "Réessayer" })).not.toBeInTheDocument();
    expect(screen.getByTestId("journey-review")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Envoyer la demande de réservation" })).toBeEnabled();
  });

  it("falls back to the network message when the server said nothing", () => {
    show({ journey: itinerariesJourney, error: { detail: "", action: "itinerary", retry: vi.fn(async () => undefined) } });
    expect(screen.getByRole("alert")).toHaveTextContent("Impossible de joindre le serveur.");
  });

  it("review: the selected itinerary, the booking request, and the other itineraries on demand", async () => {
    const { state, user } = show({ journey: reviewJourney });
    expect(screen.getAllByTestId("itinerary-card")).toHaveLength(1);
    expect(screen.getByRole("article", { name: "Journée complète" })).toBeInTheDocument();
    expect(screen.getByTestId("review-not-booked")).toBeInTheDocument();
    expect(state.submitBooking).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Envoyer la demande de réservation" }));
    expect(state.submitBooking).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Choisir un autre itinéraire" }));
    expect(screen.getAllByTestId("itinerary-card")).toHaveLength(3);
    await user.click(screen.getAllByRole("button", { name: "Choisir cet itinéraire" })[1]!);
    expect(state.chooseItinerary).toHaveBeenCalledWith("iti_early");
    await waitFor(() => expect(screen.getByTestId("journey")).toHaveAttribute("data-view", "stage"));
    // Still possible before the request is sent.
    expect(screen.getByRole("button", { name: "Changer de destination" })).toBeInTheDocument();
  });

  it("booking_pending: the reference and the itinerary; choices can no longer be changed", () => {
    show({ journey: pendingJourney });
    expect(screen.getByTestId("booking-reference")).toHaveTextContent("Référence : SIM-050033B9");
    expect(screen.getByRole("button", { name: "Vérifier la réponse" })).toBeInTheDocument();
    expect(screen.getAllByTestId("itinerary-card")).toHaveLength(1);
    expect(screen.queryByTestId("journey-actions")).not.toBeInTheDocument();
  });

  it("booking_refused: the refusal message and the alternatives", async () => {
    const { state, user } = show({ journey: refusedJourney });
    expect(screen.getByTestId("booking-message")).toHaveTextContent("plus de places pour ce groupe");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Choisir cet itinéraire" })[1]!);
    expect(state.chooseItinerary).toHaveBeenCalledWith("iti_late");
    expect(screen.getByRole("button", { name: "Changer de destination" })).toBeInTheDocument();
  });

  it("booked: fetches the travel file once, shows it with the simulation label, and takes the feedback", async () => {
    const { state, user, rerender } = show({ journey: bookedJourney });
    expect(screen.getByTestId("booking-message")).toHaveTextContent("Réservation confirmée (simulation). Référence SIM-050033B9.");
    expect(state.loadTravelFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("travel-file")).not.toBeInTheDocument();

    const loaded = { ...state, travelFile };
    rerender(<JourneyPanel state={loaded} simulated onEditRequest={vi.fn()} />);
    expect(state.loadTravelFile).toHaveBeenCalledTimes(1);
    const file = screen.getByTestId("travel-file");
    expect(file).toHaveTextContent("8 h 05 — Départ de Toulouse Matabiau");
    expect(within(file).getByTestId("journey-notices")).toHaveTextContent(SIMULATION_NOTICE);
    expect(screen.queryByTestId("journey-actions")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "5 sur 5" }));
    await user.click(screen.getByRole("button", { name: "Envoyer mon avis" }));
    expect(state.giveFeedback).toHaveBeenCalledWith({ rating: 5 });
  });

  it("does not ask for the travel file again after a failure: the error block offers the retry", () => {
    const state = journeyState({ journey: bookedJourney });
    const { rerender } = render(<JourneyPanel state={state} simulated onEditRequest={vi.fn()} />);
    const failed = { ...state, error: { detail: "Erreur interne.", action: "travel_file" as const, retry: vi.fn(async () => undefined) } };
    rerender(<JourneyPanel state={failed} simulated onEditRequest={vi.fn()} />);
    rerender(<JourneyPanel state={{ ...failed }} simulated onEditRequest={vi.fn()} />);
    expect(state.loadTravelFile).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });

  it("closed: thanks, the feedback given and the travel file; no more form", () => {
    show({ journey: closedJourney, travelFile });
    expect(screen.getByTestId("journey-message")).toHaveTextContent("Merci pour votre retour d'expérience.");
    expect(screen.getByTestId("feedback-given")).toHaveTextContent("Votre note : 4 sur 5");
    expect(screen.getByTestId("feedback-given")).toHaveTextContent("Très bien organisé.");
    expect(screen.getByTestId("travel-file")).toBeInTheDocument();
    expect(screen.queryByTestId("feedback-form")).not.toBeInTheDocument();
  });

  it("locks the choices while a request is in flight", () => {
    show({ journey: itinerariesJourney, pending: "itinerary" });
    // Everything that would send a request; opening the test tool stays possible.
    const acting = screen.getAllByRole("button").filter((button) => button.textContent !== "Scénario de test");
    expect(acting.length).toBeGreaterThan(5);
    for (const button of acting) expect(button).toBeDisabled();
  });
});
