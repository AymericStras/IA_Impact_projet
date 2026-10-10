import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ConfirmedRequirements } from "@/types/contracts";
import { ConfirmationCard } from "./ConfirmationCard";

const confirmed: ConfirmedRequirements = {
  schema_version: "1.1",
  conversation_id: "conv_test",
  status: "confirmed",
  timezone: "Europe/Paris",
  confirmed_at: "2026-10-10T14:32:05+02:00",
  requirements: {
    participants_count: 30,
    participants_breakdown: { students: 27, accompanying: 3 },
    departure_station: "Toulouse Matabiau",
    departure: { date: "2026-11-12", time: "08:00", constraint: "approximate" },
    return: { date: "2026-11-12", time: "17:00", constraint: "latest" },
    teaching_type: { subject: "Histoire", theme: "Moyen Âge" },
  },
};

describe("ConfirmationCard", () => {
  it("renders nothing until the server says the project is ready", () => {
    const { container } = render(
      <ConfirmationCard ready={false} confirmedRequirements={null} onConfirm={vi.fn()} onEdit={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("has its own short copy (it does not repeat the assistant's summary) and two actions", async () => {
    const onConfirm = vi.fn();
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmationCard ready confirmedRequirements={null} onConfirm={onConfirm} onEdit={onEdit} />);

    const card = screen.getByTestId("confirmation-card");
    expect(card).toHaveTextContent("Vérification avant transmission");
    expect(card).toHaveTextContent(
      "Vérifiez le récapitulatif dans « Votre projet », puis confirmez pour transmettre ces informations.",
    );
    expect(card).not.toHaveTextContent("J'ai bien compris votre projet");

    await user.click(screen.getByRole("button", { name: "Modifier" }));
    await user.click(screen.getByRole("button", { name: "Confirmer et continuer" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows the transmitted JSON once confirmed", () => {
    render(<ConfirmationCard ready={false} confirmedRequirements={confirmed} onConfirm={vi.fn()} onEdit={vi.fn()} />);

    expect(screen.getByTestId("confirmation-done")).toHaveTextContent("Projet confirmé");
    const json = screen.getByTestId("confirmed-json");
    expect(json).toHaveTextContent('"schema_version": "1.1"');
    expect(json).toHaveTextContent('"departure_station": "Toulouse Matabiau"');
    expect(json).toHaveTextContent('"constraint": "latest"');
    expect(screen.getByRole("button", { name: "Copier" })).toBeInTheDocument();
  });
});
