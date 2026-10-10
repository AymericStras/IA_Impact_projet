import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CANCEL_RADIUS_PX, HOLD_THRESHOLD_MS, useHoldToTalk, type GestureCancelReason } from "./useHoldToTalk";

interface HarnessProps {
  active: boolean;
  disabled?: boolean;
  onStart: () => void;
  onStop: () => void;
  onCancel: (reason: GestureCancelReason) => void;
  onRelease?: () => void;
}

/** A talk button driven by the hook, plus another control to test key routing. */
function Harness(props: HarnessProps) {
  const gesture = useHoldToTalk(props);
  return (
    <div>
      <button {...gesture.buttonProps} type="button" data-pressed={gesture.pressed} data-will-cancel={gesture.willCancel} data-mode={gesture.mode}>
        Parler
      </button>
      <button type="button">Annuler</button>
      <p tabIndex={-1}>Titre</p>
    </div>
  );
}

function setup(initial: Partial<HarnessProps> = {}) {
  const handlers = { onStart: vi.fn(), onStop: vi.fn(), onCancel: vi.fn(), onRelease: vi.fn() };
  const props: HarnessProps = { active: false, ...handlers, ...initial };
  const view = render(<Harness {...props} />);
  const button = screen.getByRole("button", { name: "Parler" });
  const setActive = (active: boolean) => view.rerender(<Harness {...props} active={active} />);
  return { ...handlers, button, setActive, view };
}

const pointer = { pointerId: 1, isPrimary: true, button: 0, pointerType: "touch", clientX: 100, clientY: 100 };

describe("useHoldToTalk", () => {
  beforeEach(() => {
    // Fake timers also drive performance.now(), which the hook measures presses with.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds to talk: a press of at least the threshold starts, its release finishes", () => {
    const { button, onStart, onStop, onCancel, setActive } = setup();

    fireEvent.pointerDown(button, pointer);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("data-pressed", "true");
    expect(button).toHaveAttribute("data-mode", "hold");
    setActive(true);

    act(() => vi.advanceTimersByTime(HOLD_THRESHOLD_MS));
    fireEvent.pointerUp(button, pointer);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(button).toHaveAttribute("data-pressed", "false");
  });

  it("taps to toggle: a shorter press starts and keeps recording, the next press finishes", () => {
    const { button, onStart, onStop, setActive } = setup();

    fireEvent.pointerDown(button, pointer);
    setActive(true);
    act(() => vi.advanceTimersByTime(HOLD_THRESHOLD_MS - 1));
    fireEvent.pointerUp(button, pointer);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
    expect(button).toHaveAttribute("data-mode", "toggle");

    act(() => vi.advanceTimersByTime(3_000));
    fireEvent.pointerDown(button, { ...pointer, pointerId: 2 });
    expect(onStart).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(button, { ...pointer, pointerId: 2 });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("arms the cancel beyond the radius, disarms when coming back, cancels on release outside", () => {
    const { button, onStop, onCancel, setActive } = setup();

    fireEvent.pointerDown(button, pointer);
    setActive(true);
    act(() => vi.advanceTimersByTime(400));

    fireEvent.pointerMove(button, { ...pointer, clientY: 100 - CANCEL_RADIUS_PX });
    expect(button).toHaveAttribute("data-will-cancel", "false");
    fireEvent.pointerMove(button, { ...pointer, clientY: 100 - CANCEL_RADIUS_PX - 2 });
    expect(button).toHaveAttribute("data-will-cancel", "true");
    fireEvent.pointerMove(button, { ...pointer, clientY: 90 });
    expect(button).toHaveAttribute("data-will-cancel", "false");

    fireEvent.pointerMove(button, { ...pointer, clientX: 100 + CANCEL_RADIUS_PX + 40 });
    fireEvent.pointerUp(button, { ...pointer, clientX: 100 + CANCEL_RADIUS_PX + 40 });
    expect(onCancel).toHaveBeenCalledWith("slide");
    expect(onStop).not.toHaveBeenCalled();
  });

  it("treats pointercancel as an interruption, never as a finished recording", () => {
    const { button, onStop, onCancel, setActive } = setup();
    fireEvent.pointerDown(button, pointer);
    setActive(true);
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerCancel(button, pointer);
    expect(onCancel).toHaveBeenCalledWith("interrupted");
    expect(onStop).not.toHaveBeenCalled();
    expect(button).toHaveAttribute("data-pressed", "false");
  });

  it("cancels with a notice when the tab goes to the background while recording", () => {
    const { onCancel } = setup({ active: true });
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    expect(onCancel).toHaveBeenCalledWith("interrupted");
    visibility.mockRestore();
  });

  it("toggles with Space and Enter on the button", () => {
    const { button, onStart, onStop, setActive } = setup();

    fireEvent.keyDown(button, { key: " " });
    expect(onStart).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(button, { key: " " });
    setActive(true);

    // Key repeat while the key is held down does nothing.
    fireEvent.keyDown(button, { key: " ", repeat: true });
    expect(onStop).not.toHaveBeenCalled();

    fireEvent.keyDown(button, { key: "Enter" });
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("finishes with Space from a non-interactive focus position, but leaves other buttons their own key", () => {
    const { onStop } = setup({ active: true });

    fireEvent.keyDown(screen.getByRole("button", { name: "Annuler" }), { key: " " });
    expect(onStop).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByText("Titre"), { key: " " });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("cancels with Escape from anywhere while recording, and only then", () => {
    const idle = setup();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(idle.onCancel).not.toHaveBeenCalled();
    idle.view.unmount();

    const recording = setup({ active: true });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(recording.onCancel).toHaveBeenCalledWith("escape");
  });

  it("ignores the click that echoes a handled press, but obeys a click from assistive technology", () => {
    const { button, onStart, onStop, setActive } = setup();

    fireEvent.pointerDown(button, pointer);
    fireEvent.pointerUp(button, pointer);
    fireEvent.click(button);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
    setActive(true);

    // Much later, a click with no pointer or key event behind it (screen reader, switch).
    act(() => vi.advanceTimersByTime(5_000));
    fireEvent.click(button);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("suppresses the context menu of a long press", () => {
    const { button } = setup();
    const notPrevented = fireEvent.contextMenu(button);
    expect(notPrevented).toBe(false);
  });

  it("ignores secondary mouse buttons and non-primary pointers", () => {
    const { button, onStart } = setup();
    fireEvent.pointerDown(button, { ...pointer, pointerType: "mouse", button: 2 });
    fireEvent.pointerDown(button, { ...pointer, isPrimary: false });
    expect(onStart).not.toHaveBeenCalled();
  });

  it("does nothing while disabled", () => {
    const { button, onStart } = setup({ disabled: true });
    fireEvent.pointerDown(button, pointer);
    fireEvent.keyDown(button, { key: " " });
    expect(onStart).not.toHaveBeenCalled();
  });

  it("a finger still down when the recording ended by itself neither stops nor cancels anything", () => {
    const { button, onStop, onCancel, setActive } = setup();
    fireEvent.pointerDown(button, pointer);
    setActive(true);
    act(() => vi.advanceTimersByTime(2_000));
    // Maximum duration reached: the recorder went idle on its own.
    setActive(false);
    expect(button).toHaveAttribute("data-pressed", "false");

    fireEvent.pointerUp(button, pointer);
    expect(onStop).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("a press whose release was never seen does not block the next press", () => {
    const { button, onStart, setActive } = setup();
    fireEvent.pointerDown(button, pointer);
    setActive(true);
    setActive(false);
    // No pointerup arrived (the button was covered or remounted). The next press works.
    act(() => vi.advanceTimersByTime(1_000));
    fireEvent.pointerDown(button, { ...pointer, pointerId: 7 });
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it("reports every release so audio can be unlocked on touch devices", () => {
    const { button, onRelease } = setup();
    fireEvent.pointerDown(button, pointer);
    fireEvent.pointerUp(button, pointer);
    fireEvent.keyUp(button, { key: " " });
    expect(onRelease).toHaveBeenCalledTimes(2);
  });
});
