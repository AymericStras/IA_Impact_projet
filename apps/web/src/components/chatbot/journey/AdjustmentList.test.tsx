import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AdjustmentList } from "./AdjustmentList";
import { adjustmentsJourney } from "./journeyFixtures";

const { adjustments } = adjustmentsJourney;

describe("AdjustmentList", () => {
  it("shows the reason once, the consent rule, and EVERY adjustment as its own card with its own button", () => {
    render(<AdjustmentList adjustments={adjustments} onAccept={vi.fn()} />);
    expect(screen.getByTestId("adjustment-reason")).toHaveTextContent(
      "Le temps disponible à Carcassonne entre l'arrivée et le départ du train de retour est trop court pour les activités choisies.",
    );
    expect(screen.getAllByText(/trop court pour les activités choisies/)).toHaveLength(1);
    expect(screen.getByTestId("adjustment-consent")).toHaveTextContent(
      "Rien n'est modifié tant que vous n'avez pas accepté un ajustement.",
    );
    // Same cards, same order as the server's list: nothing filtered, sorted or preselected.
    expect(screen.getAllByRole("heading", { level: 3 }).slice(1).map((h) => h.textContent)).toEqual(adjustments.map((a) => a.label));
    expect(adjustments).toHaveLength(6);
    expect(screen.getAllByRole("button", { name: "Accepter cet ajustement" })).toHaveLength(6);
    expect(screen.getAllByTestId("adjustment-unlocks").map((el) => el.textContent)).toEqual([
      "1 itinéraire possible",
      "1 itinéraire possible",
      "3 itinéraires possibles",
      "3 itinéraires possibles",
      "2 itinéraires possibles",
      "3 itinéraires possibles",
    ]);
  });

  it("accepts the adjustment whose button was pressed, and nothing before that", async () => {
    const onAccept = vi.fn();
    render(<AdjustmentList adjustments={adjustments} onAccept={onAccept} />);
    expect(onAccept).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Accepter cet ajustement" })[4]!);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith(adjustments[4]!.id);
  });

  it("shows each card's own reason when the server gives different ones", () => {
    const mixed = [adjustments[0]!, { ...adjustments[1]!, reason: "Le premier train part trop tard." }];
    render(<AdjustmentList adjustments={mixed} onAccept={vi.fn()} />);
    expect(screen.queryByTestId("adjustment-reason")).not.toBeInTheDocument();
    expect(screen.getByText("Le premier train part trop tard.")).toBeInTheDocument();
    expect(screen.getByText(/trop court pour les activités choisies/)).toBeInTheDocument();
  });
});
