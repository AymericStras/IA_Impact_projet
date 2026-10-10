import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { JourneyStart } from "./JourneyStart";

describe("JourneyStart", () => {
  it("searches only when the teacher asks for it", async () => {
    const onStart = vi.fn();
    render(<JourneyStart onStart={onStart} />);
    expect(screen.getByRole("heading", { level: 2, name: "Propositions de sortie" })).toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Rechercher des propositions" }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("shows the search in progress and cannot be pressed twice", () => {
    render(<JourneyStart onStart={vi.fn()} pending />);
    expect(screen.getByRole("button", { name: "Recherche…" })).toBeDisabled();
  });
});
