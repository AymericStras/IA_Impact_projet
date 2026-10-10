import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BookingRefused } from "./BookingRefused";
import { refusedJourney } from "./journeyFixtures";

describe("BookingRefused", () => {
  it("shows the server's refusal message and the alternatives as itinerary cards", async () => {
    const onChoose = vi.fn();
    render(<BookingRefused booking={refusedJourney.booking!} alternatives={refusedJourney.alternatives} onChoose={onChoose} />);
    expect(screen.getByTestId("booking-message")).toHaveTextContent(
      "La demande n'a pas pu être confirmée (simulation : plus de places pour ce groupe).",
    );
    expect(screen.getByText("Autres itinéraires possibles")).toBeInTheDocument();
    expect(screen.getAllByTestId("itinerary-card")).toHaveLength(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Choisir cet itinéraire" })[0]!);
    expect(onChoose).toHaveBeenCalledWith("iti_early");
  });

  it("shows no alternative section when the server offers none", () => {
    render(<BookingRefused booking={refusedJourney.booking!} alternatives={[]} onChoose={vi.fn()} />);
    expect(screen.queryByText("Autres itinéraires possibles")).not.toBeInTheDocument();
    expect(screen.queryByTestId("itinerary-card")).not.toBeInTheDocument();
  });
});
