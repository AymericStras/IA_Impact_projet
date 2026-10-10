import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DestinationList } from "./DestinationList";
import { adjustmentsJourney } from "./journeyFixtures";

describe("DestinationList", () => {
  it("keeps the server's order and reports the destination chosen", async () => {
    const onChoose = vi.fn();
    const user = userEvent.setup();
    render(<DestinationList destinations={adjustmentsJourney.destinations} onChoose={onChoose} />);

    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Cité médiévale de Carcassonne",
      "Albi, cité épiscopale",
      "Sète et l'étang de Thau",
      "Canal du Midi à Castelnaudary",
    ]);
    await user.click(screen.getByRole("checkbox", { name: /Atelier au musée/ }));
    await user.click(screen.getAllByRole("button", { name: "Choisir cette destination" })[1]!);
    expect(onChoose).toHaveBeenCalledWith("albi", ["albi-3"]);
  });

  it("shows the stations a city was expanded into, and the current selection", () => {
    render(
      <DestinationList
        destinations={adjustmentsJourney.destinations}
        selectedDestinationId="carcassonne"
        selectedActivityIds={["carcassonne-1", "carcassonne-2"]}
        departureStations={adjustmentsJourney.departure_stations}
        onChoose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("departure-stations")).toHaveTextContent(
      "Gares de départ possibles : Toulouse Matabiau, Toulouse Saint-Cyprien-Arènes, Toulouse Saint-Agne",
    );
    expect(screen.getAllByText("Destination actuelle")).toHaveLength(1);
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(2);
  });

  it("does not list a single station as a choice of stations", () => {
    render(<DestinationList destinations={adjustmentsJourney.destinations} departureStations={["Toulouse Matabiau"]} onChoose={vi.fn()} />);
    expect(screen.queryByTestId("departure-stations")).not.toBeInTheDocument();
  });
});
