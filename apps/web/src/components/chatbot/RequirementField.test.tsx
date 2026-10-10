import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PartialRequirements } from "@/types/contracts";
import { RequirementField } from "./RequirementField";

const base: PartialRequirements = {
  participants_count: 30,
  participants_breakdown: null,
  departure_station: null,
  departure: { date: "2026-11-12", time: "08:00", constraint: "approximate" },
  return: null,
  teaching_type: null,
};

describe("RequirementField", () => {
  it("edits participants and calls onEdit with an integer", async () => {
    const onEdit = vi.fn(async () => true);
    const user = userEvent.setup();
    render(
      <ul>
        <RequirementField field="participants_count" requirements={base} missing={false} onEdit={onEdit} />
      </ul>,
    );

    await user.click(screen.getByRole("button", { name: "Modifier : Participants" }));
    const input = screen.getByLabelText("Nombre total de participants");
    expect(input).toHaveValue(30);
    await user.clear(input);
    await user.type(input, "32");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(onEdit).toHaveBeenCalledWith("participants_count", 32);
    await waitFor(() => expect(screen.queryByLabelText("Nombre total de participants")).not.toBeInTheDocument());
  });

  it("edits the departure station as trimmed single-line text and refuses an empty value", async () => {
    const onEdit = vi.fn(async () => true);
    const user = userEvent.setup();
    render(
      <ul>
        <RequirementField field="departure_station" requirements={base} missing onEdit={onEdit} />
      </ul>,
    );
    expect(screen.getByTestId("field-departure_station-value")).toHaveTextContent("À préciser");

    await user.click(screen.getByRole("button", { name: "Modifier : Gare de départ" }));
    const input = screen.getByRole("textbox", { name: "Gare de départ" });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("maxlength", "80");
    const save = screen.getByRole("button", { name: "Enregistrer" });
    expect(save).toBeDisabled();
    await user.type(input, "   ");
    expect(save).toBeDisabled();

    await user.clear(input);
    await user.type(input, "  Toulouse Matabiau ");
    await user.click(save);

    expect(onEdit).toHaveBeenCalledWith("departure_station", "Toulouse Matabiau");
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Gare de départ" })).not.toBeInTheDocument());
  });

  it("pre-fills the station editor with the server value", async () => {
    const user = userEvent.setup();
    render(
      <ul>
        <RequirementField
          field="departure_station"
          requirements={{ ...base, departure_station: "Montpellier" }}
          missing={false}
          onEdit={vi.fn(async () => true)}
        />
      </ul>,
    );
    expect(screen.getByTestId("field-departure_station-value")).toHaveTextContent("Montpellier");
    await user.click(screen.getByRole("button", { name: "Modifier : Gare de départ" }));
    expect(screen.getByRole("textbox", { name: "Gare de départ" })).toHaveValue("Montpellier");
  });

  it("edits a date/time field and sends date, time and constraint", async () => {
    const onEdit = vi.fn(async () => true);
    const user = userEvent.setup();
    render(
      <ul>
        <RequirementField field="return" requirements={base} missing onEdit={onEdit} />
      </ul>,
    );

    await user.click(screen.getByRole("button", { name: "Modifier : Retour" }));
    fireEvent.change(screen.getByLabelText("Date de retour"), { target: { value: "2026-11-12" } });
    fireEvent.change(screen.getByLabelText("Heure de retour"), { target: { value: "17:00" } });
    await user.selectOptions(screen.getByLabelText("Contrainte horaire du retour"), "latest");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(onEdit).toHaveBeenCalledWith("return", { date: "2026-11-12", time: "17:00", constraint: "latest" });
  });

  it("edits the teaching type and nulls the empty part", async () => {
    const onEdit = vi.fn(async () => true);
    const user = userEvent.setup();
    render(
      <ul>
        <RequirementField field="teaching_type" requirements={base} missing onEdit={onEdit} />
      </ul>,
    );

    await user.click(screen.getByRole("button", { name: "Modifier : Matière ou thème" }));
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    await user.type(screen.getByLabelText("Matière"), "Histoire");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(onEdit).toHaveBeenCalledWith("teaching_type", { subject: "Histoire", theme: null });
  });

  it("keeps the editor open when the edit is rejected", async () => {
    const onEdit = vi.fn(async () => false);
    const user = userEvent.setup();
    render(
      <ul>
        <RequirementField field="participants_count" requirements={base} missing={false} onEdit={onEdit} />
      </ul>,
    );

    await user.click(screen.getByRole("button", { name: "Modifier : Participants" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Nombre total de participants")).toBeInTheDocument();
  });
});
