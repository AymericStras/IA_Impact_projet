import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ConversationResponse } from "@/types/contracts";
import type { EditHandler } from "./FieldEditor";
import { SheetRow } from "./SheetRow";
import { SHEET_FIELDS, askedField, confirmationStatus, type SheetField } from "./fieldDisplay";

function conversation(overrides: Partial<ConversationResponse> = {}): ConversationResponse {
  return {
    conversation_id: "conv_test",
    state: "COLLECTING",
    version: 3,
    assistant_message: "À quelle heure souhaitez-vous être de retour le jeudi 12 novembre ?",
    requirements: {
      participants_count: 30,
      participants_breakdown: { students: 27, accompanying: 3 },
      departure_station: "Toulouse Matabiau",
      departure: { date: "2026-11-12", time: "08:00", constraint: "approximate" },
      return: { date: "2026-11-12", time: null, constraint: null },
      teaching_type: { subject: "Histoire", theme: "Moyen Âge" },
    },
    missing_fields: ["return"],
    pending_clarification: null,
    ready_for_confirmation: false,
    transcript: null,
    confirmed_requirements: null,
    messages: [
      { id: "msg_001", role: "assistant", content: "Bonjour !", created_at: "2026-10-10T10:00:00+02:00" },
      { id: "msg_002", role: "user", content: "Nous serons 30.", source: "audio", created_at: "2026-10-10T10:01:00+02:00" },
    ],
    ...overrides,
  };
}

function renderRow(field: SheetField, state: ConversationResponse, question: string | null = null, onEdit?: EditHandler) {
  const edit = onEdit ?? (vi.fn(async () => true) as unknown as EditHandler);
  render(
    <ul>
      <SheetRow field={field} conversation={state} question={question} onEdit={edit} />
    </ul>,
  );
  return { row: screen.getByTestId(`sheet-row-${field}`), edit };
}

describe("SheetRow", () => {
  it("has one row per field of the contract, station second", () => {
    expect(SHEET_FIELDS).toEqual(["participants_count", "departure_station", "departure", "return", "teaching_type"]);
  });

  it("shows a known field with its value in words and its state as text", () => {
    const { row } = renderRow("departure", conversation());
    expect(row).toHaveAttribute("data-state", "known");
    expect(within(row).getByText("Renseigné")).toBeInTheDocument();
    expect(screen.getByTestId("sheet-row-departure-value")).toHaveTextContent("jeudi 12 novembre, vers 8 h 00");
  });

  it("shows the breakdown only when it adds up to the server's total", () => {
    renderRow("participants_count", conversation());
    expect(screen.getByText("27 élèves et 3 accompagnateurs")).toBeInTheDocument();
  });

  it("hides a breakdown that contradicts the total", () => {
    const state = conversation();
    state.requirements.participants_count = 32;
    renderRow("participants_count", state);
    expect(screen.getByTestId("sheet-row-participants_count-value")).toHaveTextContent("32 participants");
    expect(screen.queryByText(/élèves et/)).not.toBeInTheDocument();
  });

  it("marks a field missing because the server lists it, even when it holds a partial value", () => {
    const { row } = renderRow("return", conversation());
    expect(row).toHaveAttribute("data-state", "missing");
    expect(within(row).getByText("À préciser")).toBeInTheDocument();
    expect(screen.getByTestId("sheet-row-return-value")).toHaveTextContent("jeudi 12 novembre, heure à préciser");
  });

  it("does not decide by itself: a filled value the server still lists as missing stays missing", () => {
    const { row } = renderRow("departure_station", conversation({ missing_fields: ["departure_station"] }));
    expect(row).toHaveAttribute("data-state", "missing");
    expect(screen.getByTestId("sheet-row-departure_station-value")).toHaveTextContent("Toulouse Matabiau");
  });

  it("marks the field of the server's pending clarification as to clarify", () => {
    const state = conversation({ pending_clarification: { field: "participants_count", kind: "conflict" }, missing_fields: [] });
    const { row } = renderRow("participants_count", state);
    expect(row).toHaveAttribute("data-state", "clarify");
    expect(within(row).getByText("À clarifier")).toBeInTheDocument();
  });

  it("carries the server's question on the row it concerns, and only there", () => {
    const state = conversation();
    const { row } = renderRow("return", state, state.assistant_message);
    expect(row).toHaveAttribute("data-asked", "true");
    expect(screen.getByTestId("sheet-row-return-question")).toHaveTextContent(
      "À quelle heure souhaitez-vous être de retour le jeudi 12 novembre ?",
    );
  });

  it("highlights nothing when it has no question", () => {
    const { row } = renderRow("departure", conversation());
    expect(row).toHaveAttribute("data-asked", "false");
    expect(screen.queryByTestId("sheet-row-departure-question")).not.toBeInTheDocument();
  });

  it("renders server and teacher text as text, never as HTML", () => {
    const hostile = '<img src=x onerror="alert(1)"><b>Toulouse</b>';
    const state = conversation();
    state.requirements.departure_station = hostile;
    const { row } = renderRow("departure_station", state, "<script>alert(2)</script>Quelle gare ?");
    expect(screen.getByTestId("sheet-row-departure_station-value")).toHaveTextContent(hostile);
    expect(screen.getByTestId("sheet-row-departure_station-question")).toHaveTextContent("<script>alert(2)</script>Quelle gare ?");
    expect(row.querySelector("img, b, script")).toBeNull();
  });

  it("edits the station with a single-line text input: 80 characters at most, trimmed", async () => {
    const user = userEvent.setup();
    const edit = vi.fn(async () => true);
    renderRow("departure_station", conversation(), null, edit as unknown as EditHandler);

    await user.click(screen.getByRole("button", { name: "Modifier : Gare de départ" }));
    const input = screen.getByLabelText("Gare de départ");
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("maxlength", "80");
    expect(input).toHaveValue("Toulouse Matabiau");

    await user.clear(input);
    await user.type(input, "  Montpellier Saint-Roch  ");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(edit).toHaveBeenCalledWith("departure_station", "Montpellier Saint-Roch");
    expect(screen.queryByLabelText("Gare de départ")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Modifier : Gare de départ" })).toHaveFocus();
  });

  it("edits a date and time with typed inputs and sends the contract's value shape", async () => {
    const user = userEvent.setup();
    const edit = vi.fn(async () => true);
    renderRow("return", conversation(), null, edit as unknown as EditHandler);

    await user.click(screen.getByRole("button", { name: "Modifier : Retour" }));
    expect(screen.getByLabelText("Date de retour")).toHaveValue("2026-11-12");
    const save = screen.getByRole("button", { name: "Enregistrer" });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("Heure de retour"), "17:00");
    await user.selectOptions(screen.getByLabelText("Contrainte horaire du retour"), "latest");
    await user.click(save);
    expect(edit).toHaveBeenCalledWith("return", { date: "2026-11-12", time: "17:00", constraint: "latest" });
  });

  it("keeps the editor open with the teacher's value when the server refuses the edit", async () => {
    const user = userEvent.setup();
    const edit = vi.fn(async () => false);
    renderRow("participants_count", conversation(), null, edit as unknown as EditHandler);

    await user.click(screen.getByRole("button", { name: "Modifier : Participants" }));
    const input = screen.getByLabelText("Nombre total de participants");
    await user.clear(input);
    await user.type(input, "32");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(edit).toHaveBeenCalledWith("participants_count", 32);
    expect(screen.getByLabelText("Nombre total de participants")).toHaveValue(32);
  });

  it("closes the editor with Escape without saving", async () => {
    const user = userEvent.setup();
    const { edit } = renderRow("teaching_type", conversation());
    await user.click(screen.getByRole("button", { name: "Modifier : Matière ou thème" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("Matière")).not.toBeInTheDocument();
    expect(edit).not.toHaveBeenCalled();
  });
});

describe("sheet helpers read the server state", () => {
  it("attaches the question to the pending clarification first, else to the first missing field", () => {
    expect(askedField(conversation())).toBe("return");
    expect(askedField(conversation({ pending_clarification: { field: "departure", kind: "conflict" } }))).toBe("departure");
    expect(askedField(conversation({ missing_fields: [] }))).toBeNull();
  });

  it("attaches the welcome to no row: before any answer the message is not about one field", () => {
    const welcome = conversation({
      missing_fields: ["participants_count", "departure_station", "departure", "return", "teaching_type"],
      messages: [{ id: "msg_001", role: "assistant", content: "Bonjour !", created_at: "2026-10-10T10:00:00+02:00" }],
    });
    expect(askedField(welcome)).toBeNull();
  });

  it("states what is missing, what is to clarify, or that confirmation is possible", () => {
    expect(confirmationStatus(conversation())).toBe("Il manque : Retour");
    expect(confirmationStatus(conversation({ missing_fields: ["departure_station", "return"] }))).toBe("Il manque : Gare de départ, Retour");
    expect(confirmationStatus(conversation({ pending_clarification: { field: "participants_count", kind: "vague_quantity" } }))).toBe(
      "À clarifier : Participants",
    );
    expect(confirmationStatus(conversation({ missing_fields: [], ready_for_confirmation: true }))).toBe(
      "Tout est renseigné. Vérifiez, puis confirmez.",
    );
    // Nothing missing is not enough: readiness is the server's flag.
    expect(confirmationStatus(conversation({ missing_fields: [], ready_for_confirmation: false }))).toBe(
      "La confirmation sera possible une fois la fiche vérifiée.",
    );
  });
});
