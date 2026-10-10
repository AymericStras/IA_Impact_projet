import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PartialRequirements } from "@/types/contracts";
import { RequirementsPanel } from "./RequirementsPanel";

const partial: PartialRequirements = {
  participants_count: 30,
  participants_breakdown: { students: 27, accompanying: 3 },
  departure_station: "Toulouse Matabiau",
  departure: { date: "2026-11-12", time: "08:00", constraint: "approximate" },
  return: null,
  teaching_type: { subject: "Histoire", theme: "Moyen Âge" },
};

describe("RequirementsPanel", () => {
  it("renders known values, flags missing fields and shows server-driven progress", () => {
    render(
      <RequirementsPanel
        requirements={partial}
        missingFields={["return"]}
        state="COLLECTING"
        onEdit={vi.fn(async () => true)}
      />,
    );

    expect(screen.getByTestId("panel-progress")).toHaveTextContent("4 / 5 informations");

    // Five rows, in the canonical order.
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Participants",
      "Gare de départ",
      "Départ",
      "Retour",
      "Matière ou thème",
    ]);
    const station = screen.getByTestId("field-departure_station");
    expect(station).toHaveAttribute("data-state", "known");
    expect(within(station).getByTestId("field-departure_station-value")).toHaveTextContent("Toulouse Matabiau");

    const participants = screen.getByTestId("field-participants_count");
    expect(participants).toHaveAttribute("data-state", "known");
    expect(within(participants).getByTestId("field-participants_count-value")).toHaveTextContent("30 participants");
    expect(participants).toHaveTextContent("27 élèves et 3 accompagnateurs");

    const departure = screen.getByTestId("field-departure");
    expect(departure).toHaveTextContent("jeudi 12 novembre");
    expect(departure).toHaveTextContent("vers 8 h 00");

    const ret = screen.getByTestId("field-return");
    expect(ret).toHaveAttribute("data-state", "missing");
    expect(within(ret).getByTestId("field-return-value")).toHaveTextContent("À préciser");

    expect(screen.getByTestId("field-teaching_type")).toHaveTextContent("Histoire — Moyen Âge");
  });

  it("renders the completion text when nothing is missing", () => {
    render(
      <RequirementsPanel
        requirements={{ ...partial, return: { date: "2026-11-12", time: "17:00", constraint: "latest" } }}
        missingFields={[]}
        state="AWAITING_CONFIRMATION"
        onEdit={vi.fn(async () => true)}
      />,
    );

    expect(screen.getByTestId("panel-progress")).toHaveTextContent("5 / 5 informations · complet");
    expect(screen.getByTestId("field-return")).toHaveTextContent("au plus tard à 17 h 00");
    expect(screen.getByTestId("panel-state")).toHaveTextContent("En attente de votre confirmation");
  });

  it("hides the breakdown line when it does not add up to the total", () => {
    const { rerender } = render(
      <RequirementsPanel
        requirements={{ ...partial, participants_count: 32 }}
        missingFields={["return"]}
        state="COLLECTING"
        onEdit={vi.fn(async () => true)}
      />,
    );
    const participants = screen.getByTestId("field-participants_count");
    expect(participants).toHaveTextContent("32 participants");
    expect(participants).not.toHaveTextContent("27 élèves");

    // An incomplete breakdown is not shown next to a total either.
    rerender(
      <RequirementsPanel
        requirements={{ ...partial, participants_breakdown: { students: 27, accompanying: null } }}
        missingFields={["return"]}
        state="COLLECTING"
        onEdit={vi.fn(async () => true)}
      />,
    );
    expect(screen.getByTestId("field-participants_count")).not.toHaveTextContent("27 élèves");
  });

  it("expands and focuses the first edit button when the parent requests an edit", () => {
    const props = {
      requirements: partial,
      missingFields: [] as never[],
      state: "AWAITING_CONFIRMATION" as const,
      onEdit: vi.fn(async () => true),
    };
    const { rerender } = render(<RequirementsPanel {...props} />);
    expect(screen.getByTestId("panel-toggle")).toHaveAttribute("aria-expanded", "false");

    rerender(<RequirementsPanel {...props} editRequest={1} />);
    expect(screen.getByTestId("panel-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Modifier : Participants" })).toHaveFocus();
  });

  it("marks the field targeted by a pending clarification", () => {
    render(
      <RequirementsPanel
        requirements={{ ...partial, participants_count: null, participants_breakdown: { students: 25, accompanying: null } }}
        missingFields={["participants_count", "return"]}
        pendingClarification={{ field: "participants_count", kind: "students_only" }}
        state="ASKING_USER"
        onEdit={vi.fn(async () => true)}
      />,
    );

    const participants = screen.getByTestId("field-participants_count");
    expect(participants).toHaveTextContent("25 élèves — nombre d'accompagnateurs à préciser");
    expect(participants).toHaveTextContent("Une précision est attendue");
    expect(screen.getByTestId("panel-progress")).toHaveTextContent("3 / 5 informations");
  });

  it("shows the station as missing when the server lists it, whatever the value", () => {
    render(
      <RequirementsPanel
        requirements={{ ...partial, departure_station: null }}
        missingFields={["departure_station", "return"]}
        state="COLLECTING"
        onEdit={vi.fn(async () => true)}
      />,
    );

    const station = screen.getByTestId("field-departure_station");
    expect(station).toHaveAttribute("data-state", "missing");
    expect(within(station).getByTestId("field-departure_station-value")).toHaveTextContent("À préciser");
    expect(screen.getByTestId("panel-progress")).toHaveTextContent("3 / 5 informations");
  });
});
