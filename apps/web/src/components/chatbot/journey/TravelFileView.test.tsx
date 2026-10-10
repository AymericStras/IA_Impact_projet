import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SIMULATION_NOTICE, travelFile } from "./journeyFixtures";
import { TravelFileView } from "./TravelFileView";

describe("TravelFileView", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the timetable, the places, the safety advice and the contacts as the server wrote them", () => {
    render(<TravelFileView file={travelFile} notices={[SIMULATION_NOTICE]} />);
    const file = screen.getByRole("article", { name: "Sortie pédagogique — Cité médiévale de Carcassonne" });
    expect(file).toHaveTextContent("Référence : SIM-050033B9");
    expect(within(screen.getByTestId("travel-file-schedule")).getAllByRole("listitem").map((li) => li.textContent)).toEqual(
      travelFile.schedule,
    );
    expect(within(screen.getByRole("region", { name: "Lieux" })).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Conseils de sécurité" })).toHaveTextContent("Arriver en gare 20 minutes avant le départ.");
    expect(screen.getByRole("region", { name: "Contacts utiles" })).toHaveTextContent("Numéro d'urgence européen : 112");
    // No link is invented when the server sends none.
    expect(screen.queryByRole("region", { name: "Liens officiels" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("carries the simulation label inside the printed area", () => {
    render(<TravelFileView file={travelFile} notices={[SIMULATION_NOTICE]} />);
    const area = screen.getByTestId("travel-file");
    expect(area).toHaveAttribute("data-print-area");
    expect(within(area).getByText(SIMULATION_NOTICE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Imprimer le dossier" }).closest("[data-print-hidden]")).not.toBeNull();
  });

  it("prints on demand", async () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    render(<TravelFileView file={travelFile} notices={[]} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Imprimer le dossier" }));
    expect(print).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("shows official links as plain text, never as links", () => {
    render(<TravelFileView file={{ ...travelFile, official_links: ["javascript:alert(1)"] }} notices={[]} />);
    expect(screen.getByRole("region", { name: "Liens officiels" })).toHaveTextContent("javascript:alert(1)");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
