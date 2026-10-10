import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Trame } from "./Trame";

describe("Trame", () => {
  it("is decorative: hidden from assistive technology and not focusable", () => {
    const { container } = render(<Trame />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
  });

  it("draws the same two-row pattern on every render", () => {
    const first = render(<Trame />).container.innerHTML;
    const second = render(<Trame />).container.innerHTML;
    expect(first).toBe(second);
    const ys = new Set([...render(<Trame />).container.querySelectorAll("rect")].map((r) => r.getAttribute("y")));
    expect([...ys]).toEqual(["0", "8"]);
  });

  it("never draws a yellow stroke on a light surface", () => {
    const { container } = render(<Trame surface="light" />);
    expect(container.querySelector(".fill-highlight")).toBeNull();
    expect(container.querySelector(".fill-action")).not.toBeNull();
  });
});
