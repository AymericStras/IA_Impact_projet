import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Journey } from "@/types/journey";
import { AdjustmentsStage } from "./AdjustmentsStage";
import { BookedStage } from "./BookedStage";
import { BookingPendingStage } from "./BookingPendingStage";
import { ClosedStage } from "./ClosedStage";
import { DestinationsStage } from "./DestinationsStage";
import { FeedbackStage } from "./FeedbackStage";
import { ItinerariesStage } from "./ItinerariesStage";
import { NoMatchStage } from "./NoMatchStage";
import { ReviewStage } from "./ReviewStage";
import { TravelFileStage } from "./TravelFileStage";
import {
  SIMULATION_NOTICE,
  adjustmentsJourney,
  bookedJourney,
  closedJourney,
  destinationsJourney,
  itineraries,
  noMatchJourney,
  pendingJourney,
  reviewJourney,
  travelFile,
} from "./journeyFixtures";
import { adjustmentReasons, clockTime, formatDuration, selectedItinerary } from "./journeyDisplay";

const noop = () => undefined;

/** Every journey stage carries the server's notices, word for word. */
function expectNotices(journey: Journey) {
  const notices = screen.getByTestId("journey-notices");
  for (const notice of journey.notices) expect(within(notices).getByText(notice)).toBeInTheDocument();
}

describe("journeyDisplay", () => {
  it("shows a local ISO time as written, whatever the browser's time zone", () => {
    expect(clockTime("2026-11-12T08:05+01:00")).toBe("8 h 05");
    expect(clockTime("2026-07-02T16:25:00+02:00")).toBe("16 h 25");
    expect(clockTime("pas une date")).toBe("pas une date");
  });

  it("formats durations in French", () => {
    expect(formatDuration(55)).toBe("55 min");
    expect(formatDuration(65)).toBe("1 h 05");
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(221)).toBe("3 h 41");
  });

  it("lists each reason of the server once", () => {
    expect(adjustmentReasons(adjustmentsJourney().adjustments)).toHaveLength(1);
  });

  it("looks the chosen itinerary up among the itineraries, then the alternatives", () => {
    const journey = reviewJourney();
    expect(selectedItinerary(journey)?.id).toBe(journey.selected_itinerary_id);
    const [first] = itineraries();
    expect(selectedItinerary({ ...journey, itineraries: [], alternatives: [first!] })?.id).toBe(first!.id);
    expect(selectedItinerary({ ...journey, selected_itinerary_id: null })).toBeNull();
  });
});

describe("DestinationsStage", () => {
  function renderStage(journey = destinationsJourney(), props: Partial<Parameters<typeof DestinationsStage>[0]> = {}) {
    const onChoose = vi.fn();
    render(
      <DestinationsStage journey={journey} focusHeading message={journey.message} busy={false} choosing={false} onChoose={onChoose} onModify={noop} {...props} />,
    );
    return { onChoose, journey };
  }

  it("shows ONE destination: title, why it fits, travel time, places with walking time", () => {
    const { journey } = renderStage();
    expect(screen.getByRole("heading", { level: 1, name: "Choisissez une destination" })).toHaveFocus();
    expect(screen.getByTestId("journey-message")).toHaveTextContent(journey.message);
    expectNotices(journey);

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(1);
    const card = within(cards[0]!);
    expect(card.getByRole("heading", { level: 2, name: "Cité médiévale de Carcassonne" })).toBeInTheDocument();
    expect(card.getByTestId("destination-why")).toHaveTextContent("Une cité fortifiée pour aborder le Moyen Âge sur le terrain.");
    expect(card.getByTestId("destination-travel")).toHaveTextContent("55 min de trajet");
    expect(card.getByText("Cité et remparts")).toBeInTheDocument();
    expect(card.getByText("20 min à pied de la gare")).toBeInTheDocument();
    expect(card.getByText("Accueil des groupes sur réservation ; horaires à confirmer.")).toBeInTheDocument();
    expect(screen.getByTestId("destinations-carousel-position")).toHaveTextContent("1 sur 4");
  });

  it("offers the activities as toggles with their duration and sends the ticked ones in the card's order", async () => {
    const user = userEvent.setup();
    const { onChoose } = renderStage();
    const walls = screen.getByRole("button", { name: "Visite guidée des remparts, 1 h 30" });
    const workshop = screen.getByRole("button", { name: "Atelier « vie au Moyen Âge », 1 h 15" });
    expect(walls).toHaveAttribute("aria-pressed", "false");
    expect(walls).toHaveAccessibleDescription("Parcours commenté des fortifications.");
    expect(walls).toHaveTextContent("1 h 30");

    await user.click(workshop);
    await user.click(walls);
    expect(walls).toHaveAttribute("aria-pressed", "true");
    expect(workshop).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Choisir cette destination" }));
    expect(onChoose).toHaveBeenCalledWith("carcassonne", ["carcassonne-1", "carcassonne-2"]);
  });

  it("sends no activity when none is ticked: the default is the server's", async () => {
    const user = userEvent.setup();
    const { onChoose } = renderStage();
    expect(screen.getByTestId("activities-hint")).toHaveTextContent("Sans choix de votre part, la première activité est retenue.");
    await user.keyboard("{ArrowRight}");
    await user.click(screen.getByRole("button", { name: "Choisir cette destination" }));
    expect(onChoose).toHaveBeenCalledWith("albi", []);
  });

  it("keeps the ticks of each card while the teacher looks at another one", async () => {
    const user = userEvent.setup();
    renderStage();
    await user.click(screen.getByRole("button", { name: /Visite guidée des remparts/ }));
    await user.click(screen.getByRole("button", { name: "Destination suivante" }));
    expect(screen.getByRole("heading", { level: 2, name: "Albi, cité épiscopale" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Destination précédente" }));
    expect(screen.getByRole("button", { name: /Visite guidée des remparts/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens on the server's current choice when coming back, and offers to return without choosing", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const journey = destinationsJourney({ stage: "itineraries", selected_destination_id: "albi", selected_activity_ids: ["albi-2"] });
    // The server's line is about another stage: it is not shown here.
    renderStage(journey, { message: null, onBack });
    expect(screen.getByRole("heading", { level: 2, name: "Albi, cité épiscopale" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Parcours dans la cité épiscopale/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("journey-message")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retour" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("locks everything while a request is in flight", () => {
    renderStage(destinationsJourney(), { busy: true, choosing: true });
    expect(screen.getByTestId("destination-choose")).toBeDisabled();
    expect(screen.getByTestId("destination-choose")).toHaveTextContent("Recherche des itinéraires…");
    expect(screen.getByRole("button", { name: /Visite guidée des remparts/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Modifier ma demande" })).toBeDisabled();
  });

  it("renders server text as text, never as markup", () => {
    const journey = destinationsJourney();
    journey.destinations[0]!.title = '<img src=x onerror="alert(1)">';
    renderStage(journey);
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("ItinerariesStage", () => {
  function renderStage(props: Partial<Parameters<typeof ItinerariesStage>[0]> = {}) {
    const onChoose = vi.fn();
    const onOtherDestination = vi.fn();
    const onModify = vi.fn();
    render(
      <ItinerariesStage
        stage="itineraries"
        heading="Choisissez un itinéraire"
        listLabel="Itinéraires proposés"
        itineraries={itineraries()}
        selectedId={null}
        notices={bookedJourney().notices}
        focusHeading
        message="Voici les itinéraires possibles."
        busy={false}
        choosing={false}
        onChoose={onChoose}
        onOtherDestination={onOtherDestination}
        onModify={onModify}
        {...props}
      />,
    );
    return { onChoose, onOtherDestination, onModify };
  }

  it("shows one itinerary as a timeline of the day: outbound, timed activities, return", () => {
    renderStage();
    expect(screen.getByRole("heading", { level: 1, name: "Choisissez un itinéraire" })).toHaveFocus();
    expectNotices(bookedJourney());
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: "Journée complète" })).toBeInTheDocument();

    const timeline = screen.getByRole("list", { name: "Déroulé de la journée" });
    const items = within(timeline).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent("8 h 05");
    expect(items[0]).toHaveTextContent("9 h 00");
    expect(items[0]).toHaveTextContent("Toulouse Matabiau → Carcassonne");
    // The server's wording of the line says that the timetable is simulated.
    expect(items[0]).toHaveTextContent("liO Toulouse Matabiau – Carcassonne (horaire simulé)");
    expect(items[1]).toHaveTextContent("9 h 37 – 11 h 07");
    expect(items[1]).toHaveTextContent("Visite guidée des remparts");
    expect(items[2]).toHaveTextContent("12 h 07 – 13 h 22");
    expect(items[3]).toHaveTextContent("16 h 25");
    expect(items[3]).toHaveTextContent("17 h 20");
    expect(items[3]).toHaveTextContent("Carcassonne → Toulouse Matabiau");
  });

  it("shows the free time and the server's feasibility checks, failed ones as failed", () => {
    const [first, ...rest] = itineraries();
    const failing = { ...first!, checks: [...first!.checks, { label: "Correspondance trop courte", ok: false }] };
    renderStage({ itineraries: [failing, ...rest] });
    expect(screen.getByTestId("itinerary-free-time")).toHaveTextContent("Temps libre sur place : 3 h 41");
    expect(screen.getByText("30 participants")).toBeInTheDocument();
    const checks = within(screen.getByTestId("itinerary-checks")).getAllByRole("listitem");
    expect(checks).toHaveLength(5);
    expect(checks[0]).toHaveAttribute("data-ok", "true");
    expect(checks[0]).toHaveTextContent("Vérifié : Horaires de départ et de retour respectés");
    expect(checks[4]).toHaveAttribute("data-ok", "false");
    expect(checks[4]).toHaveTextContent("Non respecté : Correspondance trop courte");
  });

  it("chooses the itinerary on screen, in the server's order", async () => {
    const user = userEvent.setup();
    const { onChoose, onOtherDestination, onModify } = renderStage();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("heading", { level: 2, name: "Retour plus tôt" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Choisir cet itinéraire" }));
    expect(onChoose).toHaveBeenCalledWith("iti_earlier");

    await user.click(screen.getByRole("button", { name: "Autre destination" }));
    await user.click(screen.getByRole("button", { name: "Modifier ma demande" }));
    expect(onOtherDestination).toHaveBeenCalled();
    expect(onModify).toHaveBeenCalled();
  });

  it("opens on the itinerary the server holds as chosen", () => {
    renderStage({ selectedId: "iti_later" });
    expect(screen.getByRole("heading", { level: 2, name: "Départ plus tard" })).toBeInTheDocument();
  });

  it("with nothing to choose from, keeps the two ways out and no primary action", () => {
    renderStage({ stage: "booking_refused", itineraries: [] });
    expect(screen.getByTestId("stage-booking_refused")).toBeInTheDocument();
    expect(screen.getByTestId("itineraries-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("itinerary-choose")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Autre destination" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Modifier ma demande" })).toBeEnabled();
  });
});

describe("AdjustmentsStage", () => {
  function renderStage(props: Partial<Parameters<typeof AdjustmentsStage>[0]> = {}) {
    const journey = adjustmentsJourney();
    const onAccept = vi.fn();
    const onOtherDestination = vi.fn();
    const onModify = vi.fn();
    render(
      <AdjustmentsStage
        journey={journey}
        focusHeading
        message={journey.message}
        busy={false}
        accepting={false}
        onAccept={onAccept}
        onOtherDestination={onOtherDestination}
        onModify={onModify}
        {...props}
      />,
    );
    return { journey, onAccept, onOtherDestination, onModify };
  }

  it("gives the reason once and offers every adjustment of the server, in its order", () => {
    const { journey } = renderStage();
    expect(screen.getByRole("heading", { level: 1, name: "Aucun itinéraire tel que demandé" })).toHaveFocus();
    expectNotices(journey);
    expect(screen.getAllByTestId("adjustments-reason")).toHaveLength(1);
    expect(screen.getByTestId("adjustments-reason")).toHaveTextContent(journey.adjustments[0]!.reason);

    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(6);
    expect(journey.adjustments.length).toBeGreaterThan(1);
    const labels = screen.getAllByTestId(/^adjustment-adj_/);
    expect(labels.map((label) => label.getAttribute("data-kind"))).toEqual(journey.adjustments.map((adjustment) => adjustment.kind));
  });

  it("says what changes (before → after) and how many itineraries each option unlocks", () => {
    renderStage();
    const later = within(screen.getByTestId("adjustment-adj_762b46e27f"));
    expect(later.getByText("Retour à 17 h 30 au lieu de 17 h 00")).toBeInTheDocument();
    expect(later.getByTestId("adjustment-change")).toHaveTextContent("Retour : 17 h 00 → 17 h 30");
    expect(later.getByTestId("adjustment-unlocks")).toHaveTextContent("→ 1 itinéraire possible");

    const earlier = within(screen.getByTestId("adjustment-adj_1e936aa10c"));
    expect(earlier.getByTestId("adjustment-change")).toHaveTextContent("Départ : 8 h 00 → 7 h 30");

    const fewer = within(screen.getByTestId("adjustment-adj_887176826b"));
    expect(fewer.getByText("Une seule activité : Atelier « vie au Moyen Âge »")).toBeInTheDocument();
    expect(fewer.queryByTestId("adjustment-change")).not.toBeInTheDocument();
    expect(fewer.getByTestId("adjustment-unlocks")).toHaveTextContent("→ 3 itinéraires possibles");
  });

  it("applies nothing on selection: only the explicit acceptance calls the server", async () => {
    const user = userEvent.setup();
    const { onAccept } = renderStage();
    const accept = screen.getByRole("button", { name: "Accepter cet ajustement" });
    expect(screen.getByTestId("adjustments-consent")).toHaveTextContent("Rien n'est modifié tant que vous n'avez pas accepté un ajustement.");
    expect(accept).toBeDisabled();
    expect(accept).toHaveAccessibleDescription("Rien n'est modifié tant que vous n'avez pas accepté un ajustement.");

    await user.click(screen.getByRole("radio", { name: /Retour à 18 h 00 au lieu de 17 h 00/ }));
    expect(onAccept).not.toHaveBeenCalled();
    expect(accept).toBeEnabled();

    // Changing one's mind is free.
    await user.click(screen.getByRole("radio", { name: /Départ à 7 h 30 au lieu de 8 h 00/ }));
    expect(onAccept).not.toHaveBeenCalled();

    await user.click(accept);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith("adj_1e936aa10c");
  });

  it("is operable with the keyboard alone: arrows move the selection, never accept", async () => {
    const user = userEvent.setup();
    const { onAccept } = renderStage();
    const radios = screen.getAllByRole("radio");
    radios[0]!.focus();
    await user.keyboard(" ");
    expect(radios[0]).toBeChecked();
    await user.keyboard("{ArrowDown}");
    expect(radios[1]).toBeChecked();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("offers another destination and the edit of the request", async () => {
    const user = userEvent.setup();
    const { onOtherDestination, onModify } = renderStage();
    await user.click(screen.getByRole("button", { name: "Autre destination" }));
    await user.click(screen.getByRole("button", { name: "Modifier ma demande" }));
    expect(onOtherDestination).toHaveBeenCalled();
    expect(onModify).toHaveBeenCalled();
  });
});

describe("NoMatchStage", () => {
  it("is a calm result, not an error: no alert, no retry, two ways out", () => {
    const journey = noMatchJourney();
    render(<NoMatchStage journey={journey} focusHeading message={journey.message} busy={false} onOtherDestination={noop} onModify={noop} />);
    expect(screen.getByRole("heading", { level: 1, name: "Aucune proposition pour cette demande" })).toHaveFocus();
    expect(screen.getByTestId("journey-message")).toHaveTextContent(journey.message);
    expectNotices(journey);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Réessayer" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Autre destination" })).toHaveAttribute("data-primary", "true");
    expect(screen.getByRole("button", { name: "Modifier ma demande" })).not.toHaveAttribute("data-primary");
  });

  it("offers only the edit when the server proposed no destination", () => {
    const journey = noMatchJourney({ destinations: [] });
    render(<NoMatchStage journey={journey} focusHeading message={journey.message} busy={false} onModify={noop} />);
    expect(screen.queryByRole("button", { name: "Autre destination" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Modifier ma demande" })).toHaveAttribute("data-primary", "true");
  });
});

describe("ReviewStage", () => {
  function renderStage(journey = reviewJourney(), props: Partial<Parameters<typeof ReviewStage>[0]> = {}) {
    const handlers = { onSend: vi.fn(), onOtherItinerary: vi.fn(), onOtherDestination: vi.fn(), onModify: vi.fn() };
    render(<ReviewStage journey={journey} focusHeading message={journey.message} busy={false} sending={false} {...handlers} {...props} />);
    return handlers;
  }

  it("shows the chosen itinerary in full and states that nothing is booked yet", () => {
    const journey = reviewJourney();
    renderStage(journey);
    expect(screen.getByRole("heading", { level: 1, name: "Vérifiez avant d'envoyer" })).toHaveFocus();
    expectNotices(journey);
    expect(screen.getByTestId("review-not-booked")).toHaveTextContent("Rien n'est encore réservé.");
    const itinerary = within(screen.getByTestId("review-itinerary"));
    expect(itinerary.getByRole("heading", { level: 2, name: "Journée complète" })).toBeInTheDocument();
    expect(within(itinerary.getByRole("list", { name: "Déroulé de la journée" })).getAllByRole("listitem")).toHaveLength(4);
    expect(itinerary.getByTestId("itinerary-checks")).toBeInTheDocument();
  });

  it("recalls the adjustment the teacher accepted, with its before and after values", () => {
    renderStage();
    const accepted = within(screen.getByTestId("review-accepted"));
    expect(accepted.getByText("Retour à 17 h 30 au lieu de 17 h 00")).toBeInTheDocument();
    expect(accepted.getByText("Retour : 17 h 00 → 17 h 30")).toBeInTheDocument();
  });

  it("has one primary action and three ways back", async () => {
    const user = userEvent.setup();
    const handlers = renderStage();
    expect(screen.getByRole("button", { name: "Envoyer la demande" })).toHaveAttribute("data-primary", "true");
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Autre itinéraire" }));
    await user.click(screen.getByRole("button", { name: "Autre destination" }));
    await user.click(screen.getByRole("button", { name: "Modifier ma demande" }));
    await user.click(screen.getByRole("button", { name: "Envoyer la demande" }));
    expect(handlers.onOtherItinerary).toHaveBeenCalledTimes(1);
    expect(handlers.onOtherDestination).toHaveBeenCalledTimes(1);
    expect(handlers.onModify).toHaveBeenCalledTimes(1);
    expect(handlers.onSend).toHaveBeenCalledTimes(1);
  });

  it("cannot send an itinerary the server no longer lists", () => {
    renderStage(reviewJourney({ selected_itinerary_id: "iti_gone" }));
    expect(screen.getByTestId("review-missing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Envoyer la demande" })).toBeDisabled();
  });
});

describe("BookingPendingStage", () => {
  it("does not repeat the stage line when the booking says the same", () => {
    const journey = pendingJourney();
    const same = { ...journey, message: journey.booking!.message };
    render(<BookingPendingStage journey={same} focusHeading message={same.message} busy={false} checking={false} onCheck={noop} />);
    expect(screen.getAllByText(same.message)).toHaveLength(1);
    expect(screen.getByTestId("booking-reference")).toBeInTheDocument();
  });

  it("shows the reference, the real state of the wait and one action", async () => {
    const user = userEvent.setup();
    const journey = pendingJourney();
    const onCheck = vi.fn();
    const { rerender } = render(<BookingPendingStage journey={journey} focusHeading message={journey.message} busy={false} checking={false} onCheck={onCheck} />);
    expect(screen.getByRole("heading", { level: 1, name: "Demande envoyée" })).toHaveFocus();
    expectNotices(journey);
    expect(screen.getByTestId("booking-reference")).toHaveTextContent("Référence : SIM-050033B9");
    expect(screen.getByTestId("pending-step-sent")).toHaveAttribute("data-state", "done");
    expect(screen.getByTestId("pending-step-answer")).toHaveAttribute("data-state", "waiting");
    expect(screen.getByTestId("pending-step-answer")).toHaveTextContent("en attente");
    // The booking's line is shown once, even when the stage line says the same.
    expect(screen.getAllByText(journey.booking!.message)).toHaveLength(1);
    // The choice cannot change any more: no way back is offered here.
    expect(screen.queryByRole("button", { name: "Autre destination" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Modifier ma demande" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Vérifier la réponse" }));
    expect(onCheck).toHaveBeenCalledTimes(1);

    rerender(<BookingPendingStage journey={journey} focusHeading message={journey.message} busy checking onCheck={onCheck} />);
    expect(screen.getByTestId("pending-step-answer")).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("booking-check")).toBeDisabled();
    expect(screen.getByTestId("booking-check")).toHaveTextContent("Vérification…");
  });
});

describe("BookedStage", () => {
  it("announces the success with the server's message and leads to the travel file", async () => {
    const user = userEvent.setup();
    const journey = bookedJourney();
    const onOpenFile = vi.fn();
    const onFeedback = vi.fn();
    render(<BookedStage journey={journey} focusHeading message={journey.message} busy={false} opening={false} onOpenFile={onOpenFile} onFeedback={onFeedback} />);
    expect(screen.getByRole("heading", { level: 1, name: "Réservation confirmée" })).toHaveFocus();
    expectNotices(journey);
    // The server's own sentence says the booking is simulated.
    expect(screen.getByText("Réservation confirmée (simulation). Référence SIM-050033B9.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Voir le dossier de voyage" }));
    await user.click(screen.getByRole("button", { name: "Donner mon avis" }));
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onFeedback).toHaveBeenCalledTimes(1);
  });
});

describe("TravelFileStage", () => {
  it("is a readable file: timetable, places, safety advice, contacts — and the simulation label", async () => {
    const user = userEvent.setup();
    const file = travelFile();
    const onPrint = vi.fn();
    render(<TravelFileStage file={file} notices={bookedJourney().notices} focusHeading onPrint={onPrint} onBack={noop} onFeedback={noop} />);
    expect(screen.getByRole("heading", { level: 1, name: file.title })).toHaveFocus();
    expect(within(screen.getByTestId("journey-notices")).getByText(SIMULATION_NOTICE)).toBeInTheDocument();
    expect(screen.getByTestId("file-reference")).toHaveTextContent("Référence : SIM-050033B9");
    expect(screen.getByTestId("file-reference")).toHaveTextContent("jeudi 12 novembre 2026");

    const schedule = within(screen.getByTestId("file-schedule")).getAllByRole("listitem");
    expect(schedule.map((line) => line.textContent)).toEqual(file.schedule);
    expect(within(screen.getByTestId("file-places")).getByText("Château comtal")).toBeInTheDocument();
    expect(within(screen.getByTestId("file-safety")).getAllByRole("listitem")).toHaveLength(file.safety_advice.length);
    expect(within(screen.getByTestId("file-contacts")).getByText("Numéro d'urgence européen : 112")).toBeInTheDocument();
    // No official link in the simulation: no empty section.
    expect(screen.queryByTestId("file-links")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Imprimer" }));
    expect(onPrint).toHaveBeenCalledTimes(1);
  });

  it("shows an official link as text, never as a link", () => {
    const file = { ...travelFile(), official_links: ["javascript:alert(1)"] };
    render(<TravelFileStage file={file} notices={[]} focusHeading onPrint={noop} onBack={noop} />);
    expect(within(screen.getByTestId("file-links")).getByText("javascript:alert(1)")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Donner mon avis" })).not.toBeInTheDocument();
  });
});

describe("FeedbackStage", () => {
  function renderStage() {
    const onSend = vi.fn();
    render(<FeedbackStage journey={bookedJourney()} focusHeading busy={false} sending={false} onSend={onSend} onBack={noop} />);
    return { onSend };
  }

  it("asks for a rating from 1 to 5 before anything can be sent", async () => {
    const user = userEvent.setup();
    const { onSend } = renderStage();
    expect(screen.getByRole("heading", { level: 1, name: "Votre avis" })).toHaveFocus();
    expectNotices(bookedJourney());
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    const send = screen.getByRole("button", { name: "Envoyer mon avis" });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription("Choisissez d'abord une note.");

    await user.click(screen.getByRole("radio", { name: "4 sur 5 : Bien" }));
    expect(send).toBeEnabled();
    await user.click(send);
    expect(onSend).toHaveBeenCalledWith({ rating: 4, comment: null });
  });

  it("is operable with the keyboard, and sends the trimmed comment", async () => {
    const user = userEvent.setup();
    const { onSend } = renderStage();
    const radios = screen.getAllByRole("radio");
    radios[2]!.focus();
    await user.keyboard(" ");
    expect(radios[2]).toBeChecked();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(radios[4]).toBeChecked();

    await user.type(screen.getByLabelText("Un commentaire ? (facultatif)"), "  Très clair.  ");
    await user.click(screen.getByRole("button", { name: "Envoyer mon avis" }));
    expect(onSend).toHaveBeenCalledWith({ rating: 5, comment: "Très clair." });
  });

  it("limits the comment to the contract's length", () => {
    renderStage();
    expect(screen.getByLabelText("Un commentaire ? (facultatif)")).toHaveAttribute("maxlength", "1000");
  });
});

describe("ClosedStage", () => {
  it("thanks, recalls the feedback the server recorded and offers a new trip", async () => {
    const user = userEvent.setup();
    const journey = closedJourney();
    const onNewTrip = vi.fn();
    render(<ClosedStage journey={journey} focusHeading message={journey.message} busy={false} opening={false} onOpenFile={noop} onNewTrip={onNewTrip} />);
    expect(screen.getByRole("heading", { level: 1, name: "Merci !" })).toHaveFocus();
    expectNotices(journey);
    expect(screen.getByTestId("closed-feedback")).toHaveTextContent("Votre note : 4 sur 5");
    expect(screen.getByTestId("closed-feedback")).toHaveTextContent("Très clair.");
    await user.click(screen.getByRole("button", { name: "Nouvelle sortie" }));
    expect(onNewTrip).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Revoir le dossier de voyage" })).toBeEnabled();
  });
});
