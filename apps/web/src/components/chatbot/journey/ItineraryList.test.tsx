import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ItineraryList } from "./ItineraryList";
import { threeItineraries } from "./journeyFixtures";

describe("ItineraryList", () => {
  it("lists the itineraries in the server's order, each with its own button", async () => {
    const onChoose = vi.fn();
    render(<ItineraryList itineraries={threeItineraries} onChoose={onChoose} />);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Journée complète",
      "Retour anticipé",
      "Départ décalé",
    ]);
    const buttons = screen.getAllByRole("button", { name: "Choisir cet itinéraire" });
    expect(buttons).toHaveLength(3);
    expect(buttons[1]).toHaveAccessibleDescription("Retour anticipé");
    await userEvent.setup().click(buttons[1]!);
    expect(onChoose).toHaveBeenCalledWith("iti_early");
  });

  it("locks every card while a request is in flight", () => {
    render(<ItineraryList itineraries={threeItineraries} onChoose={vi.fn()} busy />);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });
});
