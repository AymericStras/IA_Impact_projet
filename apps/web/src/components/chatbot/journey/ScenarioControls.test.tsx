import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ScenarioControls } from "./ScenarioControls";

const value = { search_scenario: "auto", booking_scenario: "confirmed" } as const;

describe("ScenarioControls", () => {
  it("is a collapsed test tool by default", () => {
    render(<ScenarioControls value={value} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Scénario de test" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("offers the four search scenarios and the three booking scenarios", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ScenarioControls value={value} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Scénario de test" }));

    expect(screen.getByText(/Outil de test de la simulation/)).toBeInTheDocument();
    const search = screen.getByRole("combobox", { name: "Recherche" });
    const booking = screen.getByRole("combobox", { name: "Réservation" });
    expect([...search.querySelectorAll("option")].map((o) => [o.value, o.textContent])).toEqual([
      ["auto", "Automatique"],
      ["adjustments", "Ajustements proposés"],
      ["no_match", "Aucun résultat"],
      ["error", "Erreur technique"],
    ]);
    expect([...booking.querySelectorAll("option")].map((o) => o.value)).toEqual(["confirmed", "refused", "error"]);

    await user.selectOptions(search, "adjustments");
    expect(onChange).toHaveBeenLastCalledWith({ search_scenario: "adjustments", booking_scenario: "confirmed" });
    await user.selectOptions(booking, "refused");
    expect(onChange).toHaveBeenLastCalledWith({ search_scenario: "auto", booking_scenario: "refused" });
  });
});
