import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NoMatchCard } from "./NoMatchCard";

describe("NoMatchCard", () => {
  it("says in words that no result is not a technical error, and is not an alert", () => {
    render(<NoMatchCard />);
    expect(screen.getByTestId("journey-no-match")).toHaveTextContent(
      "La recherche a bien fonctionné : il ne s'agit pas d'une erreur technique.",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
