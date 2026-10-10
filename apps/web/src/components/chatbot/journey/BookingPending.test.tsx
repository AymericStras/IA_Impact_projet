import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_CHECK_DELAY_MS, BookingPending } from "./BookingPending";
import { booking } from "./journeyFixtures";

const pending = { ...booking, status: "pending" as const };

describe("BookingPending", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the reference and looks the answer up once, about 2.5 s after the request", () => {
    const onCheck = vi.fn();
    const { rerender } = render(<BookingPending booking={pending} onCheck={onCheck} />);
    expect(screen.getByTestId("booking-reference")).toHaveTextContent("Référence : SIM-050033B9");
    expect(screen.getByRole("status")).toHaveTextContent("Réponse du service de réservation en attente…");

    act(() => void vi.advanceTimersByTime(AUTO_CHECK_DELAY_MS - 1));
    expect(onCheck).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onCheck).toHaveBeenCalledTimes(1);

    // Still waiting after that single look-up: no polling.
    rerender(<BookingPending booking={pending} onCheck={onCheck} />);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it("lets the teacher ask again", () => {
    const onCheck = vi.fn();
    render(<BookingPending booking={pending} onCheck={onCheck} />);
    fireEvent.click(screen.getByRole("button", { name: "Vérifier la réponse" }));
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it("does not look anything up once it is gone", () => {
    const onCheck = vi.fn();
    const { unmount } = render(<BookingPending booking={pending} onCheck={onCheck} />);
    unmount();
    act(() => void vi.advanceTimersByTime(AUTO_CHECK_DELAY_MS * 2));
    expect(onCheck).not.toHaveBeenCalled();
  });
});
