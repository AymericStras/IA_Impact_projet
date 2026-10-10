import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useKeyboardInset } from "./useViewportTracking";

/** Minimal stand-in for window.visualViewport (jsdom does not provide one). */
class FakeVisualViewport extends EventTarget {
  height = 800;
  scale = 1;
  offsetTop = 0;
}

describe("useKeyboardInset", () => {
  let viewport: FakeVisualViewport;
  let shell: HTMLDivElement;

  beforeEach(() => {
    viewport = new FakeVisualViewport();
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    shell = document.createElement("div");
    document.body.appendChild(shell);
  });

  afterEach(() => {
    shell.remove();
    Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
  });

  const height = () => shell.style.getPropertyValue("--app-height");

  it("shrinks the shell to the visual viewport while the keyboard is open, and restores it after", () => {
    renderHook(() => useKeyboardInset({ current: shell }));
    expect(height()).toBe("");

    viewport.height = 460;
    viewport.dispatchEvent(new Event("resize"));
    expect(height()).toBe("460px");

    viewport.height = 800;
    viewport.dispatchEvent(new Event("resize"));
    expect(height()).toBe("");
  });

  it("ignores pinch-zoom, so zooming never changes the layout", () => {
    renderHook(() => useKeyboardInset({ current: shell }));

    viewport.height = 400;
    viewport.scale = 2;
    viewport.dispatchEvent(new Event("resize"));
    expect(height()).toBe("");
  });

  it("ignores small changes such as a collapsing browser toolbar", () => {
    renderHook(() => useKeyboardInset({ current: shell }));

    viewport.height = 750;
    viewport.dispatchEvent(new Event("resize"));
    expect(height()).toBe("");
  });

  it("cleans up on unmount", () => {
    const { unmount } = renderHook(() => useKeyboardInset({ current: shell }));
    viewport.height = 460;
    viewport.dispatchEvent(new Event("resize"));
    expect(height()).toBe("460px");

    unmount();
    expect(height()).toBe("");
  });
});
