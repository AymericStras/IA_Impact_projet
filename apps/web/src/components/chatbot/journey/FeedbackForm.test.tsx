import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FeedbackForm } from "./FeedbackForm";

describe("FeedbackForm", () => {
  it("needs a rating; the comment is optional", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<FeedbackForm onSubmit={onSubmit} />);
    const submit = screen.getByRole("button", { name: "Envoyer mon avis" });
    expect(submit).toBeDisabled();
    expect(screen.getAllByRole("radio")).toHaveLength(5);

    await user.click(screen.getByRole("radio", { name: "4 sur 5" }));
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(onSubmit).toHaveBeenLastCalledWith({ rating: 4 });

    await user.type(screen.getByRole("textbox", { name: "Commentaire (facultatif)" }), "  Très bien.  ");
    await user.click(submit);
    expect(onSubmit).toHaveBeenLastCalledWith({ rating: 4, comment: "Très bien." });
  });

  it("is a radio group operable with the keyboard", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<FeedbackForm onSubmit={onSubmit} />);
    expect(screen.getByRole("group", { name: "Note globale" })).toBeInTheDocument();

    await user.tab();
    expect(screen.getByRole("radio", { name: "1 sur 5" })).toHaveFocus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByRole("radio", { name: "3 sur 5" })).toBeChecked();
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith({ rating: 3 });
  });

  it("limits the comment to what the server accepts and locks while sending", () => {
    render(<FeedbackForm onSubmit={vi.fn()} pending />);
    expect(screen.getByRole("textbox", { name: "Commentaire (facultatif)" })).toHaveAttribute("maxlength", "1000");
    expect(screen.getByRole("button", { name: "Envoi…" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "5 sur 5" })).toBeDisabled();
  });
});
