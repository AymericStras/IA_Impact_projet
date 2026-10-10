import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ItineraryCard } from "./ItineraryCard";
import { itinerary } from "./journeyFixtures";

describe("ItineraryCard", () => {
  it("shows both legs with stations and times, the timed activities, the free time and the checks", () => {
    render(<ItineraryCard itinerary={itinerary} />);
    const card = screen.getByRole("article", { name: "Journée complète" });
    expect(card).toHaveTextContent("Cité médiévale de Carcassonne");
    expect(card).toHaveTextContent("30 participants");

    const [outbound, back] = screen.getAllByTestId("train-leg");
    expect(outbound).toHaveTextContent("Aller");
    expect(outbound).toHaveTextContent("8 h 05 Toulouse Matabiau");
    expect(outbound).toHaveTextContent("9 h 00 Carcassonne");
    expect(outbound).toHaveTextContent("liO Toulouse Matabiau – Carcassonne (horaire simulé)");
    expect(back).toHaveTextContent("Retour");
    expect(back).toHaveTextContent("16 h 25 Carcassonne");
    expect(back).toHaveTextContent("17 h 20 Toulouse Matabiau");

    expect(card).toHaveTextContent("9 h 37 – 11 h 07 Visite guidée des remparts");
    expect(card).toHaveTextContent("12 h 07 – 13 h 22 Atelier « vie au Moyen Âge »");
    expect(screen.getByTestId("itinerary-free-time")).toHaveTextContent("Temps libre sur place : 3 h 41");

    const checks = within(card).getAllByText(/Vérifié :/);
    expect(checks).toHaveLength(itinerary.checks.length);
    expect(card).toHaveTextContent("Capacité pour 30 participants (simulée)");
  });

  it("renders a failed check as failed: the result is the server's, in words and not by colour alone", () => {
    const failing = { ...itinerary, checks: [{ label: "Capacité pour 30 participants", ok: false }] };
    render(<ItineraryCard itinerary={failing} />);
    expect(screen.getByText("Non vérifié :")).toBeInTheDocument();
    expect(screen.getByRole("article")).toHaveTextContent("Capacité pour 30 participants — Non vérifié");
    expect(screen.queryByText("Vérifié :")).not.toBeInTheDocument();
  });

  it("renders its actions and names the card for them", () => {
    render(<ItineraryCard itinerary={itinerary}>{(titleId) => <button aria-describedby={titleId}>Action</button>}</ItineraryCard>);
    expect(screen.getByRole("button", { name: "Action" })).toHaveAccessibleDescription("Journée complète");
  });
});
