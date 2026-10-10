import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Carousel, SWIPE_DISTANCE } from "./Carousel";

const CITIES = ["Carcassonne", "Albi", "Sète"];

function Harness({ items = CITIES, disabled = false, onChange }: { items?: string[]; disabled?: boolean; onChange?: (index: number) => void }) {
  const [index, setIndex] = useState(0);
  return (
    <>
      <h1 tabIndex={-1}>Choisissez</h1>
      <Carousel
        items={items}
        index={index}
        onIndexChange={(next) => {
          onChange?.(next);
          setIndex(next);
        }}
        label="Destinations proposées"
        previousLabel="Destination précédente"
        nextLabel="Destination suivante"
        slideLabel={(item, position, total) => `Destination ${position} sur ${total} : ${item}`}
        disabled={disabled}
        testId="cities"
      >
        {(item) => (
          <div>
            <p data-testid="card">{item}</p>
            <button type="button">Activité de {item}</button>
          </div>
        )}
      </Carousel>
      <input aria-label="Champ libre" />
    </>
  );
}

const card = () => screen.getByTestId("card").textContent;
const position = () => screen.getByTestId("cities-position").textContent;

describe("Carousel", () => {
  it("shows one card at a time, with its position in words and as marks", () => {
    render(<Harness />);
    expect(screen.getAllByTestId("card")).toHaveLength(1);
    expect(card()).toBe("Carcassonne");
    expect(position()).toBe("1 sur 3");
    expect(screen.getByRole("group", { name: "Destination 1 sur 3 : Carcassonne" })).toBeInTheDocument();
    const dots = screen.getByTestId("cities-dots").children;
    expect(dots).toHaveLength(3);
    expect([...dots].map((dot) => dot.getAttribute("data-current"))).toEqual(["true", "false", "false"]);
  });

  it("moves with the labelled buttons and stops at both ends", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const previous = screen.getByRole("button", { name: "Destination précédente" });
    const next = screen.getByRole("button", { name: "Destination suivante" });
    expect(previous).toBeDisabled();

    await user.click(next);
    expect(card()).toBe("Albi");
    expect(position()).toBe("2 sur 3");
    expect(previous).toBeEnabled();

    await user.click(next);
    expect(card()).toBe("Sète");
    expect(next).toBeDisabled();

    await user.click(previous);
    expect(card()).toBe("Albi");
  });

  it("moves with the arrow keys from anywhere on the stage, Home and End included", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    // Focus is on the stage heading right after entry: the keys already work.
    screen.getByRole("heading", { name: "Choisissez" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(card()).toBe("Albi");
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    // No wrap-around: the last card is an end.
    expect(card()).toBe("Sète");
    await user.keyboard("{ArrowLeft}");
    expect(card()).toBe("Albi");
    await user.keyboard("{Home}");
    expect(card()).toBe("Carcassonne");
    await user.keyboard("{ArrowLeft}");
    expect(card()).toBe("Carcassonne");
    await user.keyboard("{End}");
    expect(card()).toBe("Sète");
  });

  it("keeps the arrow keys working while a control inside the card has focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole("button", { name: "Activité de Carcassonne" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(card()).toBe("Albi");
  });

  it("leaves the arrow keys to text fields and ignores modified keys", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByLabelText("Champ libre"));
    await user.keyboard("{ArrowRight}");
    expect(card()).toBe("Carcassonne");
    screen.getByRole("heading", { name: "Choisissez" }).focus();
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(card()).toBe("Carcassonne");
  });

  it("changes card on a horizontal swipe by touch, not on a vertical scroll or a mouse drag", () => {
    render(<Harness />);
    const slide = () => screen.getByTestId("cities-slide");
    const swipe = (dx: number, dy: number, pointerType = "touch") => {
      fireEvent.pointerDown(slide(), { pointerId: 1, pointerType, clientX: 200, clientY: 300 });
      fireEvent.pointerUp(slide(), { pointerId: 1, pointerType, clientX: 200 + dx, clientY: 300 + dy });
    };

    swipe(-(SWIPE_DISTANCE + 20), 6);
    expect(card()).toBe("Albi");
    swipe(SWIPE_DISTANCE + 20, -4);
    expect(card()).toBe("Carcassonne");

    // Too short, mostly vertical, or made with a mouse: nothing moves.
    swipe(-(SWIPE_DISTANCE - 10), 0);
    swipe(-(SWIPE_DISTANCE + 20), 200);
    swipe(-(SWIPE_DISTANCE + 20), 0, "mouse");
    expect(card()).toBe("Carcassonne");

    // A cancelled touch (the browser took it for a scroll) is forgotten.
    fireEvent.pointerDown(slide(), { pointerId: 2, pointerType: "touch", clientX: 200, clientY: 300 });
    fireEvent.pointerCancel(slide(), { pointerId: 2, pointerType: "touch" });
    fireEvent.pointerUp(slide(), { pointerId: 2, pointerType: "touch", clientX: 40, clientY: 300 });
    expect(card()).toBe("Carcassonne");
  });

  it("does not move while disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness disabled onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Destination suivante" })).toBeDisabled();
    await user.keyboard("{ArrowRight}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a single card without navigation", () => {
    render(<Harness items={["Albi"]} />);
    expect(card()).toBe("Albi");
    expect(screen.queryByRole("button", { name: "Destination suivante" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("cities-position")).not.toBeInTheDocument();
  });
});
