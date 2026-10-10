import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Adjustment } from "@/types/journey";
import { AdjustmentCard } from "./AdjustmentCard";
import { adjustmentsJourney } from "./journeyFixtures";

const byKind = (kind: Adjustment["kind"]) => adjustmentsJourney.adjustments.find((a) => a.kind === kind) as Adjustment;

describe("AdjustmentCard", () => {
  it("states the change in the server's words, the before → after time and what it unlocks", () => {
    render(<AdjustmentCard adjustment={byKind("return_later")} onAccept={vi.fn()} />);
    const card = screen.getByRole("article", { name: "Retour à 17 h 30 au lieu de 17 h 00" });
    expect(screen.getByTestId("adjustment-change")).toHaveTextContent("Retour : 17 h 00 devient 17 h 30");
    expect(screen.getByTestId("adjustment-unlocks")).toHaveTextContent("1 itinéraire possible");
    expect(card).not.toHaveTextContent("trop court");
  });

  it("uses the departure label for a departure change and the plural for several itineraries", () => {
    render(<AdjustmentCard adjustment={{ ...byKind("departure_earlier"), unlocks: 2 }} onAccept={vi.fn()} />);
    expect(screen.getByTestId("adjustment-change")).toHaveTextContent("Départ : 8 h 00 devient 7 h 30");
    expect(screen.getByTestId("adjustment-unlocks")).toHaveTextContent("2 itinéraires possibles");
  });

  it("shows no before → after line for an adjustment that changes no requirement", () => {
    render(<AdjustmentCard adjustment={byKind("other_destination")} showReason onAccept={vi.fn()} />);
    const card = screen.getByRole("article", { name: "Une destination plus proche : Canal du Midi à Castelnaudary (40 min de trajet)" });
    expect(screen.queryByTestId("adjustment-change")).not.toBeInTheDocument();
    expect(screen.getByTestId("adjustment-unlocks")).toHaveTextContent("3 itinéraires possibles");
    expect(card).toHaveTextContent("est trop court pour les activités choisies");
  });

  it("is applied only by its own button", async () => {
    const onAccept = vi.fn();
    render(<AdjustmentCard adjustment={byKind("fewer_activities")} onAccept={onAccept} />);
    expect(onAccept).not.toHaveBeenCalled();
    const button = screen.getByRole("button", { name: "Accepter cet ajustement" });
    expect(button).toHaveAccessibleDescription("Une seule activité : Atelier « vie au Moyen Âge »");
    await userEvent.setup().click(button);
    expect(onAccept).toHaveBeenCalledTimes(1);
  });
});
