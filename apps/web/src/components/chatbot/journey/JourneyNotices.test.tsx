import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JourneyNotices } from "./JourneyNotices";

describe("JourneyNotices", () => {
  it("renders every notice sent by the server, as received", () => {
    render(<JourneyNotices notices={["Simulation : rien n'est réel.", "<b>Deuxième</b> note."]} />);
    const items = within(screen.getByRole("list", { name: "À savoir sur ces propositions" })).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["Simulation : rien n'est réel.", "<b>Deuxième</b> note."]);
  });

  it("renders nothing when the server sent no notice (no label is invented)", () => {
    const { container } = render(<JourneyNotices notices={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
