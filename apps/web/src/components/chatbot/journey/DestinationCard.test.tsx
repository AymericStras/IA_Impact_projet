import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DestinationOption } from "@/types/journey";
import { DestinationCard } from "./DestinationCard";
import { adjustmentsJourney } from "./journeyFixtures";

const carcassonne = adjustmentsJourney.destinations[0] as DestinationOption;

describe("DestinationCard", () => {
  it("shows why the destination fits, the travel time, the places and the activities with durations", () => {
    render(<DestinationCard destination={carcassonne} onChoose={vi.fn()} />);
    const card = screen.getByRole("article", { name: "Cité médiévale de Carcassonne" });
    expect(card).toHaveTextContent("Une cité fortifiée pour aborder le Moyen Âge sur le terrain.");
    expect(card).toHaveTextContent("55 min de trajet · Gare d'arrivée : Carcassonne");
    expect(card).toHaveTextContent("Château comtal");
    expect(card).toHaveTextContent("22 min à pied de la gare");
    expect(card).toHaveTextContent("Visite commentée possible pour les scolaires.");

    const activities = within(screen.getByRole("group", { name: "Activités" })).getAllByRole("checkbox");
    expect(activities).toHaveLength(3);
    expect(screen.getByRole("checkbox", { name: /Visite guidée des remparts 1\sh\s30/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Jeu de piste dans la cité 1\sh Enquête par équipes/ })).toBeInTheDocument();
  });

  it("sends the ticked activities in the server's order; none ticked sends an empty list", async () => {
    const onChoose = vi.fn();
    const user = userEvent.setup();
    render(<DestinationCard destination={carcassonne} onChoose={onChoose} />);
    const choose = screen.getByRole("button", { name: "Choisir cette destination" });

    await user.click(choose);
    expect(onChoose).toHaveBeenLastCalledWith([]);

    await user.click(screen.getByRole("checkbox", { name: /Jeu de piste/ }));
    await user.click(screen.getByRole("checkbox", { name: /Visite guidée/ }));
    await user.click(choose);
    expect(onChoose).toHaveBeenLastCalledWith(["carcassonne-1", "carcassonne-3"]);

    // Keyboard: Space toggles the focused checkbox.
    screen.getByRole("checkbox", { name: /Visite guidée/ }).focus();
    await user.keyboard(" ");
    await user.click(choose);
    expect(onChoose).toHaveBeenLastCalledWith(["carcassonne-3"]);
  });

  it("marks the destination the server holds as selected and restores its activities", () => {
    render(<DestinationCard destination={carcassonne} selected initialActivityIds={["carcassonne-2"]} onChoose={vi.fn()} />);
    expect(screen.getByText("Destination actuelle")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Atelier « vie au Moyen Âge »/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Visite guidée/ })).not.toBeChecked();
  });

  it("is locked while a request is in flight", () => {
    render(<DestinationCard destination={carcassonne} onChoose={vi.fn()} pending disabled />);
    expect(screen.getByRole("button", { name: "Recherche des itinéraires…" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Visite guidée/ })).toBeDisabled();
  });
});
