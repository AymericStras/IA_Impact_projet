import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { itinerary } from "./journeyFixtures";
import { ReviewCard } from "./ReviewCard";

describe("ReviewCard", () => {
  it("shows the chosen itinerary in full and states that nothing is booked yet", async () => {
    const onSubmit = vi.fn();
    const onOther = vi.fn();
    const user = userEvent.setup();
    render(<ReviewCard itinerary={itinerary} onSubmit={onSubmit} onOtherItinerary={onOther} />);

    expect(screen.getByRole("article", { name: "Journée complète" })).toHaveTextContent("16 h 25 Carcassonne");
    expect(screen.getAllByTestId("train-leg")).toHaveLength(2);
    expect(screen.getByTestId("review-not-booked")).toHaveTextContent("Rien n'est réservé pour l'instant.");

    await user.click(screen.getByRole("button", { name: "Choisir un autre itinéraire" }));
    expect(onOther).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Envoyer la demande de réservation" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("locks its buttons while the request is being sent", () => {
    render(<ReviewCard itinerary={itinerary} onSubmit={vi.fn()} onOtherItinerary={vi.fn()} submitting busy />);
    expect(screen.getByRole("button", { name: "Envoi de la demande…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Choisir un autre itinéraire" })).toBeDisabled();
  });
});
